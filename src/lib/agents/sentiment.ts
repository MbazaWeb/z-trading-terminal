// Sentiment Scalper — price-action + volume-momentum agent.
//
// BUY when the last 3 candles are all green (close > open) AND there is a
// volume spike (current volume >= 1.5x rolling average).
// SELL when the last 3 candles are all red AND there is a volume spike.
// Confidence scales with the cumulative body size of the pattern and the
// magnitude of the volume spike.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { volumeSpike } from "./indicators";

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const lastPrice = ticker.lastPrice;
  if (candles.length < 4) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      action: "hold",
      confidence: 25,
      reasoning: "Not enough candle history to read price-action pattern.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const [c1, c2, c3] = candles.slice(-3);
  const green1 = c1.close > c1.open;
  const green2 = c2.close > c2.open;
  const green3 = c3.close > c3.open;
  const red1 = c1.close < c1.open;
  const red2 = c2.close < c2.open;
  const red3 = c3.close < c3.open;

  const spike = volumeSpike(candles, 20);
  const avgVol =
    candles.slice(-21, -1).reduce((a, b) => a + b.volume, 0) / 20 || 1;
  const lastVol = c3.volume;
  const spikeRatio = lastVol / avgVol;

  const bodies = [c1, c2, c3].map((c) => Math.abs(c.close - c.open));
  const totalBody = bodies.reduce((a, b) => a + b, 0);
  const avgBody = totalBody / 3;
  const refPrice = c3.close || 1;
  const bodyPct = (avgBody / refPrice) * 100;

  let action: AgentSignal["action"] = "hold";
  let reasoning = "No 3-candle pattern with volume confirmation.";
  let confidence = 30;

  if (green1 && green2 && green3 && spike) {
    action = "buy";
    const bodyScore = Math.min(30, bodyPct * 12);
    const volScore = Math.min(25, (spikeRatio - 1.5) * 30);
    confidence = Math.min(90, 50 + bodyScore + volScore);
    reasoning = `Bullish momentum: 3 consecutive green candles (avg body ${avgBody.toFixed(
      4,
    )}) with volume ${spikeRatio.toFixed(2)}x the 20-candle average.`;
  } else if (red1 && red2 && red3 && spike) {
    action = "sell";
    const bodyScore = Math.min(30, bodyPct * 12);
    const volScore = Math.min(25, (spikeRatio - 1.5) * 30);
    confidence = Math.min(90, 50 + bodyScore + volScore);
    reasoning = `Bearish momentum: 3 consecutive red candles (avg body ${avgBody.toFixed(
      4,
    )}) with volume ${spikeRatio.toFixed(2)}x the 20-candle average.`;
  } else if (green1 && green2 && green3) {
    reasoning = "3 green candles but no volume spike — momentum unconfirmed.";
    confidence = 38;
  } else if (red1 && red2 && red3) {
    reasoning = "3 red candles but no volume spike — momentum unconfirmed.";
    confidence = 38;
  }

  const blended = Math.round(
    Math.min(90, confidence * 0.7 + agent.confidence * 0.3),
  );

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "BodyAvg", value: Number(avgBody.toFixed(6)) },
      { name: "VolSpikeRatio", value: Number(spikeRatio.toFixed(2)) },
      { name: "LastPrice", value: lastPrice },
    ],
    timestamp: Date.now(),
  };
}
