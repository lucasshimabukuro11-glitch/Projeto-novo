begin;

create table public.security_limits (
  scope uuid primary key,
  reuse integer not null check (reuse between 2 and 1000),
  invalid_streak integer not null check (invalid_streak between 2 and 1000),
  wrong_sector integer not null check (wrong_sector between 2 and 1000),
  staff_rate integer not null check (staff_rate between 5 and 2000),
  max_per_minute integer not null check (max_per_minute between 60 and 2000 and max_per_minute >= staff_rate)
);

insert into public.security_limits(scope, reuse, invalid_streak, wrong_sector, staff_rate, max_per_minute)
values ('00000000-0000-0000-0000-000000000000', 3, 5, 4, 90, 240);

create table public.validation_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  gate_id uuid,
  staff_id uuid references public.profiles(id) on delete set null,
  result text not null check (result in ('valid','used','cancelled','not_found','wrong_sector','wrong_event',
    'forbidden','event_unavailable','gate_required','rate_limited')),
  happened_at timestamptz not null default clock_timestamp(),
  occurrences integer not null default 1 check (occurrences > 0),
  foreign key (gate_id,event_id) references public.event_gates(id,event_id) on delete set null (gate_id)
);

create index validation_event_recent on public.validation_attempts(event_id, happened_at desc, id);
create index validation_gate_recent on public.validation_attempts(event_id, gate_id, happened_at desc);
create index validation_staff_rate on public.validation_attempts(event_id, staff_id, happened_at desc);
create index validation_recent on public.validation_attempts(happened_at desc, id);

alter table public.security_limits enable row level security;
alter table public.validation_attempts enable row level security;
revoke all on public.security_limits, public.validation_attempts from public, anon, authenticated;

-- A primeira versão só guardava entradas bem-sucedidas.
insert into public.validation_attempts(event_id, ticket_id, staff_id, result, happened_at)
select event_id, ticket_id, validated_by, 'valid', checked_in_at from public.check_ins;

create function eventpass_private.can_review(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(eventpass_private.user_role() = 'admin',false) or eventpass_private.owns_event(p_event)
$$;

create function eventpass_private.can_use_gate(p_event uuid, p_gate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.event_gates g where g.id = p_gate and g.event_id = p_event and
      (eventpass_private.owns_event(p_event) or exists (
        select 1 from public.gate_staff m where m.gate_id = g.id and m.user_id = auth.uid() and m.enabled
      ))
  )
$$;

create function eventpass_private.effective_limits(p_event uuid) returns public.security_limits
language sql stable security definer set search_path = '' as $$
  select l from public.security_limits l
  where l.scope in (p_event,'00000000-0000-0000-0000-000000000000')
  order by (l.scope = '00000000-0000-0000-0000-000000000000') limit 1
$$;

create function public.get_security_limits(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not eventpass_private.can_review(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode consultar estes limites.';
  end if;
  return to_jsonb(eventpass_private.effective_limits(p_event)) - 'scope';
end;
$$;

create function public.save_security_limits(p_event uuid, p_limits jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not eventpass_private.can_review(p_event) or (p_event is not null and not exists (select 1 from public.events where id = p_event)) then
    raise exception using errcode = '42501', message = 'Você não pode alterar estes limites.';
  end if;
  insert into public.security_limits(scope,reuse,invalid_streak,wrong_sector,staff_rate,max_per_minute)
  values (coalesce(p_event,'00000000-0000-0000-0000-000000000000'),
    (p_limits->>'reuse')::integer, (p_limits->>'invalid_streak')::integer, (p_limits->>'wrong_sector')::integer,
    (p_limits->>'staff_rate')::integer, (p_limits->>'max_per_minute')::integer)
  on conflict (scope) do update set reuse = excluded.reuse, invalid_streak = excluded.invalid_streak,
    wrong_sector = excluded.wrong_sector, staff_rate = excluded.staff_rate, max_per_minute = excluded.max_per_minute;
  if p_event is not null then perform eventpass_private.signal_event(p_event); end if;
end;
$$;

create function public.checkin_gate_options(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (eventpass_private.owns_event(p_event) or eventpass_private.staffs_event(p_event)) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este evento.';
  end if;
  return jsonb_build_object('required', exists (select 1 from public.event_gates where event_id = p_event),
    'gates', coalesce((select jsonb_agg(to_jsonb(g) order by g.name)
      from public.event_gates g where g.event_id = p_event and eventpass_private.can_use_gate(p_event,g.id)), '[]'::jsonb));
end;
$$;

create function eventpass_private.log_validation(
  p_event uuid, p_gate uuid, p_ticket uuid, p_result text, p_time timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  previous uuid;
begin
  -- Rejeições por limite compartilham uma linha de contagem por janela e portaria.
  if p_result = 'rate_limited' then
    select id into previous from public.validation_attempts
    where event_id = p_event and staff_id = auth.uid() and gate_id is not distinct from p_gate
      and result = p_result and happened_at > p_time - interval '1 minute'
    order by happened_at desc limit 1;
    if found then
      update public.validation_attempts set occurrences = occurrences + 1 where id = previous;
      return;
    end if;
  end if;
  insert into public.validation_attempts(event_id,gate_id,ticket_id,staff_id,result,happened_at)
  values (p_event,p_gate,p_ticket,auth.uid(),p_result,p_time);
  perform eventpass_private.signal_event(p_event);
end;
$$;

create function public.validate_at_gate(p_event uuid, p_code text, p_gate uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target public.events;
  admission public.tickets;
  doorway public.event_gates;
  entry_time timestamptz;
  outcome text;
  details jsonb := '{}'::jsonb;
  maximum integer;
  allowed boolean;
begin
  select * into target from public.events where id = p_event for update;
  if not found then return jsonb_build_object('status','forbidden'); end if;
  entry_time := clock_timestamp();
  maximum := (eventpass_private.effective_limits(p_event)).max_per_minute;
  allowed := eventpass_private.owns_event(p_event) or eventpass_private.staffs_event(p_event);
  if allowed and p_gate is not null and eventpass_private.can_use_gate(p_event,p_gate) then
    select * into doorway from public.event_gates where id = p_gate;
  end if;

  if (select count(*) from public.validation_attempts a where a.event_id = p_event and a.staff_id = auth.uid()
      and a.happened_at > entry_time - interval '1 minute' and a.result <> 'rate_limited') >= maximum then
    outcome := 'rate_limited';
  elsif not allowed or (p_gate is not null and doorway.id is null) then
    outcome := 'forbidden';
  elsif target.status = 'draft' then
    outcome := 'event_unavailable';
  elsif p_gate is null and exists (select 1 from public.event_gates where event_id = p_event) then
    outcome := 'gate_required';
  elsif p_code is null or btrim(p_code) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    outcome := 'not_found';
  else
    select * into admission from public.tickets where code = btrim(p_code)::uuid;
    if not found then outcome := 'not_found';
    elsif admission.event_id <> p_event then
      admission.id := null;
      outcome := 'wrong_event';
    else
      details := eventpass_private.ticket_admission(admission) || jsonb_build_object(
        'participant_name', (select display_name from public.profiles where id = admission.participant_id),
        'event_title', target.title);
      if target.status = 'cancelled' or admission.cancelled_at is not null then outcome := 'cancelled';
      elsif doorway.sector_id is distinct from admission.sector_id then outcome := 'wrong_sector';
      elsif admission.checked_in_at is not null then
        outcome := 'used';
        details := details || jsonb_build_object('checked_in_at',admission.checked_in_at);
      else
        update public.tickets set checked_in_at = entry_time where id = admission.id;
        insert into public.check_ins(ticket_id,event_id,validated_by,checked_in_at)
          values (admission.id,p_event,auth.uid(),entry_time);
        update public.events set present_count = present_count + 1 where id = p_event;
        outcome := 'valid';
        details := details || jsonb_build_object('checked_in_at',entry_time);
      end if;
    end if;
  end if;

  perform eventpass_private.log_validation(p_event,doorway.id,admission.id,outcome,entry_time);
  return details || jsonb_build_object('status',outcome);
end;
$$;

create or replace function public.validate_ticket(p_event uuid, p_code text) returns jsonb
language sql security definer set search_path = '' as $$
  select public.validate_at_gate(p_event, p_code, null)
$$;

create function public.validation_audit(p_event uuid, p_gate uuid, p_result text,
  p_from timestamptz, p_until timestamptz, p_offset integer, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_role text := eventpass_private.user_role();
  output jsonb;
begin
  if viewer_role is null or viewer_role not in ('organizer','admin')
    or (p_event is not null and not eventpass_private.can_review(p_event)) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este histórico.';
  end if;
  with filtered as (
    select a.id,a.event_id,a.ticket_id,a.gate_id,a.result,a.happened_at,a.occurrences,
      e.title as event_title,g.name as gate_name,p.display_name as staff_name
    from public.validation_attempts a join public.events e on e.id = a.event_id
    left join public.event_gates g on g.id = a.gate_id
    left join public.profiles p on p.id = a.staff_id
    where (viewer_role = 'admin' or e.owner_id = auth.uid())
      and (p_event is null or a.event_id = p_event)
      and (p_gate is null or a.gate_id = p_gate)
      and (p_result is null or a.result = p_result)
      and (p_from is null or a.happened_at >= p_from)
      and (p_until is null or a.happened_at <= p_until)
  )
  select jsonb_build_object(
    'total',(select count(*) from filtered),
    'occurrences',coalesce((select sum(occurrences) from filtered),0),
    'rows',coalesce((select jsonb_agg(q order by q.happened_at desc,q.id)
      from (select * from filtered order by happened_at desc,id
        offset greatest(0,p_offset) limit least(200,greatest(1,p_limit))) q),'[]'::jsonb)
  ) into output;
  return output;
end;
$$;

create function public.audit_gates() returns table (id uuid, event_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select g.id,g.event_id,g.name from public.event_gates g where eventpass_private.can_review(g.event_id)
  order by g.name,g.id
$$;

create function public.gate_monitor(p_event uuid,p_gate uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  output jsonb;
begin
  if not eventpass_private.can_review(p_event) and not eventpass_private.can_use_gate(p_event,p_gate) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a esta portaria.';
  end if;
  with filtered as (select result,happened_at,occurrences from public.validation_attempts
    where event_id = p_event and gate_id is not distinct from p_gate)
  select jsonb_build_object(
    'allowed',coalesce((select sum(occurrences) from filtered where result = 'valid'),0),
    'denied',coalesce((select sum(occurrences) from filtered where result <> 'valid'),0),
    'recent',coalesce((select jsonb_agg(q order by q.happened_at desc)
      from (select * from filtered order by happened_at desc limit 6) q),'[]'::jsonb)
  ) into output;
  return output;
end;
$$;

create function public.event_monitor(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  target public.events;
  limits public.security_limits;
  output jsonb;
begin
  if not eventpass_private.can_review(p_event) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este painel.';
  end if;
  select * into target from public.events where id = p_event;
  if not found then raise exception 'Evento inexistente.'; end if;
  limits := eventpass_private.effective_limits(p_event);

  with totals as (
    select coalesce(sum(occurrences) filter (where result <> 'valid'),0) as denied,
      coalesce(sum(occurrences) filter (where result = 'used'),0) as reused,
      coalesce(sum(occurrences) filter (where result = 'valid' and happened_at > now() - interval '1 minute'),0) as per_minute
    from public.validation_attempts where event_id = p_event
  ), sale_capacity as (
    select sector_id, least(max(sector_available),sum(available)) as open_seats
    from jsonb_to_recordset(public.event_ticket_options(p_event)->'options')
      as options(sector_id uuid, sector_available bigint, available bigint)
    group by sector_id
  ), sector_rows as (
    select s.name, s.capacity, count(t.id) filter (where t.cancelled_at is null) as reserved,
      count(t.checked_in_at) as present
    from public.event_sectors s left join public.tickets t on t.sector_id = s.id
    where s.event_id = p_event group by s.id
  ), type_rows as (
    select coalesce(o.name,'Geral') as name,count(*) as issued
    from public.tickets t left join public.ticket_types o on o.id = t.type_id
    where t.event_id = p_event group by o.name
  ), gate_rows as (
    select g.id,g.name, public.gate_monitor(p_event,g.id) as activity from public.event_gates g where g.event_id = p_event
    union all
    select null,'Entrada geral',public.gate_monitor(p_event,null)
      where exists (select 1 from public.validation_attempts where event_id = p_event and gate_id is null)
        or not exists (select 1 from public.event_gates where event_id = p_event)
  ), by_hour as (
    select date_trunc('hour',happened_at) as hour,sum(occurrences) filter (where result = 'valid') as allowed,
      sum(occurrences) filter (where result <> 'valid') as denied
    from public.validation_attempts where event_id = p_event and happened_at > now() - interval '24 hours'
    group by 1
  ), ranked as (
    select staff_id,result,happened_at,occurrences,
      count(*) filter (where result <> 'not_found') over (partition by staff_id order by happened_at desc,id rows unbounded preceding) as breaks
    from public.validation_attempts where event_id = p_event and happened_at > now() - interval '5 minutes'
      and staff_id is not null and result <> 'rate_limited'
  ), actor_counts as (
    select staff_id,
      coalesce(sum(occurrences) filter (where result = 'used'),0) as reuse,
      coalesce(sum(occurrences) filter (where result = 'not_found' and breaks = 0),0) as invalid_streak,
      coalesce(sum(occurrences) filter (where result = 'wrong_sector'),0) as wrong_sector,
      coalesce(sum(occurrences) filter (where happened_at > now() - interval '1 minute'),0) as staff_rate
    from ranked group by staff_id
  ), alert_rows as (
    select p.display_name as staff_name, r.kind,r.amount
    from actor_counts c join public.profiles p on p.id = c.staff_id
    cross join lateral (values ('reuse',c.reuse,limits.reuse),('invalid_streak',c.invalid_streak,limits.invalid_streak),
      ('wrong_sector',c.wrong_sector,limits.wrong_sector),('staff_rate',c.staff_rate,limits.staff_rate)) r(kind,amount,threshold)
    where r.amount >= r.threshold
  )
  select jsonb_build_object(
    'issued',target.issued_count,'present',target.present_count,'absent',target.reserved_count-target.present_count,
    'available',case
      when target.status <> 'published' or target.starts_at <= now() then 0
      when exists (select 1 from public.ticket_types t where t.event_id = p_event) then
        least(target.capacity-target.reserved_count,coalesce((select sum(open_seats) from sale_capacity),0))
      else target.capacity-target.reserved_count end,
    'denied',totals.denied,'reused',totals.reused,'per_minute',totals.per_minute,
    'sectors',coalesce((select jsonb_agg(s order by s.name) from sector_rows s),'[]'::jsonb),
    'types',coalesce((select jsonb_agg(t order by t.name) from type_rows t),'[]'::jsonb),
    'gates',coalesce((select jsonb_agg(g order by g.name) from gate_rows g),'[]'::jsonb),
    'hours',coalesce((select jsonb_agg(h order by h.hour) from by_hour h),'[]'::jsonb),
    'alerts',coalesce((select jsonb_agg(a order by a.amount desc) from alert_rows a),'[]'::jsonb)
  ) into output from totals;
  return output;
end;
$$;

revoke execute on function eventpass_private.can_review(uuid), eventpass_private.can_use_gate(uuid,uuid),
  eventpass_private.effective_limits(uuid), eventpass_private.log_validation(uuid,uuid,uuid,text,timestamptz)
  from public,anon,authenticated;
revoke execute on function public.get_security_limits(uuid), public.save_security_limits(uuid,jsonb),
  public.checkin_gate_options(uuid), public.validate_at_gate(uuid,text,uuid), public.audit_gates(),
  public.validation_audit(uuid,uuid,text,timestamptz,timestamptz,integer,integer), public.event_monitor(uuid), public.gate_monitor(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_security_limits(uuid), public.save_security_limits(uuid,jsonb),
  public.checkin_gate_options(uuid), public.validate_at_gate(uuid,text,uuid), public.audit_gates(),
  public.validation_audit(uuid,uuid,text,timestamptz,timestamptz,integer,integer), public.event_monitor(uuid), public.gate_monitor(uuid,uuid)
  to authenticated;

commit;
