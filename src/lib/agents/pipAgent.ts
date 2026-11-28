// PIP Tracker — pip-movement analysis agent for gold / forex.
//
// For XAU/USD, 1 pip = $0.01 per ounce (the standard gold pip size on
// brokers). The agent measures session pip displacement, ATR in pips,
// pip-based volatility, and an estimated spread in pips. BUY when price
// has dropped > 150 pips from the session high (pip-oversold), SELL when
// it has risen > 150 pips from the session low (pip-overbought).

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { atr, rollingHighLow } from "./indicators";

// Gold (XAU/USD) pip size — 1 pip = $0.01 move per ounce.
const PIP_SIZE = 0.01;
const PIP_OVEREXT = 150;

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const lastPrice = ticker.lastPrice;

  if (candles.length < 14) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      action: "hold",
      confidence: 26,
      reasoning: "Not enough candle history to compute pip-based ATR.",
      indicators: [
        { name: "PipSize", value: PIP_SIZE },
        { name: "LastPrice", value: lastPrice },
      ],
      timestamp: Date.now(),
    };
  }

  const sessionOpen = candles[0].open;
  const sessionPips = (lastPrice - sessionOpen) / PIP_SIZE;
  const atrVal = atr(candles, 14);
  const atrPips = atrVal / PIP_SIZE;
  const pipVolatility = atrVal / PIP_SIZE;
  const { high, low } = rollingHighLow(candles, Math.min(candles.length, 50));
  const dropFromHigh = (high - lastPrice) / PIP_SIZE;
  const riseFromLow = (lastPrice - low) / PIP_SIZE;

  // Spread in pips — approximated from ATR (live order-book spread not
  // available to the agent). Typically gold spread ~ 2-5 pips; we cap the
  // estimate at 0.25 * ATR_pips.
  const spreadPips = Math.max(1, Math.min(20, atrPips * 0.05));
  const pipRange = Math.max(dropFromHigh, riseFromLow);

  let action: AgentSignal["action"] = "hold";
  let reasoning = `Pip movement neutral: session ${sessionPips.toFixed(
    0,
  )} pips, ATR ${atrPips.toFixed(1)} pips, range ${pipRange.toFixed(0)} pips.`;
  let confidence = 35;

  if (dropFromHigh > PIP_OVEREXT) {
    action = "buy";
    const overScore = Math.min(45, (dropFromHigh - PIP_OVEREXT) * 0.3);
    confidence = Math.min(92, 50 + overScore);
    reasoning = `Pip oversold: price dropped ${dropFromHigh.toFixed(
      0,
    )} pips from session high ${high.toFixed(2)} — expecting pip reversion upward.`;
  } else if (riseFromLow > PIP_OVEREXT) {
    action = "sell";
    const overScore = Math.min(45, (riseFromLow - PIP_OVEREXT) * 0.3);
    confidence = Math.min(92, 50 + overScore);
    reasoning = `Pip overbought: price rose ${riseFromLow.toFixed(
      0,
    )} pips from session low ${low.toFixed(2)} — expecting pip reversion downward.`;
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
      { name: "PipSize", value: PIP_SIZE },
      { name: "SessionPips", value: Number(sessionPips.toFixed(1)) },
      { name: "ATRPips", value: Number(atrPips.toFixed(2)) },
      { name: "PipVolatility", value: Number(pipVolatility.toFixed(2)) },
      { name: "SpreadPips", value: Number(spreadPips.toFixed(2)) },
      { name: "PipRange", value: Number(pipRange.toFixed(1)) },
    ],
    timestamp: Date.now(),
  };
}
