begin;

create table public.certificate_settings (
  event_id uuid primary key references public.events(id) on delete cascade,
  enabled boolean not null,
  event_name text not null check (length(btrim(event_name)) between 3 and 120),
  organizer_name text not null check (length(btrim(organizer_name)) between 2 and 120),
  hours numeric(6,2) not null check (hours > 0 and hours <= 1000),
  event_date date not null check (isfinite(event_date)),
  participation_text text not null check (length(btrim(participation_text)) between 3 and 500),
  logo_url text check (length(logo_url) <= 1200 and logo_url ~ '^(https?://|/images/[a-zA-Z0-9_-]+[.]webp$)'),
  signature_url text check (length(signature_url) <= 1200 and signature_url ~ '^(https?://|/images/[a-zA-Z0-9_-]+[.]webp$)'),
  completes_at timestamptz check (completes_at is null or isfinite(completes_at)),
  completed_at timestamptz
);

create table public.certificate_activities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  required boolean not null default true,
  unique (event_id,name),
  unique (id,event_id)
);

create table public.certificate_activity_presence (
  activity_id uuid not null,
  event_id uuid not null,
  participant_id uuid not null references public.profiles(id) on delete cascade,
  recorded_by uuid not null references public.profiles(id),
  present boolean not null,
  recorded_at timestamptz not null default now(),
  primary key (activity_id, participant_id),
  foreign key (activity_id,event_id) references public.certificate_activities(id,event_id) on delete cascade
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  code uuid not null unique default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.profiles(id) on delete cascade,
  issued_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  details jsonb not null,
  unique (event_id,participant_id)
);

create index certificates_participant on public.certificates(participant_id,issued_at desc);
create index certificate_activities_event on public.certificate_activities(event_id);

alter table public.certificate_settings enable row level security;
alter table public.certificate_activities enable row level security;
alter table public.certificate_activity_presence enable row level security;
alter table public.certificates enable row level security;
revoke all on public.certificate_settings, public.certificate_activities, public.certificate_activity_presence,
  public.certificates from public,anon,authenticated;
grant select on public.certificates to authenticated;
create policy certificate_own_read on public.certificates for select to authenticated
using (participant_id = (select auth.uid()) or eventpass_private.owns_event(event_id)
  or (select eventpass_private.user_role()) = 'admin');

create function public.certificate_setup(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode configurar os certificados deste evento.';
  end if;
  return jsonb_build_object(
    'settings',(select to_jsonb(s) from public.certificate_settings s where event_id = p_event),
    'activities',coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('present_count',(
      select count(*) from public.certificate_activity_presence p where p.activity_id = a.id and p.present)) order by a.name)
      from public.certificate_activities a where a.event_id = p_event),'[]'::jsonb),
    'issued',coalesce((select jsonb_agg(to_jsonb(c) - 'participant_id' order by c.issued_at desc) from public.certificates c
      where c.event_id = p_event),'[]'::jsonb)
  );
end;
$$;

create function public.save_certificate_settings(p_event uuid,p_settings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode configurar os certificados deste evento.';
  end if;
  perform 1 from public.events where id = p_event and status <> 'cancelled' for update;
  if not found then raise exception 'O evento foi cancelado.'; end if;
  insert into public.certificate_settings(event_id,enabled,event_name,organizer_name,hours,event_date,participation_text,
    logo_url,signature_url,completes_at,completed_at)
  values (p_event,(p_settings->>'enabled')::boolean,btrim(p_settings->>'event_name'),btrim(p_settings->>'organizer_name'),
    (p_settings->>'hours')::numeric,(p_settings->>'event_date')::date,btrim(p_settings->>'participation_text'),
    nullif(btrim(p_settings->>'logo_url'),''),nullif(btrim(p_settings->>'signature_url'),''),
    nullif(p_settings->>'completes_at','')::timestamptz,
    case when (p_settings->>'completed')::boolean then clock_timestamp() end)
  on conflict (event_id) do update set enabled = excluded.enabled,event_name = excluded.event_name,
    organizer_name = excluded.organizer_name,hours = excluded.hours,event_date = excluded.event_date,
    participation_text = excluded.participation_text,logo_url = excluded.logo_url,signature_url = excluded.signature_url,
    completes_at = excluded.completes_at,
    completed_at = case when excluded.completed_at is not null
      then coalesce(public.certificate_settings.completed_at,excluded.completed_at) end;
  perform eventpass_private.signal_event(p_event);
end;
$$;

create function public.save_certificate_activity(p_event uuid,p_activity uuid,p_name text,p_required boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode gerenciar estas atividades.';
  end if;
  perform 1 from public.events where id = p_event and status <> 'cancelled' for update;
  if not found then raise exception 'O evento foi cancelado.'; end if;
  if p_activity is null then
    insert into public.certificate_activities(event_id,name,required) values (p_event,btrim(p_name),p_required);
  else
    update public.certificate_activities set name = btrim(p_name),required = p_required
      where id = p_activity and event_id = p_event;
    if not found then raise exception 'Atividade inexistente.'; end if;
  end if;
  perform eventpass_private.signal_event(p_event);
end;
$$;

create function public.record_certificate_activity(p_event uuid,p_activity uuid,p_email text,p_present boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  participant uuid;
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode registrar presença nesta atividade.';
  end if;
  perform 1 from public.events where id = p_event and status = 'published' for update;
  if not found or not exists (select 1 from public.certificate_activities where id = p_activity and event_id = p_event) then
    raise exception 'Atividade indisponível.';
  end if;
  select p.id into participant from public.profiles p
  where lower(p.email) = lower(btrim(p_email)) and exists (
    select 1 from public.tickets t join public.check_ins c on c.ticket_id = t.id
    where t.participant_id = p.id and t.event_id = p_event and t.cancelled_at is null
  );
  if participant is null then raise exception 'A conta precisa de um check-in válido neste evento.'; end if;
  insert into public.certificate_activity_presence(activity_id,event_id,participant_id,recorded_by,present)
    values (p_activity,p_event,participant,auth.uid(),p_present)
  on conflict (activity_id,participant_id) do update set present = excluded.present,
    recorded_by = excluded.recorded_by,recorded_at = clock_timestamp();
  perform eventpass_private.signal_event(p_event);
end;
$$;

create function eventpass_private.certificate_status(p_event uuid,p_participant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.certificate_settings s join public.events e on e.id = s.event_id
      where s.event_id = p_event and s.enabled and e.status = 'published') then 'unavailable'
    when not exists (select 1 from public.tickets t join public.check_ins c on c.ticket_id = t.id
      where t.event_id = p_event and t.participant_id = p_participant and t.cancelled_at is null) then 'checkin'
    when not exists (select 1 from public.certificate_settings where event_id = p_event
      and (completed_at is not null or completes_at <= now())) then 'completion'
    when exists (select 1 from public.certificate_activities a where a.event_id = p_event and a.required and not exists (
      select 1 from public.certificate_activity_presence p where p.activity_id = a.id and p.participant_id = p_participant and p.present))
      then 'activities'
    else 'eligible' end
$$;

create function public.my_certificate_events() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(r order by r.starts_at desc),'[]'::jsonb)
  from (
    select e.id as event_id,e.title,e.starts_at,
      eventpass_private.certificate_status(e.id,auth.uid()) as eligibility,
      to_jsonb(c) - 'participant_id' as certificate
    from public.events e
    left join public.certificates c on c.event_id = e.id and c.participant_id = auth.uid()
    where c.id is not null or (
      exists (select 1 from public.certificate_settings s where s.event_id = e.id and s.enabled)
      and exists (select 1 from public.tickets t where t.event_id = e.id and t.participant_id = auth.uid() and t.cancelled_at is null)
    )
  ) r
$$;

create function public.issue_certificate(p_event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  issued public.certificates;
  template public.certificate_settings;
  eligibility text;
begin
  if eventpass_private.user_role() is distinct from 'participant' then
    raise exception using errcode = '42501', message = 'Apenas participantes podem emitir seus certificados.';
  end if;
  perform 1 from public.events where id = p_event for update;
  select * into issued from public.certificates where event_id = p_event and participant_id = auth.uid();
  if found then
    if issued.revoked_at is not null then raise exception 'Este certificado foi revogado.'; end if;
    return to_jsonb(issued) - 'participant_id';
  end if;
  eligibility := eventpass_private.certificate_status(p_event,auth.uid());
  if eligibility <> 'eligible' then
    raise exception using errcode = '42501', message = 'A inscrição ainda não atende aos requisitos do certificado.';
  end if;
  select * into template from public.certificate_settings where event_id = p_event;
  insert into public.certificates(event_id,participant_id,details)
  values (p_event,auth.uid(),jsonb_build_object(
    'participant_name',(select display_name from public.profiles where id = auth.uid()),
    'event_name',template.event_name,'organizer_name',template.organizer_name,'hours',template.hours,
    'event_date',template.event_date,'participation_text',template.participation_text,
    'logo_url',template.logo_url,'signature_url',template.signature_url
  ))
  returning * into issued;
  return to_jsonb(issued) - 'participant_id';
end;
$$;

create function public.revoke_certificate(p_event uuid,p_certificate uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not eventpass_private.can_review(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode revogar este certificado.';
  end if;
  perform 1 from public.events where id = p_event for update;
  update public.certificates set revoked_at = coalesce(revoked_at,clock_timestamp())
    where id = p_certificate and event_id = p_event;
  if not found then raise exception 'Certificado inexistente neste evento.'; end if;
  perform eventpass_private.signal_event(p_event);
end;
$$;

create function public.verify_certificate(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  found_certificate public.certificates;
begin
  if p_code is null or btrim(p_code) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('status','not_found');
  end if;
  select * into found_certificate from public.certificates where code = btrim(p_code)::uuid;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if found_certificate.revoked_at is not null then return jsonb_build_object('status','revoked'); end if;
  return jsonb_build_object('status','valid','issued_at',found_certificate.issued_at,
    'details',found_certificate.details - 'logo_url' - 'signature_url');
end;
$$;

revoke execute on function eventpass_private.certificate_status(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.certificate_setup(uuid), public.save_certificate_settings(uuid,jsonb),
  public.save_certificate_activity(uuid,uuid,text,boolean),public.record_certificate_activity(uuid,uuid,text,boolean),
  public.my_certificate_events(),public.issue_certificate(uuid),public.revoke_certificate(uuid,uuid),public.verify_certificate(text)
  from public,anon,authenticated;
grant execute on function public.certificate_setup(uuid), public.save_certificate_settings(uuid,jsonb),
  public.save_certificate_activity(uuid,uuid,text,boolean),public.record_certificate_activity(uuid,uuid,text,boolean),
  public.my_certificate_events(),public.issue_certificate(uuid),public.revoke_certificate(uuid,uuid) to authenticated;
grant execute on function public.verify_certificate(text) to anon,authenticated;

commit;
