// Arbitrage Detector — SMA50 deviation agent (statistical arbitrage flavor).
//
// BUY when price is significantly below SMA50 (deviation > 1.5 ATR).
// SELL when price is significantly above SMA50 (deviation > 1.5 ATR).
// The premise is that large deviations from the long-run mean tend to revert,
// so we fade the extreme. Confidence scales with how far past 1.5 ATR the
// deviation is.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { atr, sma } from "./indicators";

const DEVIATION_ATR_MULT = 1.5;

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const lastPrice = ticker.lastPrice;
  const closes = candles.map((c) => c.close);

  if (closes.length < 50) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      action: "hold",
      confidence: 28,
      reasoning: "Not enough history to compute SMA50 deviation.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const sma50 = sma(closes, 50);
  const atrVal = atr(candles, 14);
  const deviation = lastPrice - sma50;
  const deviationAbs = Math.abs(deviation);
  const threshold = atrVal * DEVIATION_ATR_MULT;

  let action: AgentSignal["action"] = "hold";
  let reasoning = `Price ${lastPrice.toFixed(2)} within 1.5 ATR of SMA50 ${sma50.toFixed(
    2,
  )} (deviation ${deviation.toFixed(2)}, ATR ${atrVal.toFixed(2)}).`;
  let confidence = 32;

  if (deviation < -threshold) {
    action = "buy";
    const overMult = deviationAbs / Math.max(atrVal, 1e-9);
    const overScore = Math.min(35, (overMult - 1.5) * 14);
    confidence = Math.min(90, 50 + overScore);
    reasoning = `Statistical dislocation: price ${lastPrice.toFixed(2)} is ${overMult.toFixed(
      2,
    )}x ATR below SMA50 ${sma50.toFixed(2)} — expecting mean reversion upward.`;
  } else if (deviation > threshold) {
    action = "sell";
    const overMult = deviationAbs / Math.max(atrVal, 1e-9);
    const overScore = Math.min(35, (overMult - 1.5) * 14);
    confidence = Math.min(90, 50 + overScore);
    reasoning = `Statistical dislocation: price ${lastPrice.toFixed(2)} is ${overMult.toFixed(
      2,
    )}x ATR above SMA50 ${sma50.toFixed(2)} — expecting mean reversion downward.`;
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
      { name: "SMA50", value: Number(sma50.toFixed(4)) },
      { name: "ATR(14)", value: Number(atrVal.toFixed(4)) },
      { name: "Deviation", value: Number(deviation.toFixed(4)) },
      { name: "LastPrice", value: lastPrice },
    ],
    timestamp: Date.now(),
  };
}
