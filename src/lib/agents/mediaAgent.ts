// News Pulse — price-action proxy for news sentiment.
//
// Without a news API, this agent uses price action as a proxy for news
// impact: large candle bodies (> 2x the recent average) signal a news
// event, consecutive green/red candles signal sentiment, and volume
// confirmation validates the move. BUY on confirmed positive sentiment
// (3+ green + volume), SELL on confirmed negative sentiment (3+ red +
// volume).

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { volumeSpike } from "./indicators";

const BODY_MULT = 2; // large body = > 2x the recent average

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
      confidence: 26,
      reasoning: "Not enough candle history to compute average body size.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const window = candles.slice(-20);
  const avgBody =
    window.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / window.length || 1;
  const last = candles[candles.length - 1];
  const lastBody = Math.abs(last.close - last.open);
  const newsDetected = lastBody > avgBody * BODY_MULT;
  const impactMagnitude = lastBody / avgBody;

  // Consecutive direction count from the latest candle backwards.
  let consecCount = 0;
  let consecDir: "green" | "red" = last.close > last.open ? "green" : "red";
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    const green = c.close > c.open;
    if ((consecDir === "green" && green) || (consecDir === "red" && !green)) {
      consecCount++;
    } else {
      break;
    }
  }

  const spike = volumeSpike(candles, 20);
  const gap = candles.length > 1
    ? last.open - candles[candles.length - 2].close
    : 0;

  // Sentiment score: -100 (max bearish) ... +100 (max bullish).
  let sentimentScore = 0;
  if (newsDetected) sentimentScore += last.close > last.open ? 30 : -30;
  if (consecCount >= 3) sentimentScore += consecDir === "green" ? consecCount * 10 : -consecCount * 10;
  if (spike) sentimentScore += consecDir === "green" ? 15 : -15;
  if (Math.abs(gap) > avgBody) sentimentScore += gap > 0 ? 10 : -10;

  const sentimentLabel =
    sentimentScore > 30 ? "Positive" :
    sentimentScore < -30 ? "Negative" : "Neutral";

  let action: AgentSignal["action"] = "hold";
  let reasoning = `No confirmed news sentiment — sentiment score ${sentimentScore} (${sentimentLabel}), impact ${impactMagnitude.toFixed(2)}x avg body.`;
  let confidence = Math.min(80, 30 + Math.abs(sentimentScore) * 0.4);

  if (sentimentScore > 30 && consecDir === "green" && spike && consecCount >= 3) {
    action = "buy";
    confidence = Math.min(95, 40 + Math.abs(sentimentScore) * 0.6);
    reasoning = `Positive news proxy: ${consecCount} consecutive green candles, volume spike, sentiment score ${sentimentScore}, impact ${impactMagnitude.toFixed(2)}x avg body.`;
  } else if (sentimentScore < -30 && consecDir === "red" && spike && consecCount >= 3) {
    action = "sell";
    confidence = Math.min(95, 40 + Math.abs(sentimentScore) * 0.6);
    reasoning = `Negative news proxy: ${consecCount} consecutive red candles, volume spike, sentiment score ${sentimentScore}, impact ${impactMagnitude.toFixed(2)}x avg body.`;
  }

  const blended = Math.round(
    Math.min(95, confidence * 0.7 + agent.confidence * 0.3),
  );

  // Encode consecutive direction as numeric code: 1=green, -1=red.
  const consecCode = consecDir === "green" ? 1 : -1;

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "NewsDetected", value: newsDetected ? 1 : 0 },
      { name: "SentimentScore", value: sentimentScore },
      { name: "ImpactMagnitude", value: Number(impactMagnitude.toFixed(2)) },
      { name: "ConsecutiveDirection", value: consecCode },
      { name: "ConsecutiveCount", value: consecCount },
      { name: "VolumeConfirmation", value: spike ? 1 : 0 },
      { name: "SentimentLabel", value: sentimentLabel === "Positive" ? 1 : sentimentLabel === "Negative" ? -1 : 0 },
    ],
    timestamp: Date.now(),
  };
}
