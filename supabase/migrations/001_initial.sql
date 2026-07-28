-- Supabase / Postgres schema for CoinTax
-- Table names are prefixed with cointax_

create extension if not exists "pgcrypto";

-- Custom JWT auth users (not Supabase Auth)
create table if not exists public.cointax_users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.cointax_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.cointax_exchange_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange text not null,
  label text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.cointax_sync_status (
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange text not null,
  last_synced_at timestamptz not null default now(),
  primary key (user_id, exchange)
);

create table if not exists public.cointax_trades (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange text not null,
  asset text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity text not null,
  price_krw text not null,
  fee_krw text not null,
  traded_at timestamptz not null,
  raw_source text not null check (raw_source in ('api', 'csv')),
  created_at timestamptz not null default now()
);

create index if not exists idx_cointax_trades_user_traded_at
  on public.cointax_trades(user_id, traded_at);

create table if not exists public.cointax_deemed_costs (
  user_id uuid not null references auth.users(id) on delete cascade,
  asset text not null,
  price_krw text not null,
  primary key (user_id, asset)
);

create table if not exists public.cointax_fx_rates (
  date date not null,
  pair text not null,
  rate text not null,
  primary key (date, pair)
);

alter table public.cointax_profiles enable row level security;
alter table public.cointax_exchange_connections enable row level security;
alter table public.cointax_sync_status enable row level security;
alter table public.cointax_trades enable row level security;
alter table public.cointax_deemed_costs enable row level security;
alter table public.cointax_fx_rates enable row level security;

create policy "cointax_profiles_own" on public.cointax_profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "cointax_connections_own" on public.cointax_exchange_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cointax_sync_status_own" on public.cointax_sync_status
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cointax_trades_own" on public.cointax_trades
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cointax_deemed_own" on public.cointax_deemed_costs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cointax_fx_read_authenticated" on public.cointax_fx_rates
  for select to authenticated using (true);
