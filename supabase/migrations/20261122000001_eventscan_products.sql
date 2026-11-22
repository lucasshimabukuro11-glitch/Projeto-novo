-- Catalogo de produtos do EventScan. Execute apos as migracoes anteriores.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  price_cents integer not null check (price_cents between 0 and 200000000),
  stock integer not null default 0 check (stock between 0 and 1000000),
  image_url text check (image_url is null or (char_length(image_url) <= 1200 and image_url ~* '^https://[^[:space:]]+$')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_owner_created_idx on public.products(owner_id, created_at desc);
create index if not exists products_public_created_idx on public.products(created_at desc) where active = true;

create or replace function public.touch_product_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.touch_product_updated_at();

alter table public.products enable row level security;

drop policy if exists products_read_visible on public.products;
create policy products_read_visible on public.products for select
using (active or owner_id = (select auth.uid()));

drop policy if exists products_create_own on public.products;
create policy products_create_own on public.products for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists products_update_own on public.products;
create policy products_update_own on public.products for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists products_delete_own on public.products;
create policy products_delete_own on public.products for delete to authenticated
using (owner_id = (select auth.uid()));

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
