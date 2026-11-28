// Signal Master — composite price-action aggregation agent.
//
// Aggregates the bullish / bearish bias of six independent price-action
// signals (SMA7/25/99 trend, RSI extremes, MACD histogram, Bollinger %B,
// volume spike) into a single composite score. BUY when score >= 4, SELL
// when score <= -4, HOLD otherwise. Confidence scales with how far past
// the threshold the composite score lands.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { bollingerBands, macd, rsi, sma, volumeSpike } from "./indicators";

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const lastPrice = ticker.lastPrice;
  const closes = candles.map((c) => c.close);

  if (closes.length < 99) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      action: "hold",
      confidence: 28,
      reasoning:
        "Not enough candle history to aggregate SMA99 / MACD / Bollinger signals.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const sma7 = sma(closes, 7);
  const sma25 = sma(closes, 25);
  const sma99 = sma(closes, 99);
  const rsiVal = rsi(candles, 14);
  const macdRes = macd(candles);
  const { upper, lower } = bollingerBands(candles, 20);
  const spike = volumeSpike(candles, 20);

  // Each signal votes +1 (bullish) or -1 (bearish).
  let score = 0;
  if (Number.isFinite(sma7)) score += lastPrice > sma7 ? 1 : -1;
  if (Number.isFinite(sma25)) score += lastPrice > sma25 ? 1 : -1;
  if (Number.isFinite(sma99)) score += lastPrice > sma99 ? 1 : -1;
  score += rsiVal < 30 ? 1 : rsiVal > 70 ? -1 : 0;
  score += macdRes.histogram > 0 ? 1 : macdRes.histogram < 0 ? -1 : 0;
  // Bollinger %B: 0 = lower band, 100 = upper band, 50 = middle.
  const bbWidth = upper - lower || 1;
  const pctB = ((lastPrice - lower) / bbWidth) * 100;
  score += pctB < 20 ? 1 : pctB > 80 ? -1 : 0;
  if (spike) score += lastPrice >= closes[closes.length - 1] ? 1 : -1;

  let action: AgentSignal["action"] = "hold";
  let reasoning = `Composite signal neutral (score ${score}) — bullish and bearish cues roughly balanced.`;
  let confidence = 35;

  if (score >= 4) {
    action = "buy";
    confidence = Math.min(95, (Math.abs(score) / 6) * 100);
    reasoning = `Strong bullish aggregation: ${score}/6 bullish signals (SMA stack above, RSI ${rsiVal.toFixed(
      1,
    )}, MACD hist ${macdRes.histogram.toFixed(3)}, BB %B ${pctB.toFixed(1)}, vol spike ${spike}).`;
  } else if (score <= -4) {
    action = "sell";
    confidence = Math.min(95, (Math.abs(score) / 6) * 100);
    reasoning = `Strong bearish aggregation: ${score}/6 bearish signals (SMA stack below, RSI ${rsiVal.toFixed(
      1,
    )}, MACD hist ${macdRes.histogram.toFixed(3)}, BB %B ${pctB.toFixed(1)}, vol spike ${spike}).`;
  } else {
    reasoning = `Mixed signals (score ${score}): trend ${lastPrice > sma25 ? "up" : "down"}, RSI ${rsiVal.toFixed(
      1,
    )}, MACD hist ${macdRes.histogram.toFixed(3)}, BB %B ${pctB.toFixed(1)} — no edge.`;
  }

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
      { name: "SMA99", value: Number(sma99.toFixed(4)) },
      { name: "RSI(14)", value: Number(rsiVal.toFixed(2)) },
      { name: "MACD", value: Number(macdRes.histogram.toFixed(4)) },
      { name: "BB %B", value: Number(pctB.toFixed(2)) },
      { name: "VolSpike", value: spike ? 1 : 0 },
      { name: "SignalScore", value: score },
    ],
    timestamp: Date.now(),
  };
}
