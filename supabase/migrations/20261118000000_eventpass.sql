begin;

create schema if not exists eventpass_private;
revoke all on schema eventpass_private from public;
grant usage on schema eventpass_private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  role text not null default 'participant' check (role in ('participant', 'organizer', 'admin')),
  created_at timestamptz not null default now()
);

create index profiles_email_lookup on public.profiles (lower(email));

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  title text not null check (length(btrim(title)) between 3 and 100),
  description text not null check (length(btrim(description)) between 10 and 2000),
  category text not null check (category in ('Música', 'Tecnologia', 'Gastronomia', 'Cultura', 'Educação', 'Negócios', 'Outros')),
  cover_url text check (length(cover_url) <= 1200 and cover_url ~ '^(https?://|/images/[a-zA-Z0-9_-]+[.]webp$)'),
  starts_at timestamptz not null,
  venue text not null check (length(btrim(venue)) between 3 and 160),
  city text not null check (length(btrim(city)) between 2 and 100),
  capacity integer not null check (capacity between 1 and 100000),
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  is_demo boolean not null default false,
  issued_count integer not null default 0,
  reserved_count integer not null default 0,
  present_count integer not null default 0,
  created_at timestamptz not null default now(),
  check (issued_count >= reserved_count and reserved_count <= capacity and present_count between 0 and reserved_count)
);

create index events_catalogue on public.events (starts_at, id) where status = 'published';
create index events_owner on public.events (owner_id, starts_at desc, id);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  participant_id uuid not null references public.profiles(id),
  code uuid not null unique default gen_random_uuid(),
  issued_at timestamptz not null default now(),
  cancelled_at timestamptz,
  checked_in_at timestamptz,
  unique (event_id, participant_id),
  unique (id, event_id),
  check (cancelled_at is null or checked_in_at is null)
);

create index tickets_participant on public.tickets (participant_id, issued_at desc);
create index tickets_issued on public.tickets (event_id, issued_at desc);

create table public.event_staff (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_staff_user on public.event_staff (user_id, event_id);

create table public.check_ins (
  ticket_id uuid primary key,
  event_id uuid not null,
  validated_by uuid not null references public.profiles(id),
  checked_in_at timestamptz not null,
  foreign key (ticket_id, event_id) references public.tickets(id, event_id)
);

create index check_ins_recent on public.check_ins (event_id, checked_in_at desc);

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.tickets enable row level security;
alter table public.event_staff enable row level security;
alter table public.check_ins enable row level security;

revoke all on public.profiles, public.events, public.tickets, public.event_staff, public.check_ins from anon, authenticated;
grant select on public.events to anon, authenticated;
grant select on public.profiles, public.tickets, public.event_staff, public.check_ins to authenticated;

create function eventpass_private.sync_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'), 100), ''),
             nullif(left(split_part(new.email, '@', 1), 100), ''), 'Participante')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger eventpass_sync_profile
after insert or update of email on auth.users
for each row execute function eventpass_private.sync_profile();

insert into public.profiles (id, email, display_name)
select id, coalesce(email, ''),
       coalesce(nullif(left(btrim(raw_user_meta_data ->> 'display_name'), 100), ''),
                nullif(left(split_part(email, '@', 1), 100), ''), 'Participante')
from auth.users on conflict (id) do nothing;

create function eventpass_private.user_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create function eventpass_private.owns_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.events where id = p_event and owner_id = auth.uid()
      and eventpass_private.user_role() = 'organizer'
  )
$$;

create function eventpass_private.staffs_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_staff where event_id = p_event and user_id = auth.uid())
$$;

create function eventpass_private.holds_ticket(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tickets where event_id = p_event and participant_id = auth.uid())
$$;

revoke all on all functions in schema eventpass_private from public;
grant execute on function eventpass_private.user_role(), eventpass_private.owns_event(uuid),
  eventpass_private.staffs_event(uuid), eventpass_private.holds_ticket(uuid) to authenticated;

create policy profiles_self_or_admin on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select eventpass_private.user_role()) = 'admin');

create policy events_public on public.events for select to anon, authenticated
using (status = 'published');

create policy events_member on public.events for select to authenticated
using (
  eventpass_private.owns_event(id) or eventpass_private.staffs_event(id)
  or eventpass_private.holds_ticket(id) or (select eventpass_private.user_role()) = 'admin'
);

create policy tickets_self on public.tickets for select to authenticated
using (participant_id = (select auth.uid()));

create policy event_staff_self_or_owner on public.event_staff for select to authenticated
using (user_id = (select auth.uid()) or eventpass_private.owns_event(event_id));

create policy check_ins_authorized on public.check_ins for select to authenticated
using (eventpass_private.owns_event(event_id) or eventpass_private.staffs_event(event_id)
  or (select eventpass_private.user_role()) = 'admin');

create function public.create_event(
  p_title text, p_description text, p_category text, p_cover_url text,
  p_starts_at timestamptz, p_venue text, p_city text, p_capacity integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  new_event public.events;
begin
  if eventpass_private.user_role() is distinct from 'organizer' then
    raise exception using errcode = '42501', message = 'Apenas organizadores podem criar eventos.';
  end if;
  if p_starts_at is null or not isfinite(p_starts_at) or p_starts_at <= now() then
    raise exception using errcode = '22023', message = 'Escolha uma data futura.';
  end if;
  insert into public.events (owner_id, title, description, category, cover_url, starts_at, venue, city, capacity)
  values (auth.uid(), btrim(p_title), btrim(p_description), p_category, nullif(btrim(p_cover_url), ''),
    p_starts_at, btrim(p_venue), btrim(p_city), p_capacity)
  returning * into new_event;
  return to_jsonb(new_event);
end;
$$;

create function public.set_event_status(p_event uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target public.events;
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode gerenciar este evento.';
  end if;
  select * into target from public.events where id = p_event for update;
  if target.status = p_status and p_status in ('published', 'cancelled') then
    return to_jsonb(target);
  end if;
  if (p_status = 'published' and target.status = 'draft' and target.starts_at > now())
     or (p_status = 'cancelled' and target.status in ('draft', 'published')) then
    update public.events set status = p_status where id = p_event returning * into target;
    return to_jsonb(target);
  end if;
  raise exception using errcode = '22023', message = 'Não foi possível alterar o status desse evento.';
end;
$$;

create function public.reserve_ticket(p_event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target public.events;
  reservation public.tickets;
begin
  if eventpass_private.user_role() is distinct from 'participant' then
    raise exception using errcode = '42501', message = 'É necessária uma conta de participante para reservar.';
  end if;

  -- O bloqueio da linha do evento serializa reservas, cancelamentos e check-ins.
  select * into target from public.events where id = p_event for update;
  if not found or target.status <> 'published' then
    raise exception using errcode = '22023', message = 'Este evento não está disponível para inscrições.';
  end if;
  select * into reservation from public.tickets where event_id = p_event and participant_id = auth.uid();
  if found then
    if reservation.cancelled_at is not null then
      raise exception using errcode = '22023', message = 'Seu ingresso para este evento foi cancelado.';
    end if;
    return to_jsonb(reservation);
  end if;
  if target.starts_at <= now() then
    raise exception using errcode = '22023', message = 'As inscrições para este evento foram encerradas.';
  end if;
  update public.events set issued_count = issued_count + 1, reserved_count = reserved_count + 1
    where id = p_event and reserved_count < capacity;
  if not found then
    raise exception using errcode = '22023', message = 'Este evento está lotado.';
  end if;
  insert into public.tickets (event_id, participant_id) values (p_event, auth.uid()) returning * into reservation;
  return to_jsonb(reservation);
end;
$$;

create function public.cancel_ticket(p_event uuid, p_ticket uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode gerenciar este evento.';
  end if;
  perform 1 from public.events where id = p_event for update;
  update public.tickets set cancelled_at = clock_timestamp()
    where id = p_ticket and event_id = p_event and cancelled_at is null and checked_in_at is null;
  if not found then
    raise exception using errcode = '22023', message = 'Apenas ingressos ativos e sem check-in podem ser cancelados.';
  end if;
  update public.events set reserved_count = reserved_count - 1 where id = p_event;
end;
$$;

create function public.list_checkin_events() returns setof public.events
language sql stable security definer set search_path = '' as $$
  select * from public.events
  where status = 'published'
    and (eventpass_private.owns_event(id) or eventpass_private.staffs_event(id))
  order by starts_at, id
$$;

create function public.validate_ticket(p_event uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target public.events;
  admission public.tickets;
  entry_time timestamptz;
begin
  if not (eventpass_private.owns_event(p_event) or eventpass_private.staffs_event(p_event)) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select * into target from public.events where id = p_event for update;
  -- Uma revogação de funcionário usa a mesma trava da validação.
  if not (eventpass_private.owns_event(p_event) or eventpass_private.staffs_event(p_event)) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if target.status = 'draft' then
    return jsonb_build_object('status', 'event_unavailable');
  end if;
  if p_code is null or btrim(p_code) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into admission from public.tickets where code = btrim(p_code)::uuid;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if admission.event_id <> p_event then
    return jsonb_build_object('status', 'wrong_event');
  end if;
  if target.status = 'cancelled' or admission.cancelled_at is not null then
    return jsonb_build_object('status', 'cancelled');
  end if;
  if admission.checked_in_at is not null then
    return jsonb_build_object('status', 'used', 'checked_in_at', admission.checked_in_at);
  end if;

  entry_time := clock_timestamp();
  update public.tickets set checked_in_at = entry_time where id = admission.id;
  insert into public.check_ins (ticket_id, event_id, validated_by, checked_in_at)
    values (admission.id, p_event, auth.uid(), entry_time);
  update public.events set present_count = present_count + 1 where id = p_event;
  return jsonb_build_object('status', 'valid', 'checked_in_at', entry_time);
end;
$$;

create function public.assign_event_staff(p_event uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  member uuid;
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode gerenciar esta equipe.';
  end if;
  perform 1 from public.events where id = p_event for update;
  select p.id into member
  from public.profiles p join auth.users u on u.id = p.id
  where lower(p.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null
  limit 1;
  if member is null or member = auth.uid() then
    raise exception using errcode = '22023', message = 'Informe o e-mail confirmado de outra conta EventPass.';
  end if;
  insert into public.event_staff (event_id, user_id) values (p_event, member) on conflict do nothing;
end;
$$;

create function public.remove_event_staff(p_event uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode gerenciar esta equipe.';
  end if;
  perform 1 from public.events where id = p_event for update;
  delete from public.event_staff where event_id = p_event and user_id = p_user;
end;
$$;

create function public.event_team(p_event uuid)
returns table (id uuid, display_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode consultar esta equipe.';
  end if;
  return query select p.id, p.display_name, p.email from public.event_staff s
    join public.profiles p on p.id = s.user_id where s.event_id = p_event
    order by p.display_name, p.id;
end;
$$;

create function public.event_roster(p_event uuid)
returns table (
  id uuid, display_name text, email text, issued_at timestamptz,
  cancelled_at timestamptz, checked_in_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode consultar os inscritos deste evento.';
  end if;
  return query
    select t.id, p.display_name, p.email, t.issued_at, t.cancelled_at, t.checked_in_at
    from public.tickets t join public.profiles p on p.id = t.participant_id
    where t.event_id = p_event order by t.issued_at desc, t.id;
end;
$$;

create function public.dashboard_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_role text := eventpass_private.user_role();
  snapshot jsonb;
begin
  if viewer_role is null or viewer_role not in ('organizer', 'admin') then
    raise exception using errcode = '42501', message = 'Você não pode acessar este painel.';
  end if;
  with scoped_events as (
    select e.* from public.events e where viewer_role = 'admin' or e.owner_id = auth.uid()
  ),
  activity as (
    select t.id, 'issued' as kind, t.issued_at as happened_at, e.title as event_title, p.display_name
    from scoped_events e join public.tickets t on t.event_id = e.id join public.profiles p on p.id = t.participant_id
    union all
    select t.id, 'checked_in', c.checked_in_at, e.title, p.display_name
    from scoped_events e join public.check_ins c on c.event_id = e.id
    join public.tickets t on t.id = c.ticket_id join public.profiles p on p.id = t.participant_id
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'events', count(*),
        'issued', coalesce(sum(issued_count), 0),
        'present', coalesce(sum(present_count) filter (where status = 'published'), 0),
        'reserved', coalesce(sum(reserved_count) filter (where status = 'published'), 0),
        'capacity', coalesce(sum(capacity) filter (where status = 'published'), 0)
      ) from scoped_events
    ),
    'accounts', case when viewer_role = 'admin' then (
      select jsonb_build_object('total', count(*), 'organizers', count(*) filter (where role = 'organizer'))
      from public.profiles
    ) end,
    'chart', coalesce((
      select jsonb_agg(event_row order by event_row.starts_at, event_row.id)
      from (select id, title, starts_at, capacity, reserved_count, present_count
        from scoped_events where status = 'published' order by starts_at desc, id limit 8) event_row
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(recent order by recent.happened_at desc, recent.id, recent.kind)
      from (select * from activity order by happened_at desc, id, kind limit 10) recent
    ), '[]'::jsonb)
  ) into snapshot;
  return snapshot;
end;
$$;

revoke execute on function public.create_event(text, text, text, text, timestamptz, text, text, integer),
  public.set_event_status(uuid, text), public.reserve_ticket(uuid), public.cancel_ticket(uuid, uuid),
  public.list_checkin_events(), public.validate_ticket(uuid, text),
  public.assign_event_staff(uuid, text), public.remove_event_staff(uuid, uuid),
  public.event_team(uuid), public.event_roster(uuid), public.dashboard_snapshot()
  from public, anon;
grant execute on function public.create_event(text, text, text, text, timestamptz, text, text, integer),
  public.set_event_status(uuid, text), public.reserve_ticket(uuid), public.cancel_ticket(uuid, uuid),
  public.list_checkin_events(), public.validate_ticket(uuid, text),
  public.assign_event_staff(uuid, text), public.remove_event_staff(uuid, uuid),
  public.event_team(uuid), public.event_roster(uuid), public.dashboard_snapshot()
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-covers', 'event-covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

create policy eventpass_cover_upload on storage.objects for insert to authenticated
with check (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select eventpass_private.user_role()) = 'organizer');

create policy eventpass_cover_owner_read on storage.objects for select to authenticated
using (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select eventpass_private.user_role()) = 'organizer');

create policy eventpass_cover_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'event-covers' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select eventpass_private.user_role()) = 'organizer');

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
end;
$$;

commit;
