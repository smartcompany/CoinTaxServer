-- Ephemeral API sync: do not store exchange API keys on the server.
-- Keep only last-sync metadata per user/exchange.

create table if not exists public.cointax_sync_status (
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange text not null,
  last_synced_at timestamptz not null default now(),
  primary key (user_id, exchange)
);

alter table public.cointax_sync_status enable row level security;

create policy "cointax_sync_status_own" on public.cointax_sync_status
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Legacy key columns are no longer used by the app.
-- Drop if the old connections table exists.
alter table if exists public.cointax_exchange_connections
  drop column if exists access_key_enc;

alter table if exists public.cointax_exchange_connections
  drop column if exists secret_key_enc;
