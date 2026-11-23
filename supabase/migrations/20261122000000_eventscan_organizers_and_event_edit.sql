begin;

create table public.organizer_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  organization_name text not null check (length(btrim(organization_name)) between 2 and 120),
  contact_email text not null check (length(contact_email) between 3 and 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  city text not null check (length(btrim(city)) between 2 and 100),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  )
);

create unique index organizer_applications_active
on public.organizer_applications(applicant_id) where status in ('pending', 'approved');

create index organizer_applications_history
on public.organizer_applications(applicant_id, requested_at desc, id);

create index organizer_applications_queue
on public.organizer_applications(status, requested_at desc, id);

alter table public.organizer_applications enable row level security;
revoke all on public.organizer_applications from public, anon, authenticated;
grant select on public.organizer_applications to authenticated;

create policy organizer_applications_self_or_admin
on public.organizer_applications for select to authenticated
using (applicant_id = (select auth.uid()) or (select eventpass_private.user_role()) = 'admin');

create function public.request_organizer(p_organization_name text, p_contact_email text, p_city text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  requester public.profiles;
  existing public.organizer_applications;
  submitted public.organizer_applications;
  organization text := btrim(p_organization_name);
  contact text := lower(btrim(p_contact_email));
  location text := btrim(p_city);
begin
  select * into requester from public.profiles where id = auth.uid() for update;
  if requester.role is distinct from 'participant' then
    raise exception using errcode = '42501', message = 'Apenas participantes podem solicitar o perfil de organizador.';
  end if;

  select * into existing from public.organizer_applications
    where applicant_id = requester.id and status in ('pending', 'approved');
  if found then return to_jsonb(existing); end if;

  if organization is null or length(organization) not between 2 and 120
     or location is null or length(location) not between 2 and 100
     or contact is null or length(contact) > 254 or contact !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Informe o nome da organização, um e-mail válido e a cidade.';
  end if;
  insert into public.organizer_applications(applicant_id, organization_name, contact_email, city)
    values (requester.id, organization, contact, location)
    returning * into submitted;
  return to_jsonb(submitted);
end;
$$;

create function public.review_organizer_application(p_application uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  requester public.profiles;
  application public.organizer_applications;
  requester_id uuid;
begin
  if eventpass_private.user_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Apenas administradores podem revisar solicitações.';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Escolha uma decisão válida.';
  end if;

  select applicant_id into requester_id from public.organizer_applications where id = p_application;
  -- O perfil é a trava compartilhada entre solicitação e revisão.
  select * into requester from public.profiles where id = requester_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Solicitação indisponível.';
  end if;

  select * into application from public.organizer_applications where id = p_application for update;
  if application.status = p_decision then return to_jsonb(application); end if;
  if application.status <> 'pending' then
    raise exception using errcode = '22023', message = 'Esta solicitação já foi revisada.';
  end if;
  if p_decision = 'approved' and requester.role <> 'participant' then
    raise exception using errcode = '22023', message = 'O solicitante já possui outro perfil.';
  end if;

  update public.organizer_applications
    set status = p_decision, reviewed_at = clock_timestamp(), reviewed_by = auth.uid()
    where id = p_application
    returning * into application;
  if p_decision = 'approved' then
    update public.profiles set role = 'organizer' where id = requester.id;
  end if;
  return to_jsonb(application);
end;
$$;

alter table public.events add column details_revision integer not null default 0;

create function public.update_event(
  p_event uuid, p_revision integer,
  p_title text, p_description text, p_category text, p_cover_url text,
  p_starts_at timestamptz, p_venue text, p_city text, p_capacity integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.events;
  allocated_capacity bigint;
begin
  if not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode editar este evento.';
  end if;

  -- Reservas e mudanças de setores também bloqueiam a linha do evento.
  select * into target from public.events where id = p_event for update;
  if target.status = 'cancelled' then
    raise exception using errcode = '22023', message = 'Eventos cancelados permanecem no histórico.';
  end if;
  if target.details_revision is distinct from p_revision then
    raise exception using errcode = '22023', message = 'Os dados do evento mudaram. Atualize a página antes de editar novamente.';
  end if;
  if p_starts_at is null or not isfinite(p_starts_at) or (p_starts_at <> target.starts_at and p_starts_at <= now()) then
    raise exception using errcode = '22023', message = 'Escolha uma data futura para alterar o horário do evento.';
  end if;

  select coalesce(sum(capacity), 0) into allocated_capacity from public.event_sectors where event_id = p_event;
  if p_capacity is null or p_capacity < greatest(1, target.reserved_count, allocated_capacity) or p_capacity > 100000 then
    raise exception using errcode = '22023', message = 'A capacidade precisa cobrir as reservas ativas e as vagas dos setores.';
  end if;
  update public.events set title = btrim(p_title), description = btrim(p_description), category = p_category,
    cover_url = nullif(btrim(p_cover_url), ''), starts_at = p_starts_at, venue = btrim(p_venue), city = btrim(p_city),
    capacity = p_capacity, details_revision = details_revision + 1
  where id = p_event returning * into target;
  return to_jsonb(target);
end;
$$;

-- A aprovação de organizador mantém a elegibilidade dos ingressos anteriores.
create or replace function public.issue_certificate(p_event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  issued public.certificates;
  template public.certificate_settings;
  eligibility text;
begin
  if eventpass_private.user_role() is null then
    raise exception using errcode = '42501', message = 'Entre na sua conta para emitir certificados.';
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

revoke execute on function
  public.request_organizer(text, text, text), public.review_organizer_application(uuid, text),
  public.update_event(uuid, integer, text, text, text, text, timestamptz, text, text, integer)
from public, anon, authenticated;

grant execute on function
  public.request_organizer(text, text, text), public.review_organizer_application(uuid, text),
  public.update_event(uuid, integer, text, text, text, text, timestamptz, text, text, integer)
to authenticated;

commit;
