begin;

create table eventpass_private.provisioned_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slot text not null unique check (slot in ('admin', 'organizer-1', 'organizer-2', 'organizer-3')),
  initial_credential_digest bytea,
  activated_at timestamptz,
  sample_products_loaded_at timestamptz,
  check ((initial_credential_digest is null) = (activated_at is not null))
);

create table eventpass_private.account_role_changes (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid references public.profiles(id) on delete set null,
  account_id uuid references public.profiles(id) on delete set null,
  previous_role text not null,
  new_role text not null
);

revoke all on eventpass_private.provisioned_accounts, eventpass_private.account_role_changes
  from public, anon, authenticated;

create function eventpass_private.capture_provisioned_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  account_slot text := new.raw_app_meta_data ->> 'eventscan_account_slot';
begin
  -- Auth may write the trusted metadata and confirmation after the initial INSERT.
  if new.email_confirmed_at is null or nullif(new.encrypted_password, '') is null
     or exists (select 1 from eventpass_private.provisioned_accounts where user_id = new.id) then
    return new;
  end if;

  insert into eventpass_private.provisioned_accounts (user_id, slot, initial_credential_digest)
  values (new.id, account_slot, sha256(convert_to(new.encrypted_password, 'UTF8')));
  update public.profiles set role = case when account_slot = 'admin' then 'admin' else 'organizer' end
  where id = new.id;
  return new;
end;
$$;

create trigger eventscan_provisioned_account
after insert or update of raw_app_meta_data, email_confirmed_at, encrypted_password on auth.users
for each row when (new.raw_app_meta_data ->> 'eventscan_account_slot' is not null)
execute function eventpass_private.capture_provisioned_account();

create function eventpass_private.account_credential_state() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when a.activated_at is null then 'password_required'
      when exists (
        select 1 from auth.sessions s
        where s.id = (auth.jwt() ->> 'session_id')::uuid and s.user_id = a.user_id
          and s.created_at > a.activated_at
      ) then 'active'
      else 'sign_in_required'
    end
    from eventpass_private.provisioned_accounts a where a.user_id = auth.uid()
  ), 'active')
$$;

create function eventpass_private.temporary_credential_replaced() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from eventpass_private.provisioned_accounts a join auth.users u on u.id = a.user_id
    where a.user_id = auth.uid() and a.activated_at is null and nullif(u.encrypted_password, '') is not null
      and sha256(convert_to(u.encrypted_password, 'UTF8')) <> a.initial_credential_digest
  )
$$;

create function eventpass_private.active_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select case when eventpass_private.account_credential_state() = 'active' then auth.uid() end
$$;

revoke execute on function eventpass_private.capture_provisioned_account(), eventpass_private.account_credential_state(),
  eventpass_private.temporary_credential_replaced(), eventpass_private.active_user_id() from public, anon, authenticated;
grant execute on function eventpass_private.active_user_id() to authenticated;

create or replace function eventpass_private.user_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = eventpass_private.active_user_id()
$$;

create or replace function eventpass_private.staffs_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_staff where event_id = p_event and user_id = eventpass_private.active_user_id())
$$;

create or replace function eventpass_private.holds_ticket(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tickets where event_id = p_event and participant_id = eventpass_private.active_user_id())
$$;

alter policy tickets_self on public.tickets
using (participant_id = (select eventpass_private.active_user_id()));

alter policy event_staff_self_or_owner on public.event_staff
using (user_id = (select eventpass_private.active_user_id()) or eventpass_private.owns_event(event_id));

alter policy certificate_own_read on public.certificates
using (participant_id = (select eventpass_private.active_user_id()) or eventpass_private.owns_event(event_id)
  or (select eventpass_private.user_role()) = 'admin');

create or replace function public.my_ticket_admissions() returns table (id uuid, details jsonb)
language sql stable security definer set search_path = '' as $$
  select t.id, eventpass_private.ticket_admission(t)
  from public.tickets t where t.participant_id = (select eventpass_private.active_user_id())
  order by t.issued_at desc, t.id
$$;

create or replace function public.my_certificate_events() returns jsonb
language sql stable security definer set search_path = '' as $$
  with viewer as (select eventpass_private.active_user_id() as id)
  select coalesce(jsonb_agg(r order by r.starts_at desc), '[]'::jsonb)
  from (
    select e.id as event_id, e.title, e.starts_at,
      eventpass_private.certificate_status(e.id, v.id) as eligibility,
      to_jsonb(c) - 'participant_id' as certificate
    from public.events e cross join viewer v
    left join public.certificates c on c.event_id = e.id and c.participant_id = v.id
    where c.id is not null or (
      exists (select 1 from public.certificate_settings s where s.event_id = e.id and s.enabled)
      and exists (select 1 from public.tickets t where t.event_id = e.id and t.participant_id = v.id and t.cancelled_at is null)
    )
  ) r
$$;

create function public.account_credential_state() returns text
language sql stable security definer set search_path = '' as $$
  select case when eventpass_private.temporary_credential_replaced() then 'finish_required'
    else eventpass_private.account_credential_state() end
$$;

create function public.complete_first_access() returns void
language plpgsql security definer set search_path = '' as $$
declare
  account eventpass_private.provisioned_accounts;
begin
  select * into account from eventpass_private.provisioned_accounts where user_id = auth.uid() for update;
  if not found or account.activated_at is not null then return; end if;
  if not eventpass_private.temporary_credential_replaced() then
    raise exception using errcode = '42501', message = 'Defina uma senha diferente da senha temporária para liberar seu acesso.';
  end if;

  -- JWTs issued to earlier sessions cannot acquire access after activation.
  update eventpass_private.provisioned_accounts
  set activated_at = clock_timestamp(), initial_credential_digest = null where user_id = account.user_id;
end;
$$;

alter table public.organizer_applications add column access_revoked_at timestamptz
  check (access_revoked_at is null or status = 'approved');

drop index public.organizer_applications_active;
create unique index organizer_applications_active on public.organizer_applications (applicant_id)
where status in ('pending', 'approved') and access_revoked_at is null;

create or replace function public.request_organizer(p_organization_name text, p_contact_email text, p_city text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  requester public.profiles;
  existing public.organizer_applications;
  submitted public.organizer_applications;
  organization text := btrim(p_organization_name);
  contact text := lower(btrim(p_contact_email));
  location text := btrim(p_city);
begin
  select * into requester from public.profiles where id = eventpass_private.active_user_id() for update;
  if requester.role is distinct from 'participant' then
    raise exception using errcode = '42501', message = 'Apenas participantes podem solicitar o perfil de organizador.';
  end if;
  select * into existing from public.organizer_applications
  where applicant_id = requester.id and status in ('pending', 'approved') and access_revoked_at is null;
  if found then return to_jsonb(existing); end if;

  if organization is null or length(organization) not between 2 and 120
     or location is null or length(location) not between 2 and 100
     or contact is null or length(contact) > 254 or contact !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Informe o nome da organização, um e-mail válido e a cidade.';
  end if;
  insert into public.organizer_applications(applicant_id, organization_name, contact_email, city)
  values (requester.id, organization, contact, location) returning * into submitted;
  return to_jsonb(submitted);
end;
$$;

create function public.change_account_role(p_account uuid, p_expected_role text, p_new_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  prior_role text;
begin
  perform pg_advisory_xact_lock(234831, 1);
  if eventpass_private.user_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Apenas administradores podem alterar permissões.';
  end if;
  if p_account = auth.uid() or exists (
    select 1 from eventpass_private.provisioned_accounts where user_id = p_account and slot = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'O próprio perfil e o administrador principal são protegidos.';
  end if;
  if p_new_role is null or p_new_role not in ('participant', 'organizer', 'admin') then
    raise exception using errcode = '22023', message = 'Selecione um perfil válido.';
  end if;
  select role into prior_role from public.profiles where id = p_account for update;
  if not found or prior_role is distinct from p_expected_role then
    raise exception using errcode = '22023', message = 'O perfil mudou. Atualize a lista de usuários.';
  end if;
  if prior_role = p_new_role then return; end if;

  update public.profiles set role = p_new_role where id = p_account;
  if p_new_role = 'organizer' then
    update public.organizer_applications
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = clock_timestamp()
    where applicant_id = p_account and status = 'pending';
  elsif prior_role = 'organizer' then
    update public.organizer_applications set access_revoked_at = clock_timestamp()
    where applicant_id = p_account and status = 'approved' and access_revoked_at is null;
  end if;

  insert into eventpass_private.account_role_changes(changed_by, account_id, previous_role, new_role)
  values (auth.uid(), p_account, prior_role, p_new_role);
end;
$$;

create function public.recent_account_role_changes()
returns table (id bigint, changed_at timestamptz, actor_name text, account_name text, previous_role text, new_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if eventpass_private.user_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Apenas administradores podem consultar este histórico.';
  end if;
  return query
  select a.id, a.changed_at, actor.display_name, account.display_name, a.previous_role, a.new_role
  from eventpass_private.account_role_changes a
  left join public.profiles actor on actor.id = a.changed_by
  left join public.profiles account on account.id = a.account_id
  order by a.id desc limit 20;
end;
$$;

create or replace function public.event_roster(p_event uuid)
returns table (
  id uuid, display_name text, email text, issued_at timestamptz,
  cancelled_at timestamptz, checked_in_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if eventpass_private.user_role() is distinct from 'admin' and not eventpass_private.owns_event(p_event) then
    raise exception using errcode = '42501', message = 'Você não pode consultar os inscritos deste evento.';
  end if;
  return query
  select t.id, p.display_name, p.email, t.issued_at, t.cancelled_at, t.checked_in_at
  from public.tickets t join public.profiles p on p.id = t.participant_id
  where t.event_id = p_event order by t.issued_at desc, t.id;
end;
$$;

create function public.provisioned_account_plan(p_emails text[])
returns table (id uuid, email text, slot text, role text, activated boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, lower(u.email), a.slot, p.role, a.activated_at is not null
  from auth.users u join public.profiles p on p.id = u.id
  left join eventpass_private.provisioned_accounts a on a.user_id = u.id
  where a.user_id is not null or lower(u.email) = any(p_emails)
$$;

revoke execute on function public.account_credential_state(), public.complete_first_access(),
  public.change_account_role(uuid, text, text), public.recent_account_role_changes(), public.provisioned_account_plan(text[])
  from public, anon, authenticated;
grant execute on function public.account_credential_state(), public.complete_first_access(),
  public.change_account_role(uuid, text, text), public.recent_account_role_changes() to authenticated;
grant execute on function public.provisioned_account_plan(text[]) to service_role;

commit;
