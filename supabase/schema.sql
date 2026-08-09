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
  category text not null check (category in ('Bolsas', 'Pulseiras', 'Relógios', 'Brincos', 'Cintos', 'Lenços', 'Colares', 'Óculos', 'Berloques', 'Anéis', 'Carteiras')),
  price numeric(10,2) not null check (price >= 0),
  cost_price numeric(10,2) not null default 0 check (cost_price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 3 check (low_stock_threshold >= 0),
  description text,
  photo_urls text[] not null default '{}',
  badge text check (badge is null or badge in ('new', 'sale')),
  is_featured boolean not null default false,
  is_active boolean not null default true,
  size_stock jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migração: bancos criados antes das numerações de anéis. size_stock guarda
-- {"15": 2, "18": 1, ...} — quantidade em estoque por numeração. stock_quantity
-- continua existindo como a soma de todas as numerações (mantém o resto do
-- admin, tipo alerta de estoque baixo, funcionando sem mudança).
alter table public.products add column if not exists size_stock jsonb not null default '{}'::jsonb;
alter table public.products drop column if exists sizes;

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

-- Migração: bancos criados antes das categorias "Colares", "Óculos", "Berloques", "Anéis" e "Carteiras".
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check
  check (category in ('Bolsas', 'Pulseiras', 'Relógios', 'Brincos', 'Cintos', 'Lenços', 'Colares', 'Óculos', 'Berloques', 'Anéis', 'Carteiras'));

create index if not exists products_category_idx on public.products (category);
create index if not exists products_is_active_idx on public.products (is_active);

-- Migração: agora dá pra marcar até 10 produtos em destaque ao mesmo tempo
-- (antes só 1 podia ficar marcado). O limite de 10 é conferido no admin, não
-- aqui no banco.
drop index if exists products_single_featured_idx;
create index if not exists products_is_featured_idx on public.products (is_featured) where is_featured;

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
  note text,
  coupon_code text,
  discount numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

-- Migração: bancos criados antes do status de pedido (pendente/vendido/cancelado).
alter table public.orders add column if not exists status text not null default 'pending';
alter table public.orders add column if not exists note text;

-- Migração: bancos criados antes do cupom de desconto.
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists discount numeric(10,2) not null default 0;
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
  hero_photo_url text,
  updated_at timestamptz not null default now()
);

insert into public.store_settings (id, store_name)
values (1, 'BG Collection & Co')
on conflict (id) do nothing;

-- Migração: bancos criados antes da foto de fundo do hero (banner grande da
-- home, independente de qualquer produto marcado como destaque).
alter table public.store_settings add column if not exists hero_photo_url text;

-- ----------------------------------------------------------------------------
-- Tabela: site_visits
-- Um registro por carregamento de página da vitrine, usado só pra contar
-- acessos/visitantes no painel admin (sem nenhum dado pessoal).
-- ----------------------------------------------------------------------------
create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists site_visits_created_at_idx on public.site_visits (created_at);

-- ----------------------------------------------------------------------------
-- Tabela: cart_sessions
-- Snapshot do carrinho de cada visitante (por session_id anônimo salvo no
-- localStorage), atualizado enquanto ele tem itens e ainda não finalizou.
-- A linha é apagada quando o carrinho esvazia ou o pedido é concluído —
-- então "existe" = carrinho com produto parado, sem pedido feito.
-- ----------------------------------------------------------------------------
create table if not exists public.cart_sessions (
  session_id text primary key,
  items jsonb not null,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Tabela: stock_movements
-- Histórico de cada entrada/saída de estoque (venda, estorno, ajuste manual).
-- product_name é um snapshot: se o produto for excluído depois, o histórico
-- continua legível (mesmo padrão do items congelado em orders).
-- ----------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  change_qty integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_created_at_idx on public.stock_movements (created_at);
create index if not exists stock_movements_product_id_idx on public.stock_movements (product_id);

-- ----------------------------------------------------------------------------
-- Tabela: coupons
-- Cupom de desconto aplicado no checkout da vitrine.
-- ----------------------------------------------------------------------------
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

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
-- Migração: assinatura antiga (sem o parâmetro size) precisa sair antes,
-- senão fica com as duas versões da função ao mesmo tempo.
drop function if exists public.decrement_stock(uuid, integer);
drop function if exists public.increment_stock(uuid, integer);

create or replace function public.decrement_stock(product_id uuid, qty integer, size text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if size is not null then
    update public.products
    set size_stock = jsonb_set(
          coalesce(size_stock, '{}'::jsonb),
          array[size],
          to_jsonb(greatest(0, coalesce((size_stock->>size)::integer, 0) - qty))
        ),
        stock_quantity = greatest(0, stock_quantity - qty)
    where id = product_id
    returning name into v_name;
  else
    update public.products
    set stock_quantity = greatest(0, stock_quantity - qty)
    where id = product_id
    returning name into v_name;
  end if;

  insert into public.stock_movements (product_id, product_name, change_qty, reason)
  values (
    product_id,
    coalesce(v_name, '—'),
    -qty,
    'Venda (pedido marcado como vendido)' || case when size is not null then ' — Tam ' || size else '' end
  );
end;
$$;

create or replace function public.increment_stock(product_id uuid, qty integer, size text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if size is not null then
    update public.products
    set size_stock = jsonb_set(
          coalesce(size_stock, '{}'::jsonb),
          array[size],
          to_jsonb(coalesce((size_stock->>size)::integer, 0) + qty)
        ),
        stock_quantity = stock_quantity + qty
    where id = product_id
    returning name into v_name;
  else
    update public.products
    set stock_quantity = stock_quantity + qty
    where id = product_id
    returning name into v_name;
  end if;

  insert into public.stock_movements (product_id, product_name, change_qty, reason)
  values (
    product_id,
    coalesce(v_name, '—'),
    qty,
    'Estorno (pedido voltou ou foi excluído)' || case when size is not null then ' — Tam ' || size else '' end
  );
end;
$$;

grant execute on function public.decrement_stock(uuid, integer, text) to authenticated;
grant execute on function public.increment_stock(uuid, integer, text) to authenticated;

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

-- orders: qualquer visitante cria pedido; só usuário autenticado lê/edita/exclui
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

drop policy if exists "orders_update_auth" on public.orders;
create policy "orders_update_auth"
  on public.orders for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "orders_delete_auth" on public.orders;
create policy "orders_delete_auth"
  on public.orders for delete
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

-- site_visits: qualquer visitante registra a própria visita; só o admin lê
-- (write-only pro público — não dá pra listar/ler visitas de outra pessoa).
alter table public.site_visits enable row level security;

drop policy if exists "site_visits_insert_public" on public.site_visits;
create policy "site_visits_insert_public"
  on public.site_visits for insert
  to anon, authenticated
  with check (true);

drop policy if exists "site_visits_select_auth" on public.site_visits;
create policy "site_visits_select_auth"
  on public.site_visits for select
  to authenticated
  using (true);

-- cart_sessions: qualquer visitante grava/atualiza/apaga o próprio carrinho
-- (identificado pelo session_id aleatório dele, sem PII); só o admin lê a
-- lista completa pra contar carrinhos abandonados.
alter table public.cart_sessions enable row level security;

drop policy if exists "cart_sessions_insert_public" on public.cart_sessions;
create policy "cart_sessions_insert_public"
  on public.cart_sessions for insert
  to anon, authenticated
  with check (true);

drop policy if exists "cart_sessions_update_public" on public.cart_sessions;
create policy "cart_sessions_update_public"
  on public.cart_sessions for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "cart_sessions_delete_public" on public.cart_sessions;
create policy "cart_sessions_delete_public"
  on public.cart_sessions for delete
  to anon, authenticated
  using (true);

drop policy if exists "cart_sessions_select_auth" on public.cart_sessions;
create policy "cart_sessions_select_auth"
  on public.cart_sessions for select
  to authenticated
  using (true);

-- stock_movements: só o admin acessa (inserido também via decrement_stock/
-- increment_stock, que rodam como SECURITY DEFINER e não dependem de RLS).
alter table public.stock_movements enable row level security;

drop policy if exists "stock_movements_select_auth" on public.stock_movements;
create policy "stock_movements_select_auth"
  on public.stock_movements for select
  to authenticated
  using (true);

drop policy if exists "stock_movements_insert_auth" on public.stock_movements;
create policy "stock_movements_insert_auth"
  on public.stock_movements for insert
  to authenticated
  with check (true);

-- coupons: qualquer visitante lê só os cupons ativos e válidos (pra conferir
-- o código no checkout); o admin lê/gerencia todos, incluindo inativos.
alter table public.coupons enable row level security;

drop policy if exists "coupons_select_public" on public.coupons;
create policy "coupons_select_public"
  on public.coupons for select
  to anon, authenticated
  using (active = true and (expires_at is null or expires_at > now()));

drop policy if exists "coupons_select_auth_all" on public.coupons;
create policy "coupons_select_auth_all"
  on public.coupons for select
  to authenticated
  using (true);

drop policy if exists "coupons_insert_auth" on public.coupons;
create policy "coupons_insert_auth"
  on public.coupons for insert
  to authenticated
  with check (true);

drop policy if exists "coupons_update_auth" on public.coupons;
create policy "coupons_update_auth"
  on public.coupons for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "coupons_delete_auth" on public.coupons;
create policy "coupons_delete_auth"
  on public.coupons for delete
  to authenticated
  using (true);

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
