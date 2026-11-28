// Momentum Hunter — trend-following agent.
//
// BUY when SMA7 > SMA25 AND RSI < 70 (uptrend, not overbought).
// SELL when SMA7 < SMA25 AND RSI > 30 (downtrend, not oversold).
// Confidence is derived from the magnitude of the SMA separation and how far
// RSI is from its neutral midpoint (50).

import type { AgentSignal } from "./types";
import type { AgentCore } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { rsi, sma } from "./indicators";

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const closes = candles.map((c) => c.close);
  const sma7 = sma(closes, 7);
  const sma25 = sma(closes, 25);
  const rsiVal = rsi(candles, 14);
  const lastPrice = ticker.lastPrice;

  const smaSep = Number.isFinite(sma7) && Number.isFinite(sma25)
    ? ((sma7 - sma25) / sma25) * 100
    : 0;

  let action: AgentSignal["action"] = "hold";
  let reasoning = "Trend unclear — SMA7 and SMA25 are tightly bunched.";
  let confidence = 30;

  if (Number.isFinite(sma7) && Number.isFinite(sma25)) {
    if (sma7 > sma25 && rsiVal < 70) {
      action = "buy";
      const sepScore = Math.min(40, Math.abs(smaSep) * 12);
      const rsiScore = Math.max(0, 50 - Math.abs(50 - rsiVal));
      confidence = Math.min(95, 45 + sepScore + rsiScore * 0.5);
      reasoning = `Uptrend confirmed: SMA7 ${sma7.toFixed(2)} > SMA25 ${sma25.toFixed(
        2,
      )} (${smaSep.toFixed(2)}% spread), RSI ${rsiVal.toFixed(1)} (not overbought).`;
    } else if (sma7 < sma25 && rsiVal > 30) {
      action = "sell";
      const sepScore = Math.min(40, Math.abs(smaSep) * 12);
      const rsiScore = Math.max(0, 50 - Math.abs(50 - rsiVal));
      confidence = Math.min(95, 45 + sepScore + rsiScore * 0.5);
      reasoning = `Downtrend confirmed: SMA7 ${sma7.toFixed(2)} < SMA25 ${sma25.toFixed(
        2,
      )} (${smaSep.toFixed(2)}% spread), RSI ${rsiVal.toFixed(1)} (not oversold).`;
    } else if (sma7 > sma25 && rsiVal >= 70) {
      reasoning = `Uptrend intact but RSI ${rsiVal.toFixed(
        1,
      )} signals overbought — waiting for pullback.`;
      confidence = 35;
    } else if (sma7 < sma25 && rsiVal <= 30) {
      reasoning = `Downtrend intact but RSI ${rsiVal.toFixed(
        1,
      )} signals oversold — waiting for bounce.`;
      confidence = 35;
    }
  }

  // Blend with the agent's base confidence so long-term accuracy is reflected.
  const blended = Math.round(
    Math.min(95, confidence * 0.7 + agent.confidence * 0.3),
  );

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "SMA7", value: Number(sma7.toFixed(4)) },
      { name: "SMA25", value: Number(sma25.toFixed(4)) },
      { name: "RSI(14)", value: Number(rsiVal.toFixed(2)) },
      { name: "LastPrice", value: lastPrice },
    ],
    timestamp: Date.now(),
  };
}
