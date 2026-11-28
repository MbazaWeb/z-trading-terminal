// Indicator Fusion — multi-indicator composite agent.
//
// Combines RSI, MACD, Bollinger %B, SMA spread, volume, and volatility
// into a single composite score (signed; positive = bullish, negative =
// bearish). BUY when composite > 50, SELL when composite < -50, HOLD
// otherwise. Confidence scales with the magnitude of the composite.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { atr, bollingerBands, macd, rsi, sma, volumeSpike } from "./indicators";

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
      reasoning: "Not enough candle history to fuse all indicators.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const rsiVal = rsi(candles, 14);
  const macdRes = macd(candles);
  const { upper, lower, middle } = bollingerBands(candles, 20);
  const sma7 = sma(closes, 7);
  const sma25 = sma(closes, 25);
  const sma99 = sma(closes, 99);
  const atrVal = atr(candles, 14);
  const spike = volumeSpike(candles, 20);

  // Each indicator contributes a signed score.
  const rsiScore = (50 - rsiVal) * 2; // negative when overbought, positive when oversold
  const macdScore = macdRes.histogram * 100;
  const bbWidth = upper - lower || 1;
  const pctB = ((lastPrice - lower) / bbWidth) * 100;
  const bollingerScore = (pctB - 50) * 2; // negative near upper band, positive near lower
  const smaScore =
    Number.isFinite(sma25) && sma25 !== 0
      ? ((sma7 - sma25) / sma25) * 1000
      : 0;
  const volumeScore = spike ? 10 : 0;
  // Volatility adjustment — wide bands dampen the composite slightly.
  const atrScore = -Math.min(15, (atrVal / lastPrice) * 100 * 5);

  const composite =
    rsiScore + macdScore + bollingerScore + smaScore + volumeScore + atrScore;

  let action: AgentSignal["action"] = "hold";
  let reasoning = `Composite neutral at ${composite.toFixed(
    2,
  )} — indicators offset each other (RSI ${rsiVal.toFixed(
    1,
  )}, MACD ${macdRes.histogram.toFixed(3)}, BB %B ${pctB.toFixed(1)}, SMA spread ${smaScore.toFixed(2)}).`;
  let confidence = Math.min(80, 30 + Math.abs(composite) * 0.4);

  if (composite > 50) {
    action = "buy";
    confidence = Math.min(100, Math.abs(composite) * 1.5);
    reasoning = `Bullish composite ${composite.toFixed(
      2,
    )}: RSI score ${rsiScore.toFixed(1)} (oversold), MACD score ${macdScore.toFixed(
      2,
    )}, BB score ${bollingerScore.toFixed(1)} (near lower), SMA score ${smaScore.toFixed(
      2,
    )}, volume ${volumeScore}.`;
  } else if (composite < -50) {
    action = "sell";
    confidence = Math.min(100, Math.abs(composite) * 1.5);
    reasoning = `Bearish composite ${composite.toFixed(
      2,
    )}: RSI score ${rsiScore.toFixed(1)} (overbought), MACD score ${macdScore.toFixed(
      2,
    )}, BB score ${bollingerScore.toFixed(1)} (near upper), SMA score ${smaScore.toFixed(
      2,
    )}, volume ${volumeScore}.`;
  }

  const blended = Math.round(
    Math.min(100, confidence * 0.7 + agent.confidence * 0.3),
  );

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "RSIScore", value: Number(rsiScore.toFixed(2)) },
      { name: "MACDScore", value: Number(macdScore.toFixed(2)) },
      { name: "BollingerScore", value: Number(bollingerScore.toFixed(2)) },
      { name: "SMAScore", value: Number(smaScore.toFixed(2)) },
      { name: "VolumeScore", value: volumeScore },
      { name: "ATRScore", value: Number(atrScore.toFixed(2)) },
      { name: "CompositeScore", value: Number(composite.toFixed(2)) },
      { name: "SMA99", value: Number(sma99.toFixed(4)) },
      { name: "BBMiddle", value: Number(middle.toFixed(4)) },
    ],
    timestamp: Date.now(),
  };
}
