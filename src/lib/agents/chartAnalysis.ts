// Pattern Detective — chart pattern + candlestick recognition agent.
//
// Detects simple chart patterns (double top / double bottom, head &
// shoulders, triangle, flag, support/resistance break) and the three
// most actionable single-candle patterns (doji, hammer, engulfing) from
// the last ~30 candles. BUY on bullish setups (double bottom, bullish
// engulfing, support break upward), SELL on bearish setups (double top,
// bearish engulfing, resistance break downward).

import type { AgentCore, AgentSignal } from "./types";
import type { Candle, TickerStats } from "@/components/trading/types";
import { rollingHighLow } from "./indicators";

const PATTERN_TOLERANCE = 0.02; // 2% tolerance for "similar" highs / lows
const LOOKBACK = 30;

interface DetectedPattern {
  name: string;
  bullish: boolean;
  confidence: number;
}

export function analyze(
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal {
  const lastPrice = ticker.lastPrice;

  if (candles.length < LOOKBACK) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      action: "hold",
      confidence: 28,
      reasoning: "Not enough candle history to detect chart patterns.",
      indicators: [{ name: "LastPrice", value: lastPrice }],
      timestamp: Date.now(),
    };
  }

  const window = candles.slice(-LOOKBACK);
  const highs = window.map((c) => c.high);
  const lows = window.map((c) => c.low);
  const { high: resistance, low: support } = rollingHighLow(window, LOOKBACK);
  const last = window[window.length - 1];
  const prev = window[window.length - 2];

  const patterns: DetectedPattern[] = [];

  // ---- Double top / double bottom ---------------------------------------
  // Two highest peaks within the window whose values are within 2% of each
  // other, separated by a trough. Symmetric logic for double bottom.
  const sortedHighIdx = highs
    .map((h, i) => ({ h, i }))
    .sort((a, b) => b.h - a.h)
    .slice(0, 4);
  const sortedLowIdx = lows
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l - b.l)
    .slice(0, 4);

  if (sortedHighIdx.length >= 2) {
    const a = sortedHighIdx[0];
    const b = sortedHighIdx[1];
    if (Math.abs(a.h - b.h) / Math.max(a.h, b.h) <= PATTERN_TOLERANCE && Math.abs(a.i - b.i) > 3) {
      patterns.push({
        name: "Double Top",
        bullish: false,
        confidence: 60,
      });
    }
  }
  if (sortedLowIdx.length >= 2) {
    const a = sortedLowIdx[0];
    const b = sortedLowIdx[1];
    if (Math.abs(a.l - b.l) / Math.max(a.l, b.l) <= PATTERN_TOLERANCE && Math.abs(a.i - b.i) > 3) {
      patterns.push({
        name: "Double Bottom",
        bullish: true,
        confidence: 60,
      });
    }
  }

  // ---- Head & shoulders --------------------------------------------------
  // Three peaks in the last ~9 candles, middle highest.
  if (window.length >= 9) {
    const last9 = window.slice(-9);
    const peakIdx: number[] = [];
    for (let i = 1; i < last9.length - 1; i++) {
      if (
        last9[i].high > last9[i - 1].high &&
        last9[i].high > last9[i + 1].high
      ) {
        peakIdx.push(i);
      }
    }
    if (peakIdx.length >= 3) {
      const [p1, p2, p3] = peakIdx.slice(-3);
      if (
        last9[p2].high > last9[p1].high &&
        last9[p2].high > last9[p3].high
      ) {
        patterns.push({
          name: "Head & Shoulders",
          bullish: false,
          confidence: 55,
        });
      }
    }
  }

  // ---- Triangle (converging highs/lows) ---------------------------------
  if (window.length >= 12) {
    const recent12 = window.slice(-12);
    const firstHalf = recent12.slice(0, 6);
    const secondHalf = recent12.slice(6);
    const fhHigh = Math.max(...firstHalf.map((c) => c.high));
    const fhLow = Math.min(...firstHalf.map((c) => c.low));
    const shHigh = Math.max(...secondHalf.map((c) => c.high));
    const shLow = Math.min(...secondHalf.map((c) => c.low));
    if (shHigh < fhHigh && shLow > fhLow) {
      patterns.push({
        name: "Triangle (Converging)",
        bullish: last.close > (shHigh + shLow) / 2,
        confidence: 45,
      });
    }
  }

  // ---- Flag (sharp move + consolidation) --------------------------------
  if (window.length >= 10) {
    const flagPole = window.slice(-10, -5);
    const consolidation = window.slice(-5);
    const poleMove = flagPole[flagPole.length - 1].close - flagPole[0].open;
    const polePct = Math.abs(poleMove) / flagPole[0].open;
    const consRange =
      Math.max(...consolidation.map((c) => c.high)) -
      Math.min(...consolidation.map((c) => c.low));
    if (polePct > 0.01 && consRange / Math.abs(poleMove) < 0.6) {
      patterns.push({
        name: "Flag",
        bullish: poleMove > 0,
        confidence: 50,
      });
    }
  }

  // ---- Support/resistance break -----------------------------------------
  const breakUp = last.close > resistance * 0.9995;
  const breakDown = last.close < support * 1.0005;
  if (breakUp) {
    patterns.push({
      name: "Resistance Break",
      bullish: true,
      confidence: 55,
    });
  } else if (breakDown) {
    patterns.push({
      name: "Support Break",
      bullish: false,
      confidence: 55,
    });
  }

  // ---- Candlestick patterns ---------------------------------------------
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low || 1;
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  let candlePattern = "None";
  if (body / range < 0.1) {
    candlePattern = "Doji";
  } else if (lowerWick > body * 2 && upperWick < body * 0.5) {
    candlePattern = "Hammer";
    patterns.push({ name: "Hammer", bullish: true, confidence: 40 });
  }
  // Engulfing: prev candle's body fully contained inside the current candle's body.
  if (prev) {
    const prevBody = Math.abs(prev.close - prev.open);
    const curHigh = Math.max(last.open, last.close);
    const curLow = Math.min(last.open, last.close);
    if (
      prev.close > prev.open && last.close < last.open && // bearish engulfing
      curHigh >= prev.close && curLow <= prev.open
    ) {
      candlePattern = "Bearish Engulfing";
      patterns.push({
        name: "Bearish Engulfing",
        bullish: false,
        confidence: 50,
      });
    } else if (
      prev.close < prev.open && last.close > last.open && // bullish engulfing
      curHigh >= prev.open && curLow <= prev.close
    ) {
      candlePattern = "Bullish Engulfing";
      patterns.push({
        name: "Bullish Engulfing",
        bullish: true,
        confidence: 50,
      });
    }
  }

  // ---- Aggregate ---------------------------------------------------------
  let bullScore = 0;
  let bearScore = 0;
  let topPattern: DetectedPattern = {
    name: "None",
    bullish: true,
    confidence: 0,
  };
  for (const p of patterns) {
    if (p.bullish) bullScore += p.confidence;
    else bearScore += p.confidence;
    if (p.confidence > topPattern.confidence) topPattern = p;
  }

  let action: AgentSignal["action"] = "hold";
  let reasoning = `No actionable pattern detected — support ${support.toFixed(
    2,
  )}, resistance ${resistance.toFixed(2)}, last candle ${candlePattern}.`;
  let confidence = 35;

  if (bullScore > bearScore + 20) {
    action = "buy";
    confidence = Math.min(92, 45 + bullScore * 0.3);
    reasoning = `Bullish pattern stack: ${patterns
      .filter((p) => p.bullish)
      .map((p) => p.name)
      .join(", ")} — candle ${candlePattern}, support ${support.toFixed(
      2,
    )}, resistance ${resistance.toFixed(2)}.`;
  } else if (bearScore > bullScore + 20) {
    action = "sell";
    confidence = Math.min(92, 45 + bearScore * 0.3);
    reasoning = `Bearish pattern stack: ${patterns
      .filter((p) => !p.bullish)
      .map((p) => p.name)
      .join(", ")} — candle ${candlePattern}, support ${support.toFixed(
      2,
    )}, resistance ${resistance.toFixed(2)}.`;
  } else if (patterns.length > 0) {
    reasoning = `Mixed pattern signals (${patterns
      .map((p) => p.name)
      .join(", ")}) — waiting for clearer confirmation.`;
  }

  const blended = Math.round(
    Math.min(92, confidence * 0.7 + agent.confidence * 0.3),
  );

  // Encode candle pattern as a numeric code for the indicators array.
  const candleCode =
    candlePattern === "None" ? 0 :
    candlePattern === "Doji" ? 1 :
    candlePattern === "Hammer" ? 2 :
    candlePattern === "Bullish Engulfing" ? 3 :
    candlePattern === "Bearish Engulfing" ? 4 : 0;
  const patternTypeCode = topPattern.bullish ? 1 : 0;

  return {
    agentId: agent.id,
    agentName: agent.name,
    action,
    confidence: blended,
    reasoning,
    indicators: [
      { name: "DetectedPattern", value: topPattern.name === "None" ? 0 : 1 },
      { name: "PatternConfidence", value: topPattern.confidence },
      { name: "Support", value: Number(support.toFixed(4)) },
      { name: "Resistance", value: Number(resistance.toFixed(4)) },
      { name: "CandlePattern", value: candleCode },
      { name: "PatternType", value: patternTypeCode },
      { name: "PatternCount", value: patterns.length },
    ],
    timestamp: Date.now(),
  };
}
