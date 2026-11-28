-- Phase 8B-8G: application identity and broker account isolation.
-- Non-destructive: legacy app_users/trade history are preserved.

do $$
begin
  if to_regclass('public.trades') is null
    or to_regclass('public.bot_config') is null
    or to_regclass('public.bot_positions') is null
    or to_regclass('public.bot_logs') is null then
    raise exception 'Run supabase/schema.sql successfully before applying the Phase 8 migration.';
  end if;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.broker_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker text not null check (broker in ('mt5','deriv')),
  account_number text not null,
  server text,
  currency text,
  balance numeric,
  equity numeric,
  account_type text not null check (account_type in ('demo','real')),
  connection_status text not null default 'disconnected' check (connection_status in ('connected','disconnected','error')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, broker, account_number, server)
);

-- Credentials are never exposed by the public API. Ciphertext only.
create table if not exists public.broker_credentials (
  id uuid primary key default gen_random_uuid(),
  broker_account_id uuid not null references public.broker_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  key_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broker_account_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_account_id uuid references public.broker_accounts(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.trades add column if not exists application_user_id uuid references auth.users(id) on delete set null;
alter table public.trades add column if not exists broker_account_id uuid references public.broker_accounts(id) on delete set null;
alter table public.bot_config add column if not exists application_user_id uuid references auth.users(id) on delete cascade;
alter table public.bot_positions add column if not exists application_user_id uuid references auth.users(id) on delete cascade;
alter table public.bot_logs add column if not exists application_user_id uuid references auth.users(id) on delete cascade;

alter table public.profiles enable row level security;
alter table public.broker_accounts enable row level security;
alter table public.broker_credentials enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "broker_accounts_select_own" on public.broker_accounts;
create policy "broker_accounts_select_own" on public.broker_accounts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "broker_accounts_insert_own" on public.broker_accounts;
create policy "broker_accounts_insert_own" on public.broker_accounts for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "broker_accounts_update_own" on public.broker_accounts;
create policy "broker_accounts_update_own" on public.broker_accounts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "broker_accounts_delete_own" on public.broker_accounts;
create policy "broker_accounts_delete_own" on public.broker_accounts for delete to authenticated using ((select auth.uid()) = user_id);

-- No public or authenticated grants/policies for broker_credentials.
revoke all on public.broker_credentials from anon, authenticated;

drop policy if exists "audit_select_own" on public.audit_logs;
create policy "audit_select_own" on public.audit_logs for select to authenticated using ((select auth.uid()) = user_id);

-- Remove legacy public trade visibility and isolate existing rows when the
-- application identity column is populated.
drop policy if exists "Public read access to trades" on public.trades;
drop policy if exists "Users can read own trades" on public.trades;
create policy "trades_select_own_application_user" on public.trades
  for select to authenticated
  using ((select auth.uid()) = application_user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email)
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, updated_at = now();
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
