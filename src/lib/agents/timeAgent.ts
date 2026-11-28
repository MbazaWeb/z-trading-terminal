// Time Keeper — time-of-day and trading-session agent.
//
// Classifies the current UTC time into the Asian (00-08), European
// (08-16), or US (13-22) trading session, applies a per-session
// volatility multiplier (US = 1.5x, EU = 1.2x, Asian = 0.8x), and votes
// with the session-open bias during the higher-volatility US session.
// The Asian session is treated as a low-volatility HOLD regime.

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const lastPrice = ticker.lastPrice;
  const now = new Date();
  const utcHour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 0=Sun ... 6=Sat

  let session = "Asian";
  let volatilityMult = 0.8;
  if (utcHour >= 13 && utcHour < 22) {
    session = "US";
    volatilityMult = 1.5;
  } else if (utcHour >= 8 && utcHour < 16) {
    session = "European";
    volatilityMult = 1.2;
  }

  // Day-of-week bias: Monday (1) and Friday (5) typically thinner liquidity.
  const dowEffect =
    dayOfWeek === 1 || dayOfWeek === 5 ? "Low Liquidity" : "Normal";

  // Session open = the first candle in the current session window.
  // We approximate by using candles[0].open as the session reference.
  const sessionOpen = candles.length > 0 ? candles[0].open : lastPrice;
  const sessionBias = lastPrice > sessionOpen ? "Up" : "Down";

  let action: AgentSignal["action"] = "hold";
  let reasoning = `${session} session (UTC hour ${utcHour}, ${dowEffect}) — volatility multiplier ${volatilityMult}x, session bias ${sessionBias}.`;
  let confidence = Math.round(Math.min(80, volatilityMult * 50));

  if (session === "US") {
    if (lastPrice > sessionOpen) {
      action = "buy";
      confidence = Math.round(Math.min(85, volatilityMult * 50));
      reasoning = `US session strength: UTC ${utcHour}, price ${lastPrice.toFixed(
        2,
      )} above session open ${sessionOpen.toFixed(2)} — bias up.`;
    } else if (lastPrice < sessionOpen) {
      action = "sell";
      confidence = Math.round(Math.min(85, volatilityMult * 50));
      reasoning = `US session weakness: UTC ${utcHour}, price ${lastPrice.toFixed(
        2,
      )} below session open ${sessionOpen.toFixed(2)} — bias down.`;
    }
  } else if (session === "Asian") {
    reasoning = `Asian session (UTC ${utcHour}) — low-volatility regime, holding for clearer EU/US signal.`;
    confidence = 30;
  }

  const blended = Math.round(
    Math.min(85, confidence * 0.7 + agent.confidence * 0.3),
  );

  // Encode session / day-of-week / bias as numeric codes.
  // Session: 0=Asian, 1=European, 2=US. Bias: 0=Down, 1=Up.
  const sessionCode = session === "Asian" ? 0 : session === "European" ? 1 : 2;
  const biasCode = sessionBias === "Up" ? 1 : 0;
  const timeScore = Math.round(volatilityMult * 50);

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "UTCHour", value: utcHour },
      { name: "MarketSession", value: sessionCode },
      { name: "SessionVolatility", value: Number(volatilityMult.toFixed(2)) },
      { name: "DayOfWeek", value: dayOfWeek },
      { name: "SessionBias", value: biasCode },
      { name: "TimeScore", value: timeScore },
    ],
    timestamp: Date.now(),
  };
}
