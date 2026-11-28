// Breakout Sniper — 20-candle high/low breakout agent.
//
// BUY when the latest close breaks above the 20-candle high AND the breakout
// candle has above-average volume (volume spike).
// SELL when the latest close breaks below the 20-candle low AND volume spikes.
// Confidence scales with the breakout magnitude (how far past the prior high /
// low) and the volume confirmation.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { rollingHighLow, volumeSpike } from "./indicators";

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const lastPrice = ticker.lastPrice;
  if (candles.length < 21) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      action: "hold",
      confidence: 25,
      reasoning: "Not enough candle history to compute 20-candle range.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  // Use the prior 20 candles (excluding the latest) so the breakout test is
  // "did the latest candle break the prior range".
  const prior20 = candles.slice(-21, -1);
  const { high, low } = rollingHighLow(prior20, 20);
  const last = candles[candles.length - 1];
  const spike = volumeSpike(candles, 20);
  const avgVol =
    prior20.reduce((a, b) => a + b.volume, 0) / prior20.length || 1;
  const spikeRatio = last.volume / avgVol;

  const breakUp = last.close > high;
  const breakDown = last.close < low;
  const upMag = breakUp ? ((last.close - high) / high) * 100 : 0;
  const downMag = breakDown ? ((low - last.close) / low) * 100 : 0;

  let action: AgentSignal["action"] = "hold";
  let reasoning = `No breakout: price ${last.close.toFixed(
    2,
  )} within 20-candle range [${low.toFixed(2)}, ${high.toFixed(2)}].`;
  let confidence = 30;

  if (breakUp && spike) {
    action = "buy";
    const magScore = Math.min(30, upMag * 10);
    const volScore = Math.min(25, (spikeRatio - 1.5) * 30);
    confidence = Math.min(93, 50 + magScore + volScore);
    reasoning = `Upside breakout: close ${last.close.toFixed(2)} broke above 20-candle high ${high.toFixed(
      2,
    )} (+${upMag.toFixed(2)}%) with volume ${spikeRatio.toFixed(2)}x average.`;
  } else if (breakDown && spike) {
    action = "sell";
    const magScore = Math.min(30, downMag * 10);
    const volScore = Math.min(25, (spikeRatio - 1.5) * 30);
    confidence = Math.min(93, 50 + magScore + volScore);
    reasoning = `Downside breakout: close ${last.close.toFixed(2)} broke below 20-candle low ${low.toFixed(
      2,
    )} (-${downMag.toFixed(2)}%) with volume ${spikeRatio.toFixed(2)}x average.`;
  } else if (breakUp) {
    reasoning = `Closed above 20-candle high ${high.toFixed(
      2,
    )} but volume did not confirm — possible false breakout.`;
    confidence = 40;
  } else if (breakDown) {
    reasoning = `Closed below 20-candle low ${low.toFixed(
      2,
    )} but volume did not confirm — possible false breakout.`;
    confidence = 40;
  }

  const blended = Math.round(
    Math.min(93, confidence * 0.7 + agent.confidence * 0.3),
  );

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "RangeHigh", value: Number(high.toFixed(4)) },
      { name: "RangeLow", value: Number(low.toFixed(4)) },
      { name: "VolSpikeRatio", value: Number(spikeRatio.toFixed(2)) },
      { name: "LastPrice", value: lastPrice },
    ],
    timestamp: Date.now(),
  };
}
