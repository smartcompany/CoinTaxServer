-- App uses custom JWT auth (not Supabase Auth).
create table if not exists public.cointax_users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.cointax_users enable row level security;

-- Drop auth.users FKs so app-generated UUIDs work with service-role writes.
do $$
declare
  r record;
begin
  for r in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname like 'cointax_%'
      and con.contype = 'f'
  loop
    execute format('alter table public.%I drop constraint if exists %I', r.relname, r.conname);
  end loop;
end $$;
