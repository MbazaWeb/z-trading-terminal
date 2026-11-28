"use client";

import { createClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client.
 *
 * Uses the anon key (safe to expose to the browser) and the public Supabase URL.
 * Both are set via environment variables in .env (local) or Vercel project settings.
 *
 * Register your Supabase project at https://supabase.com/dashboard and set:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. " +
      "Supabase features will not work until these env vars are configured.",
  );
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      // IMPORTANT: Deriv OAuth redirects to `/#access_token=...&acct1=...`.
      // If `detectSessionInUrl` were true, the Supabase auth client would
      // try to parse that hash as a Supabase auth session and silently
      // invoke `window.location.hash = ""`, clearing the Deriv token before
      // our useDerivCallback hook can read it. We are not using Supabase
      // Auth at all (only the trades table), so we disable this feature.
      detectSessionInUrl: false,
    },
  },
);

// ---- Type helpers (mirror the Supabase schema) ------------------------------

export interface TradeRow {
  id: string;
  status: "open" | "closed";
  datetime: string; // ISO timestamp
  market: string;
  side: "buy" | "sell";
  amount: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number;
  pnl_pct: number;
  result: "win" | "loss" | null;
  agent_id: string | null;
  source: "seed" | "agent" | "bot" | "manual";
  user_id: string | null;
  created_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  strategy: string;
  strategy_type: string;
  status: "active" | "paused" | "training";
  win_rate: number;
  total_trades: number;
  pnl: number;
  self_improvements: number;
  confidence: number;
  is_learning: boolean;
  user_id: string | null;
  created_at: string;
}

export interface BotPositionRow {
  id: string;
  trade_id: string;
  symbol: string;
  side: "buy" | "sell";
  size: number;
  entry_price: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  opened_at: string;
  agent_id: string | null;
  user_id: string | null;
}

export interface BotLogRow {
  id: string;
  timestamp: string;
  tag: "SIGNAL" | "RISK-CHECK" | "ORDER" | "STOP-LOSS" | "TAKE-PROFIT" | "INFO";
  message: string;
  user_id: string | null;
}

export interface AgentImprovementRow {
  id: string;
  agent_id: string;
  timestamp: string;
  trigger: string;
  parameter_change: string;
  confidence_delta: number;
  new_confidence: number;
}
