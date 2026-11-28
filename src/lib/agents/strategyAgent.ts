// Strategy Oracle — market-regime classifier and strategy selector.
//
// Computes an ADX proxy (abs(SMA7 - SMA25) / ATR * 100) to classify the
// market regime as trending (ADX > 25) or ranging (ADX < 20), then votes
// in the direction of the trend only when the regime is trending. In
// ranging markets the agent holds and recommends mean-reversion tactics.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { atr, sma } from "./indicators";

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const lastPrice = ticker.lastPrice;
  const closes = candles.map((c) => c.close);

  if (closes.length < 25) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      action: "hold",
      confidence: 28,
      reasoning: "Not enough candle history to classify market regime.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const sma7 = sma(closes, 7);
  const sma25 = sma(closes, 25);
  const atrVal = atr(candles, 14);
  const smaSpread = sma7 - sma25;
  const adxProxy = atrVal > 0
    ? Math.min(60, (Math.abs(smaSpread) / atrVal) * 100)
    : 0;

  let regime = "Ranging";
  if (adxProxy > 25) regime = "Trending";
  else if (adxProxy < 20) regime = "Ranging";

  const trendDirection = sma7 > sma25 ? "Up" : sma7 < sma25 ? "Down" : "Flat";
  const strategyType = regime === "Trending" ? "Trend Following" : "Mean Reversion";
  const trendStrength = adxProxy;

  let action: AgentSignal["action"] = "hold";
  let reasoning = `Ranging market (ADX proxy ${adxProxy.toFixed(
    1,
  )}) — no directional edge. Switch to mean-reversion tactics.`;
  let confidence = Math.min(70, 30 + adxProxy);

  if (regime === "Trending") {
    if (trendDirection === "Up") {
      action = "buy";
      confidence = Math.min(95, 40 + adxProxy);
      reasoning = `Trending up: ADX proxy ${adxProxy.toFixed(
        1,
      )} > 25, SMA7 ${sma7.toFixed(2)} > SMA25 ${sma25.toFixed(
        2,
      )} — trend-following long.`;
    } else if (trendDirection === "Down") {
      action = "sell";
      confidence = Math.min(95, 40 + adxProxy);
      reasoning = `Trending down: ADX proxy ${adxProxy.toFixed(
        1,
      )} > 25, SMA7 ${sma7.toFixed(2)} < SMA25 ${sma25.toFixed(
        2,
      )} — trend-following short.`;
    }
  }

  const blended = Math.round(
    Math.min(95, confidence * 0.7 + agent.confidence * 0.3),
  );

  // Encode regime / direction / strategy as numeric codes so they can
  // ride in the numeric indicators array.
  // Regime: 0=Ranging, 1=Trending. Direction: 0=Flat, 1=Up, 2=Down.
  const regimeCode = regime === "Trending" ? 1 : 0;
  const dirCode = trendDirection === "Up" ? 1 : trendDirection === "Down" ? 2 : 0;
  const stratCode = strategyType === "Trend Following" ? 1 : 0;

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "ADXProxy", value: Number(adxProxy.toFixed(2)) },
      { name: "MarketRegime", value: regimeCode },
      { name: "TrendDirection", value: dirCode },
      { name: "StrategyType", value: stratCode },
      { name: "TrendStrength", value: Number(trendStrength.toFixed(2)) },
      { name: "SMASpread", value: Number(smaSpread.toFixed(4)) },
    ],
    timestamp: Date.now(),
  };
}
