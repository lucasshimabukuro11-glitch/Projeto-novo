begin;

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index product_categories_name on public.product_categories(lower(btrim(name)));

insert into public.product_categories (id, name) values
  ('97a86116-435a-4c5f-834b-991cc243f101', 'Vestuário'),
  ('97a86116-435a-4c5f-834b-991cc243f102', 'Copos e canecas'),
  ('97a86116-435a-4c5f-834b-991cc243f103', 'Credenciamento'),
  ('97a86116-435a-4c5f-834b-991cc243f104', 'Kits e lembranças');

alter table public.products
  add column category_id uuid references public.product_categories (id),
  add column is_example boolean not null default false,
  drop constraint products_image_url_check;
alter table public.products add check (
  image_url is null or (length(image_url) <= 1200 and
    (image_url ~* '^https://[^[:space:]]+$' or image_url ~ '^/images/products/[a-z-]+[.]webp$'))
);
create index products_category on public.products (category_id);

alter table public.product_categories enable row level security;
revoke all on public.product_categories from public, anon, authenticated;
grant select on public.product_categories to anon, authenticated;
grant insert (name, active), update (name, active) on public.product_categories to authenticated;

create policy product_categories_read on public.product_categories for select to anon, authenticated using (true);
create policy product_categories_insert on public.product_categories for insert to authenticated
with check ((select eventpass_private.user_role()) = 'admin');
create policy product_categories_update on public.product_categories for update to authenticated
using ((select eventpass_private.user_role()) = 'admin')
with check ((select eventpass_private.user_role()) = 'admin');

create function eventpass_private.validate_product_category() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then return new; end if;
  perform 1 from public.product_categories where id = new.category_id and active for share;
  if not found then
    raise exception using errcode = '22023', message = 'Selecione uma categoria ativa.';
  end if;
  return new;
end;
$$;
revoke execute on function eventpass_private.validate_product_category() from public, anon, authenticated;
create trigger products_require_category before insert or update of category_id on public.products
for each row execute function eventpass_private.validate_product_category();

drop policy products_read_visible on public.products;
drop policy products_create_own on public.products;
drop policy products_update_own on public.products;
drop policy products_delete_own on public.products;

revoke insert, update, delete on public.products from public, anon, authenticated;
grant insert (owner_id, name, description, category_id, price_cents, stock, image_url, active),
  update (name, description, category_id, price_cents, stock, image_url, active), delete on public.products to authenticated;

create policy products_read_public on public.products for select to anon, authenticated using (active);
create policy products_read_management on public.products for select to authenticated
using ((select eventpass_private.user_role()) = 'admin'
  or (owner_id = (select auth.uid()) and (select eventpass_private.user_role()) = 'organizer'));
create policy products_create_own on public.products for insert to authenticated
with check (owner_id = (select auth.uid()) and (select eventpass_private.user_role()) = 'organizer');
create policy products_update_managed on public.products for update to authenticated
using ((select eventpass_private.user_role()) = 'admin'
  or (owner_id = (select auth.uid()) and (select eventpass_private.user_role()) = 'organizer'))
with check ((select eventpass_private.user_role()) = 'admin'
  or (owner_id = (select auth.uid()) and (select eventpass_private.user_role()) = 'organizer'));
create policy products_delete_own on public.products for delete to authenticated
using (owner_id = (select auth.uid()) and (select eventpass_private.user_role()) = 'organizer');

create function public.seed_provisioned_products()
returns table (slot text, example_count bigint)
language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize repeated calls and keep the completion marker even if a product is later removed.
  perform a.user_id from eventpass_private.provisioned_accounts a order by a.slot for update;
  if (select count(*) from eventpass_private.provisioned_accounts a join public.profiles p on a.user_id = p.id
    where p.role = case when a.slot = 'admin' then 'admin' else 'organizer' end) <> 4 then
    raise exception using errcode = '22023', message = 'O provisionamento exige um administrador e três organizadores.';
  end if;

  insert into public.products (owner_id, name, description, category_id, price_cents, stock, image_url, active, is_example)
  select a.user_id, sample.name, sample.description,
    ('97a86116-435a-4c5f-834b-991cc243f10' || sample.category_no)::uuid,
    sample.price, sample.stock, '/images/products/' || sample.photo || '.webp', true, true
  from (values
    ('organizer-1', 'Camiseta Credencial Tech', 'Camiseta preta de algodão com estampa discreta para congressos de tecnologia.', '1', 6490, 36, 'camiseta'),
    ('organizer-1', 'Boné Staff Tech', 'Boné ajustável com bordado violeta para equipes de apoio.', '1', 4590, 25, 'bone'),
    ('organizer-1', 'Copo Reutilizável Circuito', 'Copo lavável de 400 ml para reposição de água durante as palestras.', '2', 1890, 80, 'copo'),
    ('organizer-1', 'Caneca Pausa para Código', 'Caneca de cerâmica de 330 ml para o coffee break.', '2', 3290, 42, 'caneca'),
    ('organizer-1', 'Cordão de Crachá Tech', 'Cordão de poliéster com fecho metálico e porta-crachá transparente.', '3', 1290, 120, 'cordao'),
    ('organizer-1', 'Kit Boas-vindas Tech', 'Caixa kraft com copo reutilizável, cordão para crachá e bloco de notas.', '4', 7490, 30, 'kit'),
    ('organizer-2', 'Camiseta Festival Criativo', 'Camiseta de malha macia para voluntários, estudantes e expositores.', '1', 5990, 45, 'camiseta'),
    ('organizer-2', 'Boné Palco Aberto', 'Boné com regulagem traseira para atividades ao ar livre.', '1', 4990, 28, 'bone'),
    ('organizer-2', 'Copo Rotas da Cultura', 'Copo translúcido reutilizável de 500 ml para feiras e festivais.', '2', 2190, 110, 'copo'),
    ('organizer-2', 'Caneca Arte em Encontro', 'Caneca branca de cerâmica com desenho geométrico em violeta.', '2', 3590, 32, 'caneca'),
    ('organizer-2', 'Cordão Credencial Cultural', 'Cordão estampado com presilha para identificação de expositores.', '3', 1490, 85, 'cordao'),
    ('organizer-2', 'Kit Memórias do Festival', 'Conjunto de lembranças com caneca, cartão ilustrado e cordão.', '4', 7990, 24, 'kit'),
    ('organizer-3', 'Camiseta Jornada Universitária', 'Camiseta de algodão para monitoria, oficinas e grupos de estudo.', '1', 5490, 60, 'camiseta'),
    ('organizer-3', 'Boné Equipe Acadêmica', 'Boné preto de sarja com fecho ajustável.', '1', 4190, 34, 'bone'),
    ('organizer-3', 'Copo Campus Sustentável', 'Copo lavável de 450 ml para uso durante a semana acadêmica.', '2', 1690, 96, 'copo'),
    ('organizer-3', 'Caneca Intervalo no Campus', 'Caneca de cerâmica de 300 ml para convidados e palestrantes.', '2', 2990, 48, 'caneca'),
    ('organizer-3', 'Cordão Visita Guiada', 'Cordão violeta com porta-crachá para credenciais de visitantes.', '3', 1190, 150, 'cordao'),
    ('organizer-3', 'Kit Semana Acadêmica', 'Caixa com copo, cordão de identificação e caderno de bolso.', '4', 6990, 40, 'kit')
  ) as sample(account_slot, name, description, category_no, price, stock, photo)
  join eventpass_private.provisioned_accounts a on a.slot = sample.account_slot
  where a.sample_products_loaded_at is null;

  update eventpass_private.provisioned_accounts a set sample_products_loaded_at = clock_timestamp()
  where a.slot <> 'admin' and a.sample_products_loaded_at is null;

  return query
  select a.slot, count(p.id)
  from eventpass_private.provisioned_accounts a
  left join public.products p on p.owner_id = a.user_id and p.is_example
  group by a.slot order by a.slot;
end;
$$;
revoke execute on function public.seed_provisioned_products() from public, anon, authenticated;
grant execute on function public.seed_provisioned_products() to service_role;

commit;
