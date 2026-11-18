-- Opcional. Use em um projeto local ou ambiente dedicado à demonstração.
-- Crie e confirme primeiro organizador@example.test e equipe@example.test.
begin;

do $$
declare
  organizer_id uuid;
  team_id uuid;
begin
  select id into organizer_id from public.profiles where email = 'organizador@example.test';
  select id into team_id from public.profiles where email = 'equipe@example.test';
  if organizer_id is null or team_id is null then
    raise exception 'Cadastre organizador@example.test e equipe@example.test antes de carregar a demonstração.';
  end if;

  update public.profiles set role = 'organizer' where id = organizer_id;
  update public.profiles set role = 'admin' where email = 'admin@example.test';

  insert into public.events (id, owner_id, title, description, category, cover_url, starts_at, venue, city, capacity, status, is_demo)
  values
    ('e0010000-0000-4000-8000-000000000001', organizer_id, 'Aurora Music Festival',
     'Uma noite fictícia de música ao vivo e luzes para a demonstração acadêmica.',
     'Música', '/images/music.webp', now() + interval '22 days', 'Arena Aurora, Av. das Nações, 1400', 'São Paulo, SP', 120, 'published', true),
    ('e0010000-0000-4000-8000-000000000002', organizer_id, 'Tech Summit Brasil',
     'Um encontro fictício de inovação e tecnologia para a demonstração acadêmica.',
     'Tecnologia', '/images/technology.webp', now() + interval '29 days', 'Centro Horizonte, Rua Central, 220', 'São Paulo, SP', 80, 'published', true),
    ('e0010000-0000-4000-8000-000000000003', organizer_id, 'Sabores da Cidade',
     'Uma feira fictícia de gastronomia local para a demonstração acadêmica.',
     'Gastronomia', '/images/food.webp', now() + interval '37 days', 'Praça do Mercado, Rua das Palmeiras, 25', 'Curitiba, PR', 60, 'published', true)
  on conflict (id) do nothing;

  insert into public.event_staff (event_id, user_id)
  select id, team_id from public.events
  where owner_id = organizer_id and is_demo
    and id in ('e0010000-0000-4000-8000-000000000001',
               'e0010000-0000-4000-8000-000000000002',
               'e0010000-0000-4000-8000-000000000003')
  on conflict do nothing;
end;
$$;

commit;
