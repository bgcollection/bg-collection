-- ============================================================================
-- BG Collection & Co — schema Supabase
-- Execute este script inteiro no SQL Editor do seu projeto Supabase.
-- Pode ser rodado mais de uma vez com seguranca (usa IF NOT EXISTS / ON CONFLICT).
-- ============================================================================

-- Extensao para gerar UUIDs
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Tabela: products
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('Bolsas', 'Pulseiras', 'Relógios', 'Brincos', 'Cintos', 'Lenços')),
  price numeric(10,2) not null check (price >= 0),
  cost_price numeric(10,2) not null default 0 check (cost_price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 3 check (low_stock_threshold >= 0),
  description text,
  photo_urls text[] not null default '{}',
  badge text check (badge is null or badge in ('new', 'sale')),
  is_featured boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migração: bancos criados antes da galeria de múltiplas fotos tinham uma
-- coluna única `photo_url`. Este bloco é seguro de rodar em bancos novos
-- (não faz nada) e em bancos existentes (migra o valor antigo pro array).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'photo_url'
  ) then
    alter table public.products add column if not exists photo_urls text[] not null default '{}';
    update public.products
      set photo_urls = array[photo_url]
      where photo_url is not null and photo_url <> '' and coalesce(array_length(photo_urls, 1), 0) = 0;
    alter table public.products drop column photo_url;
  end if;
end $$;

-- Migração: bancos criados antes do destaque-por-produto e dos badges.
alter table public.products add column if not exists badge text;
alter table public.products add column if not exists is_featured boolean not null default false;

create index if not exists products_category_idx on public.products (category);
create index if not exists products_is_active_idx on public.products (is_active);
create unique index if not exists products_single_featured_idx on public.products (is_featured) where is_featured;

-- ----------------------------------------------------------------------------
-- Tabela: orders
-- items é um snapshot congelado do que foi comprado (nome, preço e categoria
-- no momento do pedido), para o dashboard continuar correto mesmo que o
-- produto original seja editado ou removido depois.
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text,
  customer_phone text,
  items jsonb not null,
  total numeric(10,2) not null check (total >= 0),
  status text not null default 'pending' check (status in ('pending', 'sold', 'cancelled')),
  created_at timestamptz not null default now()
);

-- Migração: bancos criados antes do status de pedido (pendente/vendido/cancelado).
alter table public.orders add column if not exists status text not null default 'pending';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_status_check'
  ) then
    alter table public.orders add constraint orders_status_check check (status in ('pending', 'sold', 'cancelled'));
  end if;
end $$;

create index if not exists orders_created_at_idx on public.orders (created_at);

-- ----------------------------------------------------------------------------
-- Tabela: store_settings
-- Linha única (singleton) com id fixo = 1.
-- ----------------------------------------------------------------------------
create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  store_name text not null default 'BG Collection & Co',
  whatsapp_number text,
  instagram_handle text,
  updated_at timestamptz not null default now()
);

insert into public.store_settings (id, store_name)
values (1, 'BG Collection & Co')
on conflict (id) do nothing;

-- Migração: o destaque da home passou a ser um produto marcado (is_featured),
-- não mais uma foto avulsa nas configurações.
alter table public.store_settings drop column if exists featured_photo_url;

-- ----------------------------------------------------------------------------
-- updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Ajuste de estoque (usado pelo admin ao marcar/desmarcar um pedido como
-- vendido). SECURITY DEFINER: roda com privilégio elevado porque quem chama
-- é um usuário autenticado do admin, que não tem UPDATE direto em products
-- fora do CRUD normal — o ajuste de estoque por pedido passa só por aqui,
-- de forma atômica e nunca abaixo de zero.
-- ----------------------------------------------------------------------------
create or replace function public.decrement_stock(product_id uuid, qty integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
  set stock_quantity = greatest(0, stock_quantity - qty)
  where id = product_id;
end;
$$;

create or replace function public.increment_stock(product_id uuid, qty integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
  set stock_quantity = stock_quantity + qty
  where id = product_id;
end;
$$;

grant execute on function public.decrement_stock(uuid, integer) to authenticated;
grant execute on function public.increment_stock(uuid, integer) to authenticated;

drop trigger if exists store_settings_set_updated_at on public.store_settings;
create trigger store_settings_set_updated_at
  before update on public.store_settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.store_settings enable row level security;

-- products: qualquer visitante lê; só usuário autenticado escreve
drop policy if exists "products_select_public" on public.products;
create policy "products_select_public"
  on public.products for select
  to anon, authenticated
  using (true);

drop policy if exists "products_insert_auth" on public.products;
create policy "products_insert_auth"
  on public.products for insert
  to authenticated
  with check (true);

drop policy if exists "products_update_auth" on public.products;
create policy "products_update_auth"
  on public.products for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "products_delete_auth" on public.products;
create policy "products_delete_auth"
  on public.products for delete
  to authenticated
  using (true);

-- orders: qualquer visitante cria pedido; só usuário autenticado lê
drop policy if exists "orders_insert_public" on public.orders;
create policy "orders_insert_public"
  on public.orders for insert
  to anon, authenticated
  with check (true);

drop policy if exists "orders_select_auth" on public.orders;
create policy "orders_select_auth"
  on public.orders for select
  to authenticated
  using (true);

-- store_settings: qualquer visitante lê; só usuário autenticado atualiza
drop policy if exists "store_settings_select_public" on public.store_settings;
create policy "store_settings_select_public"
  on public.store_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "store_settings_update_auth" on public.store_settings;
create policy "store_settings_update_auth"
  on public.store_settings for update
  to authenticated
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- Storage: bucket de fotos dos produtos
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

drop policy if exists "product_photos_select_public" on storage.objects;
create policy "product_photos_select_public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-photos');

drop policy if exists "product_photos_insert_auth" on storage.objects;
create policy "product_photos_insert_auth"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-photos');

drop policy if exists "product_photos_update_auth" on storage.objects;
create policy "product_photos_update_auth"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-photos')
  with check (bucket_id = 'product-photos');

drop policy if exists "product_photos_delete_auth" on storage.objects;
create policy "product_photos_delete_auth"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-photos');
