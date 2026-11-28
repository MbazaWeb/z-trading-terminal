// Take Profit Hunter — ATR + structure based take-profit calculator.
//
// SPECIALIST agent: this agent never votes on direction (always HOLD).
// It calculates the recommended take-profit level using:
//   - ATR-based TP distance: 2 * ATR from the entry price (1:2 risk
//     reward against the 1.5x ATR stop).
//   - Structural TP: the prior 20-candle resistance (for longs) or
//     support (for shorts).
//   - Final TP = the further of the two so the trader targets the full
//     structural move.
// The consensus engine surfaces the TP value in
// `ConsensusResult.executionParams.takeProfit`.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { atr, rollingHighLow } from "./indicators";

const ATR_MULT = 2;
const LOOKBACK = 20;
// Risk per unit assumed for R:R computation = 1.5x ATR (matches Stop Loss
// Sentinel). TP at 2x ATR gives R:R = 2 / 1.5 = 1.33 by default; structural
// targets can extend it further.
const ASSUMED_RISK_ATR = 1.5;

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
      reasoning: "Not enough candle history to compute structural take profit.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const atrVal = atr(candles, 14);
  const { high: resistance, low: support } = rollingHighLow(
    candles.slice(0, -1),
    LOOKBACK,
  );
  const atrTP = atrVal * ATR_MULT;

  const longTP = lastPrice + Math.max(atrTP, resistance - lastPrice);
  const shortTP = lastPrice - Math.max(atrTP, lastPrice - support);
  const recommendedTP = longTP;
  const profitPerUnit = Math.abs(recommendedTP - lastPrice);
  const tpPct = (profitPerUnit / lastPrice) * 100;
  const riskUnit = atrVal * ASSUMED_RISK_ATR;
  const riskReward = riskUnit > 0 ? profitPerUnit / riskUnit : 0;

  const reasoning = `Recommended TP $${recommendedTP.toFixed(
    2,
  )} (long: $${longTP.toFixed(2)} / short: $${shortTP.toFixed(
    2,
  )}) — ATR target ${atrTP.toFixed(2)} = ${ATR_MULT}x ATR, structural resistance ${resistance.toFixed(
    2,
  )}, structural support ${support.toFixed(2)}, profit per unit $${profitPerUnit.toFixed(
    2,
  )} (${tpPct.toFixed(2)}%), R:R ${riskReward.toFixed(2)}.`;

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
      { name: "ATRTP", value: Number(atrTP.toFixed(4)) },
      { name: "TargetLevel", value: Number(recommendedTP.toFixed(4)) },
      { name: "RecommendedTP", value: Number(recommendedTP.toFixed(4)) },
      { name: "LongTP", value: Number(longTP.toFixed(4)) },
      { name: "ShortTP", value: Number(shortTP.toFixed(4)) },
      { name: "ProfitPerUnit", value: Number(profitPerUnit.toFixed(4)) },
      { name: "TPPct", value: Number(tpPct.toFixed(2)) },
      { name: "RiskReward", value: Number(riskReward.toFixed(2)) },
    ],
    timestamp: Date.now(),
  };
}
