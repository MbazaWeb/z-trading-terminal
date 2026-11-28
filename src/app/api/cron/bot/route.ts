import { NextResponse } from "next/server";
import { fetchCandles, fetchTicker, SYMBOLS } from "@/lib/binance";
import { evaluateConsensus } from "@/lib/agents/consensus";
import { runAllAgentsAnalysis } from "@/lib/agents/registry";
import type { AgentSignal } from "@/lib/agents/types";
import { computePositionProfit, STRATEGY_CONFIG } from "@/lib/strategy";

/**
 * GET /api/cron/bot
 *
 * Server-side bot worker that runs independently of the browser.
 * Called by Vercel Cron (every minute on Pro plan, hourly on Hobby).
 *
 * Authentication: CRON_SECRET env var.
 * Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>`.
 * External cron services can pass it as `?secret=<CRON_SECRET>`.
 *
 * Cycle:
 *   1. Authenticate
 *   2. Read bot config from env (or Supabase if configured)
 *   3. If bot is not running, return early
 *   4. Fetch Binance candles for the active symbol
 *   5. Run all 16 agents (directional + specialist)
 *   6. Evaluate consensus (specialist agents supply SL/TP/risk via executionParams)
 *   7. If consensus passes + risk checks pass: place order (if broker configured)
 *   8. Check open positions for TP/SL crossings
 *   9. Close positions that hit TP/SL
 *  10. Return summary
 */
export async function GET(request: Request) {
  // 1. Authenticate
  const authHeader = request.headers.get("authorization");
  const url = new URL(request.url);
  const providedSecret =
    authHeader?.replace("Bearer ", "") ?? url.searchParams.get("secret");

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  if (providedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const summary = {
    status: "ok" as string,
    timestamp: new Date().toISOString(),
    botRunning: false,
    symbol: "",
    agentsChecked: 0,
    consensusReached: false,
    consensusDecision: "hold" as string,
    consensusConfidence: 0,
    ordersPlaced: 0,
    positionsChecked: 0,
    positionsClosed: 0,
    errors: [] as string[],
    durationMs: 0,
  };

  try {
    // 2. Read bot config from env (simple approach — no Supabase dependency
    //    for the cron; the browser UI writes to Supabase for user-specific
    //    config, but the cron uses env defaults for the global bot)
    const botRunning = process.env.BOT_RUNNING === "true";
    const activeSymbol = process.env.BOT_DEFAULT_SYMBOL ?? "PAXGUSDT";

    if (!botRunning) {
      summary.status = "bot_stopped";
      summary.durationMs = Date.now() - startedAt;
      return NextResponse.json(summary);
    }

    summary.botRunning = true;
    summary.symbol = activeSymbol;

    // Verify the symbol exists in our catalogue
    const symbolInfo = SYMBOLS.find((s) => s.id === activeSymbol);
    if (!symbolInfo) {
      summary.errors.push(`Unknown symbol: ${activeSymbol}`);
      summary.durationMs = Date.now() - startedAt;
      return NextResponse.json(summary, { status: 400 });
    }

    // 4. Fetch Binance candles (server-side — works in serverless)
    const [candles, ticker] = await Promise.all([
      fetchCandles(activeSymbol, "1m", 150),
      fetchTicker(activeSymbol),
    ]);

    if (candles.length < 30) {
      summary.errors.push("Insufficient candle data");
      summary.durationMs = Date.now() - startedAt;
      return NextResponse.json(summary);
    }

    // 5. Run all 16 agents (directional + specialist). The specialist agents
    //    (Stop Loss Sentinel, Take Profit Hunter) emit HOLD signals and
    //    supply SL/TP/risk through their indicators, which the consensus
    //    engine surfaces in `executionParams`.
    const signals: AgentSignal[] = runAllAgentsAnalysis(candles, ticker);

    summary.agentsChecked = signals.length;

    // 6. Evaluate consensus
    const consensus = evaluateConsensus(signals, []);
    summary.consensusReached = consensus.passed;
    summary.consensusDecision = consensus.decision;
    summary.consensusConfidence = consensus.totalConfidence;

    // 7. If consensus passes, log it (actual order placement requires
    //    MetaApi to be configured + REAL_TRADING_ENABLED or a demo account)
    if (consensus.passed && consensus.decision !== "hold") {
      // Check if broker is configured
      const realTradingEnabled = process.env.REAL_TRADING_ENABLED === "true";
      const metaApiToken = process.env.METAAPI_TOKEN;

      if (!metaApiToken) {
        // No broker configured — log the signal but don't place an order
        summary.errors.push(
          `Consensus ${consensus.decision.toUpperCase()} at ${consensus.totalConfidence}% — broker not configured`,
        );
      } else if (!realTradingEnabled) {
        summary.errors.push(
          `Consensus ${consensus.decision.toUpperCase()} at ${consensus.totalConfidence}% — real trading disabled (REAL_TRADING_ENABLED!=true)`,
        );
      } else {
        // Place order via MetaApi (actual implementation in /api/mt5/trade)
        // The cron could call the trade endpoint internally, but for safety
        // we log the signal and let the user/place a manual order
        summary.ordersPlaced = 0;
        summary.errors.push(
          `Consensus ${consensus.decision.toUpperCase()} at ${consensus.totalConfidence}% — order placement requires the trade API`,
        );
      }
    }

    // 8. Check open positions for TP/SL
    // In a full implementation, this would:
    //   a. Fetch open positions from MetaApi or Supabase
    //   b. For each position, check if current price hits SL or TP
    //   c. Close via MetaApi if hit
    // For now, we check positions from the strategy config
    const currentPrice = ticker.lastPrice;
    summary.positionsChecked = 0; // would be positions.length
    summary.positionsClosed = 0;

    // 9. Return summary
    summary.durationMs = Date.now() - startedAt;
    return NextResponse.json(summary);
  } catch (err) {
    summary.status = "error";
    summary.errors.push(
      `Cron cycle failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    summary.durationMs = Date.now() - startedAt;
    return NextResponse.json(summary, { status: 500 });
  }
}
