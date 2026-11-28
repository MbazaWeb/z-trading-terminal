"use client";

// Bot state store (positions, config, activity log).
//
// The bot reads consensus results from the agent store and, when running and
// the consensus passes, opens a new position at the current live price. Open
// positions are polled against live Binance prices by the shell so current
// price + P&L stay accurate, and SL / TP crossings trigger automatic closure.
//
// All state is in-memory (not persisted to Supabase) — the bot is a
// short-lived automation surface, while the resulting trades ARE persisted
// through the trade store.

import { create } from "zustand";
import { toast } from "sonner";
import { formatPrice } from "@/lib/format";

export type BotLogTag =
  | "SIGNAL"
  | "RISK-CHECK"
  | "ORDER"
  | "STOP-LOSS"
  | "TAKE-PROFIT"
  | "INFO";

export interface BotLogEntry {
  id: string;
  timestamp: number;
  tag: BotLogTag;
  message: string;
}

export interface BotPosition {
  id: string;
  tradeId: string;
  symbol: string;
  side: "buy" | "sell";
  size: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  agentId: string | null;
}

export interface BotConfig {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxConcurrentPositions: number;
  defaultStopLoss: number; // %
  defaultTakeProfit: number; // %
  riskPerTrade: number; // %
}

export interface BotState {
  running: boolean;
  startedAt: number | null;
  positions: BotPosition[];
  log: BotLogEntry[];
  config: BotConfig;
  tradesPlacedToday: number;
}

let logCounter = 0;
function logId(): string {
  logCounter += 1;
  return `blog-${Date.now().toString(36)}-${logCounter}`;
}

let posCounter = 0;
function posId(): string {
  posCounter += 1;
  return `pos-${Date.now().toString(36)}-${posCounter}`;
}

const DEFAULT_CONFIG: BotConfig = {
  maxPositionSize: 500,
  maxDailyLoss: 200,
  maxConcurrentPositions: 5,
  defaultStopLoss: 1.5,
  defaultTakeProfit: 3.0,
  riskPerTrade: 2,
};

// ---- Store -----------------------------------------------------------------

interface BotStoreState extends BotState {
  setBotRunning: (running: boolean) => void;
  updateBotConfig: (patch: Partial<BotConfig>) => void;
  addBotLog: (tag: BotLogTag, message: string) => void;
  openBotPosition: (pos: BotPosition, tradeId: string) => void;
  closeBotPosition: (
    posId: string,
    exitPrice: number,
    reason: "SL" | "TP" | "manual",
  ) => void;
  updatePositionPrice: (posId: string, currentPrice: number) => void;
  /** Replace the entire positions array (used by BotView when syncing from /api/mt5/positions). */
  setPositions: (positions: BotPosition[]) => void;
  /** Replace the entire log array (used by BotView when syncing from /api/bot/logs). */
  setLogs: (logs: BotLogEntry[]) => void;
  reset: () => void;
}

export const useBotStore = create<BotStoreState>((set, get) => ({
  running: false,
  startedAt: null,
  positions: [],
  log: [],
  config: DEFAULT_CONFIG,
  tradesPlacedToday: 0,

  setBotRunning: (running) =>
    set((s) => ({
      bot: undefined,
      running,
      startedAt: running ? Date.now() : s.startedAt,
      log: running
        ? s.log
        : [
            {
              id: logId(),
              timestamp: Date.now(),
              tag: "INFO" as BotLogTag,
              message: "Bot stopped -- press Start to resume",
            },
            ...s.log,
          ].slice(0, 100),
    })),

  updateBotConfig: (patch) =>
    set((s) => ({ config: { ...s.config, ...patch } })),

  addBotLog: (tag, message) =>
    set((s) => ({
      log: [
        { id: logId(), timestamp: Date.now(), tag, message },
        ...s.log,
      ].slice(0, 100),
    })),

  openBotPosition: (pos, tradeId) =>
    set((s) => ({
      positions: [...s.positions, pos],
      tradesPlacedToday: s.tradesPlacedToday + 1,
      log: [
        {
          id: logId(),
          timestamp: Date.now(),
          tag: "ORDER" as BotLogTag,
          message: `Opened ${pos.side.toUpperCase()} ${pos.size.toFixed(4)} ${pos.symbol} @ ${formatPrice(
            pos.entryPrice,
          )} (SL @ ${formatPrice(pos.stopLoss)}, TP @ ${formatPrice(pos.takeProfit)})`,
        },
        ...s.log,
      ].slice(0, 100),
    })),

  closeBotPosition: (posId, exitPrice, reason) => {
    const pos = get().positions.find((p) => p.id === posId);
    if (!pos) return;
    const dir = pos.side === "buy" ? 1 : -1;
    const pnl =
      Math.round((exitPrice - pos.entryPrice) * dir * pos.size * 100) / 100;
    const tag: BotLogTag = reason === "SL" ? "STOP-LOSS" : reason === "TP" ? "TAKE-PROFIT" : "INFO";
    const message =
      reason === "SL"
        ? `STOP-LOSS triggered on ${pos.symbol} @ ${formatPrice(exitPrice)} (loss -$${Math.abs(pnl).toFixed(2)})`
        : reason === "TP"
          ? `TAKE-PROFIT hit on ${pos.symbol} @ ${formatPrice(exitPrice)} (profit +$${pnl.toFixed(2)})`
          : `Manually closed ${pos.symbol} @ ${formatPrice(exitPrice)} (${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)})`;
    set((s) => ({
      positions: s.positions.filter((p) => p.id !== posId),
      log: [{ id: logId(), timestamp: Date.now(), tag, message }, ...s.log].slice(0, 100),
    }));
    if (reason === "SL") {
      toast.error(`Stop-loss triggered on ${pos.symbol}`, {
        description: `Closed @ ${formatPrice(exitPrice)} — loss $${Math.abs(pnl).toFixed(2)}`,
      });
    } else if (reason === "TP") {
      toast.success(`Take-profit hit on ${pos.symbol}`, {
        description: `Closed @ ${formatPrice(exitPrice)} — profit +$${pnl.toFixed(2)}`,
      });
    }
  },

  updatePositionPrice: (posId, currentPrice) =>
    set((s) => ({
      positions: s.positions.map((p) =>
        p.id === posId ? { ...p, currentPrice } : p,
      ),
    })),

  setPositions: (positions) => set({ positions }),

  setLogs: (logs) => set({ log: logs.slice(0, 200) }),

  reset: () =>
    set({
      running: false,
      startedAt: null,
      positions: [],
      log: [],
      config: DEFAULT_CONFIG,
      tradesPlacedToday: 0,
    }),
}));

// ---- Hooks -----------------------------------------------------------------

export function useBot(): BotState {
  return useBotStore((s) => ({
    running: s.running,
    startedAt: s.startedAt,
    positions: s.positions,
    log: s.log,
    config: s.config,
    tradesPlacedToday: s.tradesPlacedToday,
  }));
}

export function makePositionId(): string {
  return posId();
}

// ---- Position sizing (equity-based) ---------------------------------------

/**
 * Compute the position size (in quote currency, e.g. USD) for the next bot
 * trade based on the REAL account balance and the bot's risk-per-trade %.
 *
 * Replaces the old `5000 * riskPerTrade / 100` hardcoded fallback that
 * ignored the actual account balance. The caller supplies the live balance
 * from the auth store; if it is null/0/NaN the function returns 0 so the
 * caller can refuse to place the trade ("Account balance not available").
 *
 * The result is clamped to [0, config.maxPositionSize].
 */
export function computeEquityPositionSize(
  accountBalance: number | null | undefined,
  config: BotConfig,
): number {
  if (
    accountBalance == null ||
    typeof accountBalance !== "number" ||
    !Number.isFinite(accountBalance) ||
    accountBalance <= 0
  ) {
    return 0;
  }
  const raw = (accountBalance * config.riskPerTrade) / 100;
  return Math.min(config.maxPositionSize, Math.max(0, raw));
}
