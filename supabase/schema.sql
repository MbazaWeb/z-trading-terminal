-- Z Trading Terminal — Supabase Database Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New Query)
-- Project: https://osnulcepmabajcvpbgxw.supabase.co

-- Enable UUID extension (Supabase already has this, but ensure it)
create extension if not exists "uuid-ossp";

-- ===========================================================================
-- USERS (optional — Supabase Auth manages users, this is for app metadata)
-- ===========================================================================
create table if not exists public.app_users (
  id uuid primary key default uuid_generate_v4(),
  supabase_auth_id uuid references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  provider text default 'deriv',
  account_type text default 'demo',
  loginid text,
  balance numeric(18,2) default 0,
  currency text default 'USD',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ===========================================================================
-- TRADES
--
-- client_order_id: optional idempotency key supplied by the client (UUID).
--   When present, the server-side /api/trades and /api/mt5/trade routes
--   check for an existing row with the same client_order_id before
--   inserting. This prevents duplicate orders if the client retries after
--   a network blip.
--
-- broker_order_id: the order id returned by the broker (MetaApi / Deriv)
--   when the trade was placed. NULL for paper trades (no broker round-trip).
--
-- broker_open_time / broker_close_time: timestamps reported by the broker
--   (MetaApi response.openTime / position.time and the close confirmation).
--   NULL for paper trades. Used to compute the actual hold duration in
--   ReportsView and the avgHoldTimeMs metric in the agent performance
--   rollup (ZT-14).
--
-- hold_time_ms: cached broker_close_time - broker_open_time, populated when
--   the position is closed. Stored as bigint so it can hold multi-hour
--   durations without overflow.
--
-- source: 'paper' is a new value added in the consolidated remediation to
--   distinguish local-only simulation trades from real broker trades.
-- ===========================================================================
create table if not exists public.trades (
  id uuid primary key default uuid_generate_v4(),
  status text not null default 'closed' check (status in ('open', 'closed')),
  datetime timestamptz not null default now(),
  market text not null,
  side text not null check (side in ('buy', 'sell')),
  amount numeric(18,2) not null,
  entry_price numeric(18,8) not null,
  exit_price numeric(18,8),
  pnl numeric(18,2) default 0,
  pnl_pct numeric(8,2) default 0,
  result text check (result in ('win', 'loss')),
  agent_id text,
  source text not null default 'manual' check (source in ('seed', 'agent', 'bot', 'manual', 'paper')),
  client_order_id text,
  broker_order_id text,
  broker_open_time timestamptz,
  broker_close_time timestamptz,
  hold_time_ms bigint,
  user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz default now()
);

-- Add the broker timestamp columns to existing deployments (no-op on fresh
-- installs because the table was created with them above).
alter table public.trades add column if not exists broker_open_time timestamptz;
alter table public.trades add column if not exists broker_close_time timestamptz;
alter table public.trades add column if not exists hold_time_ms bigint;

-- Unique constraint on client_order_id prevents duplicate inserts at the
-- database level (defense in depth — the application also checks).
create unique index if not exists idx_trades_client_order_id
  on public.trades(client_order_id)
  where client_order_id is not null;

create index if not exists idx_trades_datetime on public.trades(datetime desc);
create index if not exists idx_trades_status on public.trades(status);
create index if not exists idx_trades_market on public.trades(market);
create index if not exists idx_trades_agent on public.trades(agent_id);
create index if not exists idx_trades_user on public.trades(user_id);

-- ===========================================================================
-- AGENTS
-- ===========================================================================
create table if not exists public.agents (
  id text primary key,
  name text not null,
  strategy text not null,
  strategy_type text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'training')),
  win_rate numeric(5,2) not null default 50.0,
  total_trades integer default 0,
  pnl numeric(18,2) default 0,
  self_improvements integer default 0,
  confidence integer default 50,
  is_learning boolean default false,
  user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ===========================================================================
-- AGENT IMPROVEMENT LOGS
-- ===========================================================================
create table if not exists public.agent_improvements (
  id uuid primary key default uuid_generate_v4(),
  agent_id text not null references public.agents(id) on delete cascade,
  timestamp timestamptz not null default now(),
  trigger text not null,
  parameter_change text not null,
  confidence_delta integer not null default 0,
  new_confidence integer not null
);

create index if not exists idx_agent_imp_agent on public.agent_improvements(agent_id);
create index if not exists idx_agent_imp_ts on public.agent_improvements(timestamp desc);

-- ===========================================================================
-- BOT POSITIONS
-- ===========================================================================
create table if not exists public.bot_positions (
  id uuid primary key default uuid_generate_v4(),
  trade_id text not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  size numeric(18,8) not null,
  entry_price numeric(18,8) not null,
  current_price numeric(18,8) not null,
  stop_loss numeric(18,8) not null,
  take_profit numeric(18,8) not null,
  opened_at timestamptz not null default now(),
  agent_id text,
  user_id uuid references public.app_users(id) on delete set null
);

create index if not exists idx_bot_pos_user on public.bot_positions(user_id);

-- ===========================================================================
-- BOT LOGS
-- ===========================================================================
create table if not exists public.bot_logs (
  id uuid primary key default uuid_generate_v4(),
  timestamp timestamptz not null default now(),
  tag text not null check (tag in ('SIGNAL', 'RISK-CHECK', 'ORDER', 'STOP-LOSS', 'TAKE-PROFIT', 'INFO')),
  message text not null,
  user_id uuid references public.app_users(id) on delete set null
);

create index if not exists idx_bot_logs_ts on public.bot_logs(timestamp desc);

-- ===========================================================================
-- BOT CONFIG (per user)
-- ===========================================================================
create table if not exists public.bot_config (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid unique references public.app_users(id) on delete cascade,
  running boolean default false,
  max_position_size numeric(18,2) default 500,
  max_daily_loss numeric(18,2) default 200,
  max_concurrent_positions integer default 5,
  default_stop_loss numeric(5,2) default 1.5,
  default_take_profit numeric(5,2) default 3.0,
  risk_per_trade numeric(5,2) default 2.0,
  updated_at timestamptz default now()
);

-- ===========================================================================
-- ROW LEVEL SECURITY
--
-- The Z Trading Terminal uses Deriv OAuth (not Supabase Auth) for identity.
-- auth.uid() therefore returns NULL for all browser requests, which means
-- RLS policies that require auth.uid() would block all client-side writes.
--
-- To support the trade persistence flow without forcing Supabase Auth on
-- users, the application writes to Supabase exclusively through server-side
-- routes (/api/trades, /api/mt5/trade) that use the service-role client
-- (`supabaseAdmin` in src/lib/supabaseServer.ts). The service role bypasses
-- RLS, so writes are authorized by the server-side session (HttpOnly cookie)
-- rather than by Supabase Auth.
--
-- Reads remain open (select using (true)) so the browser can display trade
-- history without an extra round-trip. This is acceptable because the trades
-- table contains no PII beyond login ids and market positions — which are
-- already public market data — and because the table is only populated when
-- the deploy sets NEXT_PUBLIC_SUPABASE_URL + the service role key.
--
-- Tighten further by replacing `using (true)` with a per-user policy once
-- Supabase Auth is wired up.
-- ===========================================================================
alter table public.app_users enable row level security;
alter table public.trades enable row level security;
alter table public.agents enable row level security;
alter table public.agent_improvements enable row level security;
alter table public.bot_positions enable row level security;
alter table public.bot_logs enable row level security;
alter table public.bot_config enable row level security;

create policy "Users can read own profile" on public.app_users
  for select using (auth.uid() = supabase_auth_id);
create policy "Users can update own profile" on public.app_users
  for update using (auth.uid() = supabase_auth_id);

-- Trades: open SELECT for the public dashboard; writes go through the
-- service-role client (supabaseAdmin) which bypasses RLS.
drop policy if exists "Users can read own trades" on public.trades;
drop policy if exists "Users can insert own trades" on public.trades;
create policy "Public read access to trades" on public.trades
  for select using (true);

create policy "Users can read own bot positions" on public.bot_positions
  for select using (
    user_id in (select id from public.app_users where supabase_auth_id = auth.uid())
  );

create policy "Users can read own bot logs" on public.bot_logs
  for select using (
    user_id in (select id from public.app_users where supabase_auth_id = auth.uid())
  );

create policy "Anyone can read agents" on public.agents
  for select using (true);
create policy "Anyone can read agent improvements" on public.agent_improvements
  for select using (true);

-- ===========================================================================
-- UPDATED_AT TRIGGERS
-- ===========================================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger if not exists trg_app_users_updated
  before update on public.app_users
  for each row execute function public.handle_updated_at();

create trigger if not exists trg_agents_updated
  before update on public.agents
  for each row execute function public.handle_updated_at();

create trigger if not exists trg_bot_config_updated
  before update on public.bot_config
  for each row execute function public.handle_updated_at();
