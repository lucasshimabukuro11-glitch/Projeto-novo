begin;

-- Eventos ficticios vinculados aos perfis provisionados, sem modificar eventos reais.
alter table eventpass_private.provisioned_accounts
  add column sample_events_loaded_at timestamptz;

create table eventpass_private.provisioned_sample_events (
  event_id uuid primary key references public.events(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  sample_number smallint not null check (sample_number between 1 and 3),
  unique (owner_id, sample_number)
);
revoke all on eventpass_private.provisioned_sample_events from public, anon, authenticated;

create function public.seed_provisioned_events()
returns table (slot text, event_count bigint, certificate_event_count bigint)
language plpgsql security definer set search_path = '' as $$
declare
  sample record;
  v_event_id uuid;
  v_starts_at timestamptz;
begin
  -- Uma chamada concorrente aguarda a outra; a marcacao impede repeticoes.
  perform a.user_id from eventpass_private.provisioned_accounts a order by a.slot for update;
  if (select count(*) from eventpass_private.provisioned_accounts a
        join public.profiles p on p.id = a.user_id
        where p.role = case when a.slot = 'admin' then 'admin' else 'organizer' end) <> 4 then
    raise exception using errcode = '22023',
      message = 'Crie e valide as quatro contas antes de cadastrar eventos de exemplo.';
  end if;

  for sample in
    select s.*, a.user_id
    from (values
      ('organizer-1', 1, 'Oficina de Desenvolvimento Web (Exemplo)',
        '[EXEMPLO FICTICIO] Oficina de desenvolvimento de interfaces e boas praticas para web.',
        'Tecnologia', 'Centro de Inovacao - Sala 1', 'São Paulo', 21, 80, 4.0::numeric, 'Oficina pratica de desenvolvimento web'),
      ('organizer-1', 2, 'Encontro de Comunidades Tech (Exemplo)',
        '[EXEMPLO FICTICIO] Encontro de comunidades, conversas e troca de experiencias de tecnologia.',
        'Tecnologia', 'Espaco de Eventos Tech', 'São Paulo', 28, 150, null::numeric, null::text),
      ('organizer-1', 3, 'Mostra de Projetos Digitais (Exemplo)',
        '[EXEMPLO FICTICIO] Apresentacao de projetos e demonstracoes de tecnologia digital.',
        'Tecnologia', 'Pavilhao de Exposicoes', 'São Paulo', 35, 120, null::numeric, null::text),
      ('organizer-2', 1, 'Festival de Arte e Cultura (Exemplo)',
        '[EXEMPLO FICTICIO] Apresentacoes artisticas e atividades culturais para visitantes.',
        'Cultura', 'Praca Cultural', 'Campinas', 22, 200, null::numeric, null::text),
      ('organizer-2', 2, 'Oficina de Producao Cultural (Exemplo)',
        '[EXEMPLO FICTICIO] Atividade formativa de planejamento e organizacao de eventos culturais.',
        'Cultura', 'Sala de Oficinas Criativas', 'Campinas', 29, 60, 3.0::numeric, 'Oficina de producao cultural'),
      ('organizer-2', 3, 'Feira de Criadores Independentes (Exemplo)',
        '[EXEMPLO FICTICIO] Feira de ilustracoes, criacoes e artesanato independente.',
        'Cultura', 'Centro Cultural', 'Campinas', 36, 130, null::numeric, null::text),
      ('organizer-3', 1, 'Semana Academica de Tecnologia (Exemplo)',
        '[EXEMPLO FICTICIO] Semana de palestras, debates e atividades de aprendizagem em tecnologia.',
        'Educação', 'Auditorio Universitario', 'Presidente Prudente', 23, 180, 6.0::numeric, 'Participacao na programacao academica'),
      ('organizer-3', 2, 'Seminario de Inovacao na Educacao (Exemplo)',
        '[EXEMPLO FICTICIO] Seminario sobre metodologias de ensino e ferramentas digitais.',
        'Educação', 'Sala Magna', 'Presidente Prudente', 30, 100, 4.0::numeric, 'Seminario e discussao em grupo'),
      ('organizer-3', 3, 'Feira de Oportunidades Universitarias (Exemplo)',
        '[EXEMPLO FICTICIO] Feira de oportunidades com apresentacoes e estandes de demonstracao.',
        'Educação', 'Ginasio do Campus', 'Presidente Prudente', 37, 200, null::numeric, null::text)
    ) as s(account_slot, sample_number, title, description, category, venue, city,
            days_ahead, capacity, certificate_hours, certificate_activity)
    join eventpass_private.provisioned_accounts a on a.slot = s.account_slot
    where a.sample_events_loaded_at is null
    order by s.account_slot, s.sample_number
  loop
    -- Todos os eventos comecam no futuro; sem dados de presenca ou certificados emitidos.
    v_starts_at := clock_timestamp() + sample.days_ahead * interval '1 day';
    insert into public.events (owner_id, title, description, category, cover_url,
                              starts_at, venue, city, capacity, status, is_demo)
    values (sample.user_id, sample.title, sample.description, sample.category,
            null, v_starts_at, sample.venue, sample.city, sample.capacity,
            'published', true)
    returning id into v_event_id;

    insert into eventpass_private.provisioned_sample_events (event_id, owner_id, sample_number)
    values (v_event_id, sample.user_id, sample.sample_number);

    if sample.certificate_hours is not null then
      insert into public.certificate_settings (
        event_id, enabled, event_name, organizer_name, hours, event_date,
        participation_text, logo_url, signature_url, completes_at, completed_at
      ) values (
        v_event_id, true, sample.title, 'Organizador ' || right(sample.account_slot, 1),
        sample.certificate_hours, (v_starts_at at time zone 'America/Sao_Paulo')::date,
        'Certificado de participacao em atividade ficticia usada apenas para demonstracao do EventScan.',
        null, null, v_starts_at + sample.certificate_hours * interval '1 hour', null
      );

      insert into public.certificate_activities (event_id, name, required)
      values (v_event_id, sample.certificate_activity, true);
    end if;
  end loop;

  update eventpass_private.provisioned_accounts a
     set sample_events_loaded_at = clock_timestamp()
   where a.slot <> 'admin' and a.sample_events_loaded_at is null;

  return query
  select a.slot, count(s.event_id), count(cs.event_id) filter (where cs.enabled)
  from eventpass_private.provisioned_accounts a
  left join eventpass_private.provisioned_sample_events s on s.owner_id = a.user_id
  left join public.certificate_settings cs on cs.event_id = s.event_id
  group by a.slot
  order by a.slot;
end;
$$;

revoke execute on function public.seed_provisioned_events() from public, anon, authenticated;
grant execute on function public.seed_provisioned_events() to service_role;

commit;
