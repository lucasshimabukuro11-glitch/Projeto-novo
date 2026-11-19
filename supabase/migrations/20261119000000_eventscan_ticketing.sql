begin;

create table public.event_sectors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  description text not null default '' check (length(description) <= 500),
  capacity integer not null check (capacity between 1 and 100000),
  seated boolean not null default false,
  unique (event_id, name),
  unique (id, event_id)
);

create table public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  sector_id uuid not null,
  name text not null check (length(btrim(name)) between 2 and 70),
  description text not null default '' check (length(description) <= 500),
  capacity integer not null check (capacity between 1 and 100000),
  per_person integer not null check (per_person between 1 and 20 and per_person <= capacity),
  color text not null default '#a78bfa' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active boolean not null default true,
  deadline timestamptz check (deadline is null or isfinite(deadline)),
  foreign key (sector_id, event_id) references public.event_sectors(id, event_id) on delete cascade,
  unique (event_id, name),
  unique (id, event_id, sector_id)
);

create table public.event_gates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  sector_id uuid,
  name text not null check (length(btrim(name)) between 2 and 80),
  foreign key (sector_id, event_id) references public.event_sectors(id, event_id) on delete cascade,
  unique (event_id, name),
  unique (id, event_id)
);

create table public.gate_staff (
  gate_id uuid not null,
  event_id uuid not null,
  user_id uuid not null,
  enabled boolean not null default true,
  primary key (gate_id, user_id),
  foreign key (gate_id, event_id) references public.event_gates(id, event_id) on delete cascade,
  foreign key (event_id, user_id) references public.event_staff(event_id, user_id) on delete cascade
);

create table public.seat_maps (
  sector_id uuid primary key,
  event_id uuid not null,
  rows integer not null check (rows between 1 and 26),
  columns integer not null check (columns between 1 and 30),
  stage text not null check (length(btrim(stage)) between 1 and 80),
  foreign key (sector_id, event_id) references public.event_sectors(id, event_id) on delete cascade
);

create table public.event_seats (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  sector_id uuid not null,
  row_no integer not null check (row_no between 1 and 26),
  column_no integer not null check (column_no between 1 and 30),
  kind text not null check (kind in ('standard', 'accessible', 'blocked', 'aisle')),
  foreign key (sector_id, event_id) references public.event_sectors(id, event_id) on delete cascade,
  unique (sector_id, row_no, column_no),
  unique (id, event_id, sector_id)
);

alter table public.tickets
  add column type_id uuid,
  add column sector_id uuid,
  add column seat_id uuid,
  add column request_id uuid,
  add constraint tickets_type_matches_event foreign key (type_id, event_id, sector_id)
    references public.ticket_types(id, event_id, sector_id),
  add constraint tickets_seat_matches_event foreign key (seat_id, event_id, sector_id)
    references public.event_seats(id, event_id, sector_id),
  add constraint tickets_option_shape check (
    (type_id is null and sector_id is null and seat_id is null and request_id is null)
    or (type_id is not null and sector_id is not null and request_id is not null)
  );

-- Os ingressos antigos preservam todos os identificadores e continuam únicos por conta.
alter table public.tickets drop constraint tickets_event_id_participant_id_key;
create unique index tickets_legacy_per_participant on public.tickets(event_id, participant_id) where type_id is null;
create unique index tickets_active_seat on public.tickets(event_id, seat_id) where seat_id is not null and cancelled_at is null;
create unique index tickets_request_per_participant on public.tickets(event_id, participant_id, request_id) where request_id is not null;
create index tickets_active_sector on public.tickets(event_id, sector_id) where cancelled_at is null;
create index tickets_active_type on public.tickets(type_id, participant_id) where cancelled_at is null and type_id is not null;

create table public.event_activity (
  event_id uuid primary key references public.events(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.event_sectors enable row level security;
alter table public.ticket_types enable row level security;
alter table public.event_gates enable row level security;
alter table public.gate_staff enable row level security;
alter table public.seat_maps enable row level security;
alter table public.event_seats enable row level security;
alter table public.event_activity enable row level security;
revoke all on public.event_sectors, public.ticket_types, public.event_gates, public.gate_staff,
  public.seat_maps, public.event_seats, public.event_activity from public, anon, authenticated;

grant select on public.event_activity to authenticated;
create policy activity_authorized on public.event_activity for select to authenticated
using (eventpass_private.owns_event(event_id) or eventpass_private.staffs_event(event_id)
  or eventpass_private.holds_ticket(event_id) or (select eventpass_private.user_role()) = 'admin');

create function eventpass_private.signal_event(p_event uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.event_activity(event_id, updated_at) values (p_event, clock_timestamp())
  on conflict (event_id) do update set updated_at = excluded.updated_at
$$;
revoke execute on function eventpass_private.signal_event(uuid) from public, anon, authenticated;

create function public.event_setup(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode configurar este evento.';
  end if;
  return jsonb_build_object(
    'sectors', coalesce((select jsonb_agg(s order by s.name) from public.event_sectors s where s.event_id = p_event), '[]'::jsonb),
    'types', coalesce((select jsonb_agg(t order by t.name) from public.ticket_types t where t.event_id = p_event), '[]'::jsonb),
    'gates', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('staff_ids',
      coalesce((select jsonb_agg(m.user_id order by m.user_id) from public.gate_staff m where m.gate_id = g.id and m.enabled), '[]'::jsonb))
      order by g.name) from public.event_gates g where g.event_id = p_event), '[]'::jsonb)
  );
end;
$$;

create function public.save_event_option(p_event uuid, p_kind text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target public.events;
  item_id uuid := nullif(p_data->>'id', '')::uuid;
  sector uuid := nullif(p_data->>'sector_id', '')::uuid;
  label text := btrim(p_data->>'name');
  size integer := nullif(p_data->>'capacity', '')::integer;
  member uuid := nullif(p_data->>'user_id', '')::uuid;
  active_count integer;
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode configurar este evento.';
  end if;
  select * into target from public.events where id = p_event for update;
  if target.status = 'cancelled' then raise exception 'O evento foi cancelado.'; end if;

  case p_kind
    when 'sector' then
      if size is null or size + (select coalesce(sum(s.capacity), 0) from public.event_sectors s
            where s.event_id = p_event and s.id is distinct from item_id) > target.capacity then
        raise exception 'A soma dos setores deve respeitar a capacidade do evento.';
      end if;
      if item_id is null then
        insert into public.event_sectors(event_id, name, description, capacity, seated)
        values (p_event, label, coalesce(p_data->>'description', ''), size, coalesce((p_data->>'seated')::boolean, false));
      else
        select count(*) into active_count from public.tickets
          where event_id = p_event and sector_id = item_id and cancelled_at is null;
        if active_count > size or exists (select 1 from public.ticket_types where sector_id = item_id and capacity > size) then
          raise exception 'A capacidade não pode ser menor que as reservas ou modalidades deste setor.';
        end if;
        update public.event_sectors set name = label, description = coalesce(p_data->>'description', ''), capacity = size
          where id = item_id and event_id = p_event;
        if not found then raise exception 'Setor inexistente neste evento.'; end if;
      end if;
    when 'type' then
      if not exists (select 1 from public.event_sectors s where s.id = sector and s.event_id = p_event and size <= s.capacity) then
        raise exception 'Escolha um setor deste evento e respeite a capacidade dele.';
      end if;
      if item_id is null then
        insert into public.ticket_types(event_id, sector_id, name, description, capacity, per_person, color, active, deadline)
        values (p_event, sector, label, coalesce(p_data->>'description', ''), size, (p_data->>'per_person')::integer,
          p_data->>'color', coalesce((p_data->>'active')::boolean, true), nullif(p_data->>'deadline', '')::timestamptz);
      else
        if (select count(*) from public.tickets where type_id = item_id and cancelled_at is null) > size then
          raise exception 'A quantidade não pode ser menor que o total de ingressos ativos.';
        end if;
        update public.ticket_types set name = label, description = coalesce(p_data->>'description', ''), capacity = size,
          per_person = (p_data->>'per_person')::integer, color = p_data->>'color',
          active = (p_data->>'active')::boolean, deadline = nullif(p_data->>'deadline', '')::timestamptz
          where id = item_id and event_id = p_event and sector_id = sector;
        if not found then raise exception 'Modalidade inexistente ou setor alterado.'; end if;
      end if;
    when 'gate' then
      if sector is not null and not exists (select 1 from public.event_sectors where id = sector and event_id = p_event) then
        raise exception 'Escolha um setor deste evento.';
      end if;
      if item_id is null then
        insert into public.event_gates(event_id, sector_id, name) values (p_event, sector, label);
      else
        update public.event_gates set name = label where id = item_id and event_id = p_event;
        if not found then raise exception 'Portaria inexistente neste evento.'; end if;
      end if;
    when 'gate_member' then
      if not exists (select 1 from public.event_gates where id = item_id and event_id = p_event)
        or not exists (select 1 from public.event_staff where event_id = p_event and user_id = member) then
        raise exception 'Adicione o funcionário à equipe do evento antes de autorizar esta portaria.';
      end if;
      insert into public.gate_staff(gate_id, event_id, user_id, enabled)
      values (item_id, p_event, member, coalesce((p_data->>'enabled')::boolean, true))
      on conflict (gate_id, user_id) do update set enabled = excluded.enabled;
    else
      raise exception using errcode = '22023', message = 'Configuração desconhecida.';
  end case;
  perform eventpass_private.signal_event(p_event);
end;
$$;

create function public.event_ticket_options(p_event uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'configured', exists (select 1 from public.ticket_types t where t.event_id = e.id),
    'options', coalesce((
      select jsonb_agg(to_jsonb(t) || jsonb_build_object('sector_name', s.name, 'sector_rules', s.description,
        'seated', s.seated, 'sector_available', stock.available,
        'available', greatest(0, least(stock.available,
          t.capacity - (select count(*) from public.tickets x where x.type_id = t.id and x.cancelled_at is null))))
        order by t.name)
      from public.ticket_types t join public.event_sectors s on s.id = t.sector_id
      cross join lateral (
        select greatest(0, least(e.capacity - e.reserved_count,
          s.capacity - (select count(*) from public.tickets x where x.sector_id = s.id and x.cancelled_at is null),
          case when s.seated then (select count(*) from public.event_seats a join public.seat_maps m on m.sector_id = a.sector_id
            where a.sector_id = s.id and a.row_no <= m.rows and a.column_no <= m.columns and a.kind in ('standard', 'accessible')
              and not exists (select 1 from public.tickets x where x.event_id = a.event_id and x.seat_id = a.id and x.cancelled_at is null))
            else s.capacity end
        )) as available
      ) stock
      where t.event_id = e.id and t.active and (t.deadline is null or t.deadline > now())
    ), '[]'::jsonb)
  )
  from public.events e where e.id = p_event and (e.status = 'published' or eventpass_private.owns_event(e.id))
$$;

create function public.sector_seat_map(p_sector uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(m) || jsonb_build_object('seats', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'row_no', a.row_no, 'column_no', a.column_no,
      'kind', a.kind, 'taken', exists (select 1 from public.tickets x
        where x.event_id = a.event_id and x.seat_id = a.id and x.cancelled_at is null)) order by a.row_no, a.column_no)
    from public.event_seats a
    where a.sector_id = m.sector_id and a.row_no <= m.rows and a.column_no <= m.columns
  ), '[]'::jsonb))
  from public.seat_maps m join public.events e on e.id = m.event_id
  where m.sector_id = p_sector and (e.status = 'published' or eventpass_private.owns_event(e.id))
$$;

create function public.save_sector_map(p_event uuid, p_sector uuid, p_rows integer, p_columns integer, p_stage text, p_cells jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode editar este mapa.';
  end if;
  perform 1 from public.events where id = p_event and status <> 'cancelled' for update;
  if not found or not exists (select 1 from public.event_sectors where id = p_sector and event_id = p_event and seated) then
    raise exception 'Selecione um setor configurado com assentos.';
  end if;
  if p_rows is null or p_rows not between 1 and 26 or p_columns is null or p_columns not between 1 and 30
    or p_cells is null or jsonb_typeof(p_cells) <> 'object' then
    raise exception 'Dimensões ou assentos inválidos.';
  end if;
  if exists (
    select 1 from public.tickets t join public.event_seats a on a.id = t.seat_id
    where a.sector_id = p_sector and t.cancelled_at is null and
      (a.row_no > p_rows or a.column_no > p_columns or
        coalesce(p_cells->>(a.row_no || ':' || a.column_no), 'standard') not in ('standard','accessible'))
  ) then
    raise exception 'O novo mapa removeria ou bloquearia um assento já reservado.';
  end if;
  insert into public.seat_maps(sector_id, event_id, rows, columns, stage)
    values (p_sector, p_event, p_rows, p_columns, btrim(p_stage))
    on conflict (sector_id) do update set rows = excluded.rows, columns = excluded.columns, stage = excluded.stage;

  insert into public.event_seats(event_id, sector_id, row_no, column_no, kind)
    select p_event, p_sector, r, c, coalesce(p_cells->>(r || ':' || c), 'standard')
    from generate_series(1, p_rows) r cross join generate_series(1, p_columns) c
    on conflict (sector_id, row_no, column_no) do update set kind = excluded.kind;
  perform eventpass_private.signal_event(p_event);
end;
$$;

create or replace function public.reserve_ticket(p_event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target public.events;
  reservation public.tickets;
begin
  if eventpass_private.user_role() is distinct from 'participant' then
    raise exception using errcode = '42501', message = 'É necessária uma conta de participante para reservar.';
  end if;
  select * into target from public.events where id = p_event for update;
  if not found or target.status <> 'published' then
    raise exception using errcode = '22023', message = 'Este evento não está disponível para inscrições.';
  end if;
  select * into reservation from public.tickets where event_id = p_event and participant_id = auth.uid() and type_id is null;
  if found then
    if reservation.cancelled_at is not null then
      raise exception using errcode = '22023', message = 'Seu ingresso para este evento foi cancelado.';
    end if;
    return to_jsonb(reservation);
  end if;
  if exists (select 1 from public.ticket_types where event_id = p_event) then
    raise exception using errcode = '22023', message = 'Selecione uma modalidade de ingresso.';
  end if;
  if target.starts_at <= now() then
    raise exception using errcode = '22023', message = 'As inscrições para este evento foram encerradas.';
  end if;
  update public.events set issued_count = issued_count + 1, reserved_count = reserved_count + 1
    where id = p_event and reserved_count < capacity;
  if not found then raise exception using errcode = '22023', message = 'Este evento está lotado.'; end if;
  insert into public.tickets (event_id, participant_id) values (p_event, auth.uid()) returning * into reservation;
  return to_jsonb(reservation);
end;
$$;

create function public.reserve_typed_ticket(p_event uuid, p_type uuid, p_seat uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target public.events;
  option public.ticket_types;
  sector public.event_sectors;
  reservation public.tickets;
begin
  if eventpass_private.user_role() is distinct from 'participant' then
    raise exception using errcode = '42501', message = 'É necessária uma conta de participante para reservar.';
  end if;
  select * into target from public.events where id = p_event for update;
  if not found or target.status <> 'published' then raise exception 'Este evento não está disponível para inscrições.'; end if;
  if p_request is null then raise exception 'A solicitação de reserva precisa de um identificador.'; end if;
  select * into reservation from public.tickets where event_id = p_event and participant_id = auth.uid() and request_id = p_request;
  if found then
    if reservation.type_id is distinct from p_type or reservation.seat_id is distinct from p_seat then
      raise exception 'A solicitação já foi usada para outro ingresso.';
    end if;
    return to_jsonb(reservation);
  end if;
  select * into option from public.ticket_types where id = p_type and event_id = p_event and active;
  if not found or target.starts_at <= clock_timestamp() or option.deadline <= clock_timestamp() then
    raise exception 'As inscrições para esta modalidade estão encerradas.';
  end if;
  select * into sector from public.event_sectors where id = option.sector_id;
  if (select count(*) from public.tickets where type_id = p_type and participant_id = auth.uid() and cancelled_at is null) >= option.per_person then
    raise exception 'Você atingiu o limite desta modalidade.';
  end if;
  if sector.seated then
    if not exists (
      select 1 from public.event_seats s join public.seat_maps m on m.sector_id = s.sector_id
      where s.id = p_seat and s.sector_id = sector.id and s.kind in ('standard', 'accessible')
        and s.row_no <= m.rows and s.column_no <= m.columns
    ) then raise exception 'Selecione um assento disponível deste setor.'; end if;
    if exists (select 1 from public.tickets where event_id = p_event and seat_id = p_seat and cancelled_at is null) then
      raise exception 'Este assento foi reservado. Escolha outro lugar.';
    end if;
  elsif p_seat is not null then
    raise exception 'Este setor não tem assentos marcados.';
  end if;

  if target.reserved_count >= target.capacity
    or (select count(*) from public.tickets where event_id = p_event and sector_id = sector.id and cancelled_at is null) >= sector.capacity
    or (select count(*) from public.tickets where type_id = p_type and cancelled_at is null) >= option.capacity then
    raise exception 'Não há vagas disponíveis nesta modalidade.';
  end if;
  insert into public.tickets(event_id, participant_id, type_id, sector_id, seat_id, request_id)
  values (p_event, auth.uid(), p_type, sector.id, p_seat, p_request) returning * into reservation;
  update public.events set issued_count = issued_count + 1, reserved_count = reserved_count + 1 where id = p_event;
  return to_jsonb(reservation);
end;
$$;

create function eventpass_private.ticket_admission(p_ticket public.tickets) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('type_name', coalesce(t.name, 'Geral'), 'color', t.color,
    'sector_name', coalesce(s.name, 'Geral'), 'seat', case when a.id is not null then chr(64 + a.row_no) || a.column_no end)
  from (select 1) base
  left join public.ticket_types t on t.id = p_ticket.type_id
  left join public.event_sectors s on s.id = p_ticket.sector_id
  left join public.event_seats a on a.id = p_ticket.seat_id
$$;
revoke execute on function eventpass_private.ticket_admission(public.tickets) from public, anon, authenticated;

create function public.my_ticket_admissions() returns table (id uuid, details jsonb)
language sql stable security definer set search_path = '' as $$
  select t.id, eventpass_private.ticket_admission(t)
  from public.tickets t where t.participant_id = auth.uid()
  order by t.issued_at desc, t.id
$$;

revoke execute on function public.event_setup(uuid), public.save_event_option(uuid,text,jsonb),
  public.save_sector_map(uuid,uuid,integer,integer,text,jsonb), public.reserve_typed_ticket(uuid,uuid,uuid,uuid),
  public.my_ticket_admissions(), public.event_ticket_options(uuid), public.sector_seat_map(uuid)
  from public, anon, authenticated;
grant execute on function public.event_setup(uuid), public.save_event_option(uuid,text,jsonb),
  public.save_sector_map(uuid,uuid,integer,integer,text,jsonb), public.reserve_typed_ticket(uuid,uuid,uuid,uuid),
  public.my_ticket_admissions() to authenticated;
grant execute on function public.event_ticket_options(uuid), public.sector_seat_map(uuid) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.event_activity;
  end if;
end;
$$;

commit;
