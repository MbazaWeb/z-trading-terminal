"use client";

// Trade persistence store.
//
// On mount we try to load the trade history from Supabase. If the Supabase env
// vars (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`) are not
// configured, or the request fails, we fall back to an in-memory list (cleared
// on refresh). This keeps the terminal fully functional in local dev without a
// database while still persisting real trades when Supabase is wired up.
//
// The store also exposes the same `addTrade` / `closeTrade` actions the
// TradePanel and bot use to record new positions — they handle the Supabase
// insert / update transparently and fall back to local state on failure.

import { create } from "zustand";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { TradeRow } from "@/lib/supabase";

// ---- Shared trade types -----------------------------------------------------

export type TradeStatus = "open" | "closed";
export type TradeSide = "buy" | "sell";
export type TradeResult = "win" | "loss" | null;
export type TradeSource = "seed" | "agent" | "bot" | "manual";

export interface Trade {
  id: string;
  status: TradeStatus;
  datetime: number; // ms timestamp
  market: string;
  side: TradeSide;
  amount: number; // $ notional
  entryPrice: number;
  exitPrice: number | null;
  pnl: number;
  pnlPct: number;
  result: TradeResult;
  agentId: string | null;
  source: TradeSource;
}

// ---- Helpers ---------------------------------------------------------------

let liveCounter = 0;
function liveId(prefix: string): string {
  liveCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${liveCounter}`;
}

function rowToTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    status: row.status,
    datetime: new Date(row.datetime).getTime(),
    market: row.market,
    side: row.side,
    amount: Number(row.amount),
    entryPrice: Number(row.entry_price),
    exitPrice: row.exit_price != null ? Number(row.exit_price) : null,
    pnl: Number(row.pnl),
    pnlPct: Number(row.pnl_pct),
    result: row.result as TradeResult,
    agentId: row.agent_id,
    source: row.source as TradeSource,
  };
}

function tradeToRow(t: Trade): Omit<TradeRow, "created_at"> {
  return {
    id: t.id,
    status: t.status,
    datetime: new Date(t.datetime).toISOString(),
    market: t.market,
    side: t.side,
    amount: t.amount,
    entry_price: t.entryPrice,
    exit_price: t.exitPrice,
    pnl: t.pnl,
    pnl_pct: t.pnlPct,
    result: t.result,
    agent_id: t.agentId,
    source: t.source,
    user_id: null,
  };
}

function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  if (url.includes("placeholder.supabase.co")) return false;
  if (key.includes("placeholder-anon-key")) return false;
  return true;
}

// ---- Store -----------------------------------------------------------------

interface TradeStoreState {
  trades: Trade[];
  loading: boolean;
  usingSupabase: boolean;
  loaded: boolean;

  fetchTrades: () => Promise<void>;
  addTrade: (trade: Trade) => Promise<void>;
  closeTrade: (
    id: string,
    exitPrice: number,
    pnl: number,
    pnlPct: number,
    result: "win" | "loss",
  ) => Promise<void>;

  // Local-only variants (no Supabase round-trip — used by the bot's tight
  // automation loop to avoid latency).
  addTradeLocal: (trade: Trade) => void;
  closeTradeLocal: (
    id: string,
    exitPrice: number,
    pnl: number,
    pnlPct: number,
    result: "win" | "loss",
  ) => void;
}

export const useTradeStore = create<TradeStoreState>((set, get) => ({
  trades: [],
  loading: false,
  usingSupabase: isSupabaseConfigured(),
  loaded: false,

  fetchTrades: async () => {
    if (get().loaded) return;
    set({ loading: true });
    if (!get().usingSupabase) {
      set({ loading: false, loaded: true });
      return;
    }
    try {
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .order("datetime", { ascending: false })
        .limit(500);
      if (error) throw error;
      const trades = (data ?? []).map(rowToTrade);
      set({ trades, loading: false, loaded: true });
    } catch (err) {
      console.warn("[tradeStore] fetchTrades failed, falling back to local:", err);
      set({ loading: false, loaded: true });
    }
  },

  addTrade: async (trade) => {
    // Always update local state immediately so the UI is responsive.
    set((s) => ({ trades: [trade, ...s.trades].slice(0, 1000) }));
    if (!get().usingSupabase) return;
    try {
      const row = tradeToRow(trade);
      const { error } = await supabase.from("trades").insert(row);
      if (error) throw error;
    } catch (err) {
      console.warn("[tradeStore] addTrade Supabase insert failed:", err);
      toast.error("Trade saved locally — Supabase sync failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  },

  closeTrade: async (id, exitPrice, pnl, pnlPct, result) => {
    set((s) => ({
      trades: s.trades.map((t) =>
        t.id === id
          ? {
              ...t,
              status: "closed",
              exitPrice,
              pnl,
              pnlPct,
              result,
            }
          : t,
      ),
    }));
    if (!get().usingSupabase) return;
    try {
      const { error } = await supabase
        .from("trades")
        .update({
          status: "closed",
          exit_price: exitPrice,
          pnl,
          pnl_pct: pnlPct,
          result,
        })
        .eq("id", id);
      if (error) throw error;
    } catch (err) {
      console.warn("[tradeStore] closeTrade Supabase update failed:", err);
    }
  },

  addTradeLocal: (trade) =>
    set((s) => ({ trades: [trade, ...s.trades].slice(0, 1000) })),

  closeTradeLocal: (id, exitPrice, pnl, pnlPct, result) =>
    set((s) => ({
      trades: s.trades.map((t) =>
        t.id === id
          ? {
              ...t,
              status: "closed",
              exitPrice,
              pnl,
              pnlPct,
              result,
            }
          : t,
      ),
    })),
}));

// ---- Hook ------------------------------------------------------------------

export function useTrades(): Trade[] {
  return useTradeStore((s) => s.trades);
}

export function newTradeId(prefix: TradeSource): string {
  return liveId(prefix);
}

// ---- Stats helper (used by Dashboard / Agents views) -----------------------

export interface AgentTradeStats {
  winRate: number;
  totalTrades: number;
  pnl: number;
  sparkline: number[];
}

export function computeAgentStats(
  trades: Trade[],
  agentId: string,
): AgentTradeStats {
  const closed = trades.filter(
    (t) => t.agentId === agentId && t.status === "closed",
  );
  const wins = closed.filter((t) => t.result === "win").length;
  const pnl = closed.reduce((sum, t) => sum + t.pnl, 0);
  const totalTrades = closed.length;
  const winRate =
    totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0;
  const sparkline = closed
    .slice(-20)
    .reduce<number[]>((acc, t) => {
      const prev = acc.length > 0 ? acc[acc.length - 1] : 0;
      acc.push(Math.round((prev + t.pnl) * 100) / 100);
      return acc;
    }, []);
  return {
    winRate,
    totalTrades,
    pnl: Math.round(pnl * 100) / 100,
    sparkline,
  };
}
