import { NextResponse } from "next/server";
import {
  requireAuth,
  authErrorResponse,
} from "@/lib/auth/session";
import { backtestStrategy } from "@/lib/agents/backtest";
import { getAgentById } from "@/lib/agents/registry";

/**
 * GET /api/agents/backtest?agentId=momentum&symbol=BTCUSDT&interval=15m
 *
 * Runs a backtest for the given agent on historical Binance candles and
 * returns the simulated trade list, equity curve, and performance rollup
 * (win rate, profit factor, max drawdown, Sharpe ratio).
 *
 * Requires an authenticated session (the backtest itself is read-only but
 * we gate it behind auth so anonymous abuse can't rack up Binance API
 * quota against the deploy).
 *
 * Query params:
 *   agentId:  string (required) — one of the AGENT_REGISTRY ids.
 *   symbol:   string (default "BTCUSDT") — Binance symbol.
 *   interval: string (default "15m") — Binance kline interval.
 *   limit:    number (default 500, max 1000) — number of historical candles.
 *   notional: number (default 100) — simulated notional per trade in USD.
 *
 * Returns:
 *   { ok: true, result: BacktestResult }
 */

const ALLOWED_INTERVALS = new Set([
  "1m",
  "5m",
  "15m",
  "1H",
  "4H",
  "1D",
  "1W",
]);

export async function GET(request: Request) {
  try {
    await requireAuth();
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }

  const url = new URL(request.url);
  const agentId = (url.searchParams.get("agentId") ?? "").trim();
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").trim() || "BTCUSDT";
  const rawInterval = (url.searchParams.get("interval") ?? "15m").trim() || "15m";
  const interval = ALLOWED_INTERVALS.has(rawInterval) ? rawInterval : "15m";
  const limitParam = Number(url.searchParams.get("limit") ?? 500);
  const candleLimit = Number.isFinite(limitParam)
    ? Math.min(1000, Math.max(60, Math.floor(limitParam)))
    : 500;
  const notionalParam = Number(url.searchParams.get("notional") ?? 100);
  const notional = Number.isFinite(notionalParam)
    ? Math.min(10_000, Math.max(1, notionalParam))
    : 100;

  if (!agentId) {
    return NextResponse.json(
      { ok: false, error: "agentId is required" },
      { status: 400 },
    );
  }
  if (!getAgentById(agentId)) {
    return NextResponse.json(
      { ok: false, error: `Unknown agent id: ${agentId}` },
      { status: 400 },
    );
  }

  try {
    const result = await backtestStrategy(agentId, symbol, interval, undefined, {
      candleLimit,
      notional,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Backtest failed",
      },
      { status: 500 },
    );
  }
}
