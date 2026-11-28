// Mean Reverter — Bollinger Bands + RSI mean-reversion agent.
//
// BUY when price < lower Bollinger Band AND RSI < 30 (oversold).
// SELL when price > upper Bollinger Band AND RSI > 70 (overbought).
// Confidence scales with how far price has stretched beyond the band and how
// extreme the RSI reading is.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { bollingerBands, rsi } from "./indicators";

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const { upper, middle, lower } = bollingerBands(candles, 20);
  const rsiVal = rsi(candles, 14);
  const lastPrice = ticker.lastPrice;

  let action: AgentSignal["action"] = "hold";
  let reasoning = `Price ${lastPrice.toFixed(2)} inside Bollinger band [${lower.toFixed(
    2,
  )}, ${upper.toFixed(2)}] — no reversion signal.`;
  let confidence = 30;

  const bandWidth = upper - lower || 1;
  const lowerDist = (lower - lastPrice) / bandWidth; // >0 when below band
  const upperDist = (lastPrice - upper) / bandWidth; // >0 when above band

  if (lastPrice < lower && rsiVal < 30) {
    action = "buy";
    const distScore = Math.min(35, Math.abs(lowerDist) * 100);
    const rsiScore = Math.max(0, 30 - rsiVal);
    confidence = Math.min(92, 50 + distScore + rsiScore);
    reasoning = `Oversold reversal: price ${lastPrice.toFixed(2)} broke below lower BB ${lower.toFixed(
      2,
    )}, RSI ${rsiVal.toFixed(1)} < 30. Expecting snap-back toward middle ${middle.toFixed(2)}.`;
  } else if (lastPrice > upper && rsiVal > 70) {
    action = "sell";
    const distScore = Math.min(35, Math.abs(upperDist) * 100);
    const rsiScore = Math.max(0, rsiVal - 70);
    confidence = Math.min(92, 50 + distScore + rsiScore);
    reasoning = `Overbought reversal: price ${lastPrice.toFixed(2)} broke above upper BB ${upper.toFixed(
      2,
    )}, RSI ${rsiVal.toFixed(1)} > 70. Expecting fade toward middle ${middle.toFixed(2)}.`;
  } else if (lastPrice < lower) {
    reasoning = `Price below lower BB but RSI ${rsiVal.toFixed(
      1,
    )} not yet oversold — waiting for confirmation.`;
    confidence = 40;
  } else if (lastPrice > upper) {
    reasoning = `Price above upper BB but RSI ${rsiVal.toFixed(
      1,
    )} not yet overbought — waiting for confirmation.`;
    confidence = 40;
  }

  const blended = Math.round(
    Math.min(92, confidence * 0.7 + agent.confidence * 0.3),
  );

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "BBUpper", value: Number(upper.toFixed(4)) },
      { name: "BBMiddle", value: Number(middle.toFixed(4)) },
      { name: "BBLower", value: Number(lower.toFixed(4)) },
      { name: "RSI(14)", value: Number(rsiVal.toFixed(2)) },
    ],
    timestamp: Date.now(),
  };
}
