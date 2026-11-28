// Strategy backtesting on historical candle data.
//
// Given an agent id, a Binance symbol + interval, and (optionally) a set of
// historical candles, this module:
//   1. Fetches ~500 historical candles from Binance (when not supplied).
//   2. Walks a sliding window of `WINDOW_SIZE` candles across the series.
//   3. For each window position, runs the agent's analyzer on the window.
//   4. Simulates a single long/short position per agent:
//        - On a BUY signal with no open position, open a long at the close.
//        - On a SELL signal with an open long, close it at the close.
//        - On a SELL signal with no open position, open a short.
//        - On a BUY signal with an open short, close it at the close.
//        - HOLD signals never act.
//      The simulator uses a fixed notional per trade (default $100) so P&L
//      numbers are comparable across agents and symbols.
//   5. Computes the equity curve and an AgentPerformance rollup.
//
// The backtest is deterministic and side-effect free (apart from the optional
// Binance fetch). It is safe to run server-side from the /api/agents/backtest
// route and from the cron worker (e.g. to A/B-test a new strategy version).
//
// IMPORTANT: the backtest does NOT place real orders and does NOT touch the
// broker. It is a read-only historical replay.

import { fetchCandles } from "@/lib/binance";
import type { Candle, TickerStats } from "@/components/trading/types";
import { getAgentById, makeAgentStub } from "./registry";
import { calculatePerformance, type PerformanceTrade } from "./performance";
import type { AgentPerformance, AgentSignal } from "./types";

/** Number of candles the analyzer sees at each backtest step. */
const DEFAULT_WINDOW_SIZE = 50;
/** Default notional (USD) per simulated trade. */
const DEFAULT_NOTIONAL = 100;
/** Default candle limit fetched from Binance when none are supplied. */
const DEFAULT_CANDLE_LIMIT = 500;

export interface BacktestTrade {
  id: string;
  agentId: string;
  status: "open" | "closed";
  result: "win" | "loss" | null;
  pnl: number;
  /** Open timestamp (ms). */
  datetime: number;
  brokerOpenTime: number | null;
  brokerCloseTime: number | null;
  holdTimeMs: number | null;
  side: "buy" | "sell";
  entryPrice: number;
  exitPrice: number | null;
}

export interface BacktestResult {
  agentId: string;
  symbol: string;
  interval: string;
  trades: BacktestTrade[];
  performance: AgentPerformance;
  equity: number[];
  /** Closing prices aligned with the equity curve's final index (for charts). */
  candlesAnalyzed: number;
  notional: number;
}

interface OpenSimPosition {
  side: "buy" | "sell";
  entryIndex: number;
  entryPrice: number;
  openTimeMs: number;
}

function buildTicker(candles: Candle[]): TickerStats {
  if (candles.length === 0) {
    return {
      lastPrice: 0,
      open24h: 0,
      changeAbs: 0,
      changePercent: 0,
      high24h: 0,
      low24h: 0,
      volume24h: 0,
      volumeBase24h: 0,
    };
  }
  const last = candles[candles.length - 1];
  const first = candles[0];
  const lastPrice = last.close;
  const open24h = first.open;
  const changeAbs = lastPrice - open24h;
  const changePercent = open24h > 0 ? (changeAbs / open24h) * 100 : 0;
  let high = -Infinity;
  let low = Infinity;
  let volumeBase = 0;
  for (const c of candles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    volumeBase += c.volume;
  }
  return {
    lastPrice,
    open24h,
    changeAbs,
    changePercent,
    high24h: high,
    low24h: low,
    volume24h: lastPrice * volumeBase,
    volumeBase24h: volumeBase,
  };
}

/**
 * Run a backtest for the given agent over historical candles.
 *
 * @param agentId  The agent registry id (e.g. "momentum").
 * @param symbol   Binance symbol (e.g. "BTCUSDT").
 * @param interval Binance kline interval (e.g. "15m").
 * @param candles  Optional pre-fetched candle series. When omitted the function
 *                 fetches `DEFAULT_CANDLE_LIMIT` candles from Binance.
 * @param options  Optional overrides for window size + per-trade notional.
 */
export async function backtestStrategy(
  agentId: string,
  symbol: string,
  interval: string,
  candles?: Candle[],
  options?: { windowSize?: number; notional?: number; candleLimit?: number },
): Promise<BacktestResult> {
  const entry = getAgentById(agentId);
  if (!entry) {
    throw new Error(`Unknown agent id: ${agentId}`);
  }

  const windowSize = Math.max(10, options?.windowSize ?? DEFAULT_WINDOW_SIZE);
  const notional = Math.max(1, options?.notional ?? DEFAULT_NOTIONAL);
  const candleLimit = Math.max(
    windowSize + 10,
    options?.candleLimit ?? DEFAULT_CANDLE_LIMIT,
  );

  const series = candles ?? (await fetchCandles(symbol, interval, candleLimit));
  if (series.length < windowSize + 5) {
    throw new Error(
      `Backtest requires at least ${windowSize + 5} candles, got ${series.length}.`,
    );
  }

  const trades: BacktestTrade[] = [];
  const equity: number[] = [0];
  let cumulativePnl = 0;
  let open: OpenSimPosition | null = null;
  let tradeCounter = 0;

  const agentStub = makeAgentStub(entry);

  for (let i = windowSize; i < series.length; i++) {
    const window = series.slice(0, i + 1);
    const candle = window[window.length - 1];
    const ticker = buildTicker(window);

    let signal: AgentSignal | null = null;
    try {
      signal = entry.analyzer(agentStub, window, ticker);
    } catch {
      // An analyzer throwing on a malformed window should not abort the whole
      // backtest — skip this step.
      signal = null;
    }
    if (!signal) continue;

    const action = signal.action;
    const price = candle.close;
    const ts = candle.time;

    if (action === "buy" && open == null) {
      open = {
        side: "buy",
        entryIndex: i,
        entryPrice: price,
        openTimeMs: ts,
      };
    } else if (action === "sell" && open == null) {
      open = {
        side: "sell",
        entryIndex: i,
        entryPrice: price,
        openTimeMs: ts,
      };
    } else if (action === "buy" && open != null && open.side === "sell") {
      // Close the short.
      const dir = -1;
      const size = notional / open.entryPrice;
      const pnl = Math.round((price - open.entryPrice) * dir * size * 100) / 100;
      cumulativePnl += pnl;
      tradeCounter += 1;
      trades.push({
        id: `bt-${agentId}-${tradeCounter}`,
        agentId,
        status: "closed",
        result: pnl >= 0 ? "win" : "loss",
        pnl,
        datetime: open.openTimeMs,
        brokerOpenTime: open.openTimeMs,
        brokerCloseTime: ts,
        holdTimeMs: ts - open.openTimeMs,
        side: open.side,
        entryPrice: open.entryPrice,
        exitPrice: price,
      });
      equity.push(Math.round(cumulativePnl * 100) / 100);
      open = null;
    } else if (action === "sell" && open != null && open.side === "buy") {
      // Close the long.
      const dir = 1;
      const size = notional / open.entryPrice;
      const pnl = Math.round((price - open.entryPrice) * dir * size * 100) / 100;
      cumulativePnl += pnl;
      tradeCounter += 1;
      trades.push({
        id: `bt-${agentId}-${tradeCounter}`,
        agentId,
        status: "closed",
        result: pnl >= 0 ? "win" : "loss",
        pnl,
        datetime: open.openTimeMs,
        brokerOpenTime: open.openTimeMs,
        brokerCloseTime: ts,
        holdTimeMs: ts - open.openTimeMs,
        side: open.side,
        entryPrice: open.entryPrice,
        exitPrice: price,
      });
      equity.push(Math.round(cumulativePnl * 100) / 100);
      open = null;
    }
  }

  // If a position is still open at the end of the backtest, close it at the
  // last close price so the equity curve reflects realized P&L.
  if (open != null) {
    const lastCandle = series[series.length - 1];
    const price = lastCandle.close;
    const ts = lastCandle.time;
    const dir = open.side === "buy" ? 1 : -1;
    const size = notional / open.entryPrice;
    const pnl = Math.round((price - open.entryPrice) * dir * size * 100) / 100;
    cumulativePnl += pnl;
    tradeCounter += 1;
    trades.push({
      id: `bt-${agentId}-${tradeCounter}`,
      agentId,
      status: "closed",
      result: pnl >= 0 ? "win" : "loss",
      pnl,
      datetime: open.openTimeMs,
      brokerOpenTime: open.openTimeMs,
      brokerCloseTime: ts,
      holdTimeMs: ts - open.openTimeMs,
      side: open.side,
      entryPrice: open.entryPrice,
      exitPrice: price,
    });
    equity.push(Math.round(cumulativePnl * 100) / 100);
    open = null;
  }

  const perfTrades: PerformanceTrade[] = trades.map((t) => ({
    agentId: t.agentId,
    status: t.status,
    result: t.result,
    pnl: t.pnl,
    datetime: t.datetime,
    brokerOpenTime: t.brokerOpenTime,
    brokerCloseTime: t.brokerCloseTime,
    holdTimeMs: t.holdTimeMs,
  }));
  const performance = calculatePerformance(perfTrades, agentId);

  return {
    agentId,
    symbol,
    interval,
    trades,
    performance,
    equity,
    candlesAnalyzed: series.length,
    notional,
  };
}
