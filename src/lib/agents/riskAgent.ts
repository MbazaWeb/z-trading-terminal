// Risk Guardian — risk-assessment agent.
//
// Computes a market risk score (0-100, higher = riskier), Value at Risk
// (95th percentile loss = ATR * 1.65 * sqrt(holding period)), volatility
// (ATR / price * 100), and the maximum adverse excursion in the recent
// window. The agent votes WITH the trend only when risk is low (risk
// score < 30) and stays flat when the market is too volatile (risk > 60).
// The risk score is also exported through `consensus.executionParams` so
// the trade-execution layer can size positions accordingly.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { atr, sma } from "./indicators";

// Holding period assumed for VaR (1 bar). sqrt(1) = 1.
const HOLDING_PERIOD = 1;
const Z_95 = 1.65;

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
      reasoning: "Not enough history to compute a stable risk score.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const sma25 = sma(closes, 25);
  const atrVal = atr(candles, 14);
  const volatilityPct = (atrVal / lastPrice) * 100;
  const var95 = atrVal * Z_95 * Math.sqrt(HOLDING_PERIOD);

  // Max adverse excursion: largest single-candle drop in the last 20 candles.
  const recent = candles.slice(-20);
  let maxAdverse = 0;
  for (const c of recent) {
    const adverse = c.open - c.low;
    if (adverse > maxAdverse) maxAdverse = adverse;
  }

  // Risk score 0-100 (higher = riskier market).
  const volScore = Math.min(50, volatilityPct * 16);
  const adverseScore = Math.min(30, (maxAdverse / lastPrice) * 100 * 12);
  const varScore = Math.min(20, (var95 / lastPrice) * 100 * 8);
  const riskScore = Math.round(Math.min(100, volScore + adverseScore + varScore));

  let riskLevel = "Low";
  if (riskScore > 60) riskLevel = "High";
  else if (riskScore > 30) riskLevel = "Medium";

  let action: AgentSignal["action"] = "hold";
  let reasoning = `Risk too high to act — risk score ${riskScore}/100, volatility ${volatilityPct.toFixed(
    2,
  )}%, VaR $${var95.toFixed(2)}.`;
  let confidence = 35;

  if (riskScore > 60) {
    action = "hold";
    confidence = Math.min(70, 40 + riskScore * 0.3);
    reasoning = `Market too volatile (risk score ${riskScore}/100, vol ${volatilityPct.toFixed(
      2,
    )}%) — standing aside until risk normalizes.`;
  } else if (riskScore < 30) {
    // Low-risk regime — vote with the trend.
    if (lastPrice > sma25) {
      action = "buy";
      confidence = Math.min(90, 55 + (30 - riskScore) * 1.2);
      reasoning = `Low-risk uptrend: price ${lastPrice.toFixed(2)} above SMA25 ${sma25.toFixed(
        2,
      )}, risk score ${riskScore}/100, VaR $${var95.toFixed(2)} — safe to add long.`;
    } else if (lastPrice < sma25) {
      action = "sell";
      confidence = Math.min(90, 55 + (30 - riskScore) * 1.2);
      reasoning = `Low-risk downtrend: price ${lastPrice.toFixed(2)} below SMA25 ${sma25.toFixed(
        2,
      )}, risk score ${riskScore}/100, VaR $${var95.toFixed(2)} — safe to add short.`;
    }
  } else {
    reasoning = `Moderate risk (score ${riskScore}/100, vol ${volatilityPct.toFixed(
      2,
    )}%, VaR $${var95.toFixed(2)}) — waiting for clearer regime.`;
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
      { name: "VaR", value: Number(var95.toFixed(4)) },
      { name: "VolatilityPct", value: Number(volatilityPct.toFixed(2)) },
      { name: "RiskScore", value: riskScore },
      { name: "MaxAdverse", value: Number(maxAdverse.toFixed(4)) },
      { name: "ATR", value: Number(atrVal.toFixed(4)) },
      // Encoded level so the UI can render the textual label without a
      // separate field — 0=Low, 1=Medium, 2=High.
      { name: "RiskLevel", value: riskLevel === "Low" ? 0 : riskLevel === "Medium" ? 1 : 2 },
    ],
    timestamp: Date.now(),
  };
}
