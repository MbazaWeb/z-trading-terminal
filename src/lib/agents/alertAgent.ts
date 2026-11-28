// Alert Sentinel — condition-monitoring agent that fires alerts.
//
// Watches a fixed set of conditions (long-term trend change vs SMA99,
// RSI cross of 30/70, volume spike, ATR spike, Bollinger squeeze,
// 20-candle high/low break) and counts buy alerts vs sell alerts. BUY
// when buy alerts > sell alerts + 2, SELL when sell alerts > buy alerts
// + 2, HOLD otherwise. The agent also surfaces the active alert type and
// severity in its indicators so the UI can highlight which conditions
// fired.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { atr, bollingerBands, rsi, rollingHighLow, sma, volumeSpike } from "./indicators";

const TOTAL_POSSIBLE = 8;

interface Alert {
  type: string;
  side: "buy" | "sell" | "neutral";
  severity: number; // 0-100
}

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
      confidence: 26,
      reasoning: "Not enough candle history to evaluate alert conditions.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const sma99 = sma(closes, 99);
  const rsiVal = rsi(candles, 14);
  const atrVal = atr(candles, 14);
  const { upper, lower, middle } = bollingerBands(candles, 20);
  const spike = volumeSpike(candles, 20);
  const { high, low } = rollingHighLow(candles.slice(0, -1), 20);

  // ATR spike: current single-candle true range > 2x average ATR.
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const lastTR = Math.max(
    last.high - last.low,
    Math.abs(last.high - prev.close),
    Math.abs(last.low - prev.close),
  );
  const atrSpike = atrVal > 0 && lastTR > atrVal * 2;

  // Bollinger squeeze: band width < 25% of the recent average width.
  const bbWidth = upper - lower;
  const squeeze = bbWidth / middle < 0.025;

  const alerts: Alert[] = [];
  // Long-term trend change vs SMA99.
  if (lastPrice > sma99) alerts.push({ type: "Price > SMA99", side: "buy", severity: 60 });
  else alerts.push({ type: "Price < SMA99", side: "sell", severity: 60 });
  // RSI extremes.
  if (rsiVal < 30) alerts.push({ type: "RSI oversold", side: "buy", severity: 70 });
  else if (rsiVal > 70) alerts.push({ type: "RSI overbought", side: "sell", severity: 70 });
  // Volume spike.
  if (spike) alerts.push({ type: "Volume spike", side: "neutral", severity: 50 });
  // ATR spike.
  if (atrSpike) alerts.push({ type: "ATR spike", side: "neutral", severity: 65 });
  // Bollinger squeeze.
  if (squeeze) alerts.push({ type: "BB squeeze", side: "neutral", severity: 55 });
  // 20-candle breakout.
  if (last.close > high) alerts.push({ type: "20-bar high break", side: "buy", severity: 60 });
  else if (last.close < low) alerts.push({ type: "20-bar low break", side: "sell", severity: 60 });

  const buyAlerts = alerts.filter((a) => a.side === "buy").length;
  const sellAlerts = alerts.filter((a) => a.side === "sell").length;
  const totalAlerts = alerts.length;
  const topAlert = alerts.reduce<Alert | null>(
    (best, a) => (best === null || a.severity > best.severity ? a : best),
    null,
  );

  let action: AgentSignal["action"] = "hold";
  let reasoning = `Alerts balanced — ${buyAlerts} buy vs ${sellAlerts} sell (${totalAlerts} total). Top alert: ${topAlert?.type ?? "None"}.`;
  let confidence = Math.round(
    Math.min(85, (Math.max(buyAlerts, sellAlerts) / TOTAL_POSSIBLE) * 100),
  );

  if (buyAlerts > sellAlerts + 2) {
    action = "buy";
    reasoning = `${buyAlerts} buy alerts vs ${sellAlerts} sell — bullish conditions firing (${alerts
      .filter((a) => a.side === "buy")
      .map((a) => a.type)
      .join(", ")}).`;
  } else if (sellAlerts > buyAlerts + 2) {
    action = "sell";
    reasoning = `${sellAlerts} sell alerts vs ${buyAlerts} buy — bearish conditions firing (${alerts
      .filter((a) => a.side === "sell")
      .map((a) => a.type)
      .join(", ")}).`;
  }

  const blended = Math.round(
    Math.min(85, confidence * 0.7 + agent.confidence * 0.3),
  );

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "BuyAlerts", value: buyAlerts },
      { name: "SellAlerts", value: sellAlerts },
      { name: "ActiveAlerts", value: totalAlerts },
      { name: "AlertType", value: topAlert ? topAlert.severity : 0 },
      { name: "AlertSeverity", value: topAlert ? topAlert.severity : 0 },
      { name: "TotalAlerts", value: totalAlerts },
    ],
    timestamp: Date.now(),
  };
}
