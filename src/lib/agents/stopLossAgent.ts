// Stop Loss Sentinel — ATR + structure based stop-loss calculator.
//
// SPECIALIST agent: this agent never votes on direction (always HOLD).
// It calculates the recommended stop-loss level for a notional long or
// short entry using:
//   - ATR-based SL distance: 1.5 * ATR from the entry price.
//   - Structural SL: the prior 20-candle swing low (for longs) or swing
//     high (for shorts).
//   - Final SL = the tighter of the two that still sits beyond noise.
// The consensus engine surfaces the SL value in
// `ConsensusResult.executionParams.stopLoss`.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { atr, rollingHighLow } from "./indicators";

const ATR_MULT = 1.5;
const LOOKBACK = 20;

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const lastPrice = ticker.lastPrice;

  if (candles.length < LOOKBACK + 1) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      action: "hold",
      confidence: 25,
      reasoning: "Not enough candle history to compute structural stop loss.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const atrVal = atr(candles, 14);
  const { high: resistance, low: support } = rollingHighLow(
    candles.slice(0, -1),
    LOOKBACK,
  );
  const atrStop = atrVal * ATR_MULT;

  // Recommended SL for a long and a short. We surface both — the
  // consensus engine picks the one matching the directional decision.
  const longSL = Math.max(support, lastPrice - atrStop);
  const shortSL = Math.min(resistance, lastPrice + atrStop);
  // Default to the long SL for display; the consensus layer overrides
  // based on the directional decision.
  const recommendedSL = longSL;
  const riskPerUnit = Math.abs(lastPrice - recommendedSL);
  const slPct = (riskPerUnit / lastPrice) * 100;

  const reasoning = `Recommended SL $${recommendedSL.toFixed(
    2,
  )} (long: $${longSL.toFixed(2)} / short: $${shortSL.toFixed(
    2,
  )}) — ATR stop ${atrStop.toFixed(2)} = ${ATR_MULT}x ATR, structural low ${support.toFixed(
    2,
  )}, structural high ${resistance.toFixed(2)}, risk per unit $${riskPerUnit.toFixed(2)} (${slPct.toFixed(
    2,
  )}%).`;

  const confidence = Math.round(
    Math.min(85, 50 + agent.confidence * 0.35),
  );

  return {
    agentId: agent.id,
    agentName: agent.name,
    action: "hold",
    confidence,
    reasoning,
    indicators: [
      { name: "ATRStop", value: Number(atrStop.toFixed(4)) },
      { name: "Support", value: Number(support.toFixed(4)) },
      { name: "Resistance", value: Number(resistance.toFixed(4)) },
      { name: "RecommendedSL", value: Number(recommendedSL.toFixed(4)) },
      { name: "LongSL", value: Number(longSL.toFixed(4)) },
      { name: "ShortSL", value: Number(shortSL.toFixed(4)) },
      { name: "RiskPerUnit", value: Number(riskPerUnit.toFixed(4)) },
      { name: "SLPct", value: Number(slPct.toFixed(2)) },
    ],
    timestamp: Date.now(),
  };
}
