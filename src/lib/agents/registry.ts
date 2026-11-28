// Server-safe agent registry.
//
// The Zustand store in `agentStore.ts` is "use client" because it imports
// lucide-react icons. Server-side code (the cron bot worker, backtests,
// reconciliation) needs to look up an agent's analyzer by id without pulling
// React into the bundle. This module exposes a minimal registry — id, name,
// strategy metadata, strategyVersion, baseConfidence, and the analyzer
// function — that is safe to import from server-only contexts.
//
// The client store re-exports the same definitions with the icon added on top,
// so the two sources of truth never drift: when you bump a strategy version
// here, bump it in agentStore.ts as well (the latter reads from this module).

import type { Candle, TickerStats } from "@/components/trading/types";
import { analyze as analyzeMomentum } from "./momentum";
import { analyze as analyzeReverter } from "./reverter";
import { analyze as analyzeSentiment } from "./sentiment";
import { analyze as analyzeBreakout } from "./breakout";
import { analyze as analyzeArbitrage } from "./arbitrage";
import { analyze as analyzeSignal } from "./signalAgent";
import { analyze as analyzePip } from "./pipAgent";
import { analyze as analyzeRisk } from "./riskAgent";
import { analyze as analyzeStopLoss } from "./stopLossAgent";
import { analyze as analyzeStopWin } from "./stopWinAgent";
import { analyze as analyzeStrategy } from "./strategyAgent";
import { analyze as analyzeChart } from "./chartAnalysis";
import { analyze as analyzeMultiIndicator } from "./multiIndicator";
import { analyze as analyzeAlert } from "./alertAgent";
import { analyze as analyzeTime } from "./timeAgent";
import { analyze as analyzeMedia } from "./mediaAgent";
import type { AgentAnalyzer, AgentSignal } from "./types";

export interface AgentRegistryEntry {
  id: string;
  name: string;
  strategy: string;
  strategyType: string;
  strategyVersion: string;
  baseConfidence: number;
  analyzer: AgentAnalyzer;
}

// Specialist agent ids — these never vote on direction. They supply
// execution parameters (SL / TP / risk score) through their indicators.
export const SPECIALIST_AGENT_IDS: ReadonlySet<string> = new Set([
  "stopLoss",
  "stopWin",
]);

export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  // ---- Directional agents (11) --------------------------------------------
  {
    id: "momentum",
    name: "Momentum Hunter",
    strategy: "Trend Following",
    strategyType: "Momentum",
    strategyVersion: "momentum-v1.2",
    baseConfidence: 72,
    analyzer: analyzeMomentum,
  },
  {
    id: "reverter",
    name: "Mean Reverter",
    strategy: "Mean Reversion",
    strategyType: "Reversion",
    strategyVersion: "reverter-v1.1",
    baseConfidence: 68,
    analyzer: analyzeReverter,
  },
  {
    id: "sentiment",
    name: "Sentiment Scalper",
    strategy: "Sentiment Analysis",
    strategyType: "Sentiment",
    strategyVersion: "sentiment-v1.0",
    baseConfidence: 81,
    analyzer: analyzeSentiment,
  },
  {
    id: "breakout",
    name: "Breakout Sniper",
    strategy: "Breakout Detection",
    strategyType: "Breakout",
    strategyVersion: "breakout-v1.1",
    baseConfidence: 74,
    analyzer: analyzeBreakout,
  },
  {
    id: "arbitrage",
    name: "Arbitrage Detector",
    strategy: "Statistical Arbitrage",
    strategyType: "Arbitrage",
    strategyVersion: "arbitrage-v1.0",
    baseConfidence: 86,
    analyzer: analyzeArbitrage,
  },
  {
    id: "signal",
    name: "Signal Master",
    strategy: "Signal Aggregation",
    strategyType: "Signal",
    strategyVersion: "signal-v1.0",
    baseConfidence: 75,
    analyzer: analyzeSignal,
  },
  {
    id: "strategy",
    name: "Strategy Oracle",
    strategy: "Strategy Selection",
    strategyType: "Strategy",
    strategyVersion: "strategy-v1.0",
    baseConfidence: 73,
    analyzer: analyzeStrategy,
  },
  {
    id: "chart",
    name: "Pattern Detective",
    strategy: "Chart Pattern Recognition",
    strategyType: "Chart",
    strategyVersion: "chart-v1.0",
    baseConfidence: 70,
    analyzer: analyzeChart,
  },
  {
    id: "multiIndicator",
    name: "Indicator Fusion",
    strategy: "Multi-Indicator Composite",
    strategyType: "Composite",
    strategyVersion: "multiindicator-v1.0",
    baseConfidence: 76,
    analyzer: analyzeMultiIndicator,
  },
  {
    id: "time",
    name: "Time Keeper",
    strategy: "Time-Based Analysis",
    strategyType: "Time",
    strategyVersion: "time-v1.0",
    baseConfidence: 65,
    analyzer: analyzeTime,
  },
  {
    id: "media",
    name: "News Pulse",
    strategy: "News Sentiment Proxy",
    strategyType: "Media",
    strategyVersion: "media-v1.0",
    baseConfidence: 69,
    analyzer: analyzeMedia,
  },
  // ---- Specialist agents (5) ---------------------------------------------
  {
    id: "risk",
    name: "Risk Guardian",
    strategy: "Risk Assessment",
    strategyType: "Risk",
    strategyVersion: "risk-v1.0",
    baseConfidence: 78,
    analyzer: analyzeRisk,
  },
  {
    id: "stopLoss",
    name: "Stop Loss Sentinel",
    strategy: "Stop Loss Calculation",
    strategyType: "StopLoss",
    strategyVersion: "stoploss-v1.0",
    baseConfidence: 80,
    analyzer: analyzeStopLoss,
  },
  {
    id: "stopWin",
    name: "Take Profit Hunter",
    strategy: "Take Profit Calculation",
    strategyType: "TakeProfit",
    strategyVersion: "stopwin-v1.0",
    baseConfidence: 80,
    analyzer: analyzeStopWin,
  },
  {
    id: "pip",
    name: "PIP Tracker",
    strategy: "PIP Analysis",
    strategyType: "PIP",
    strategyVersion: "pip-v1.0",
    baseConfidence: 71,
    analyzer: analyzePip,
  },
  {
    id: "alert",
    name: "Alert Sentinel",
    strategy: "Alert Monitoring",
    strategyType: "Alert",
    strategyVersion: "alert-v1.0",
    baseConfidence: 67,
    analyzer: analyzeAlert,
  },
];

export function getAgentById(id: string): AgentRegistryEntry | null {
  return AGENT_REGISTRY.find((a) => a.id === id) ?? null;
}

/**
 * Minimal AgentCore stub used to invoke an analyzer outside the Zustand store.
 * The analyzer only reads `agent.id`, `agent.name`, and `agent.confidence`,
 * so we synthesize a stub from the registry entry plus a confidence value.
 */
export function makeAgentStub(
  entry: AgentRegistryEntry,
  confidenceOverride?: number,
): Parameters<AgentAnalyzer>[0] {
  return {
    id: entry.id,
    name: entry.name,
    strategy: entry.strategy,
    strategyType: entry.strategyType,
    strategyVersion: entry.strategyVersion,
    // The analyzer doesn't read icon/iconColor; these stubs satisfy the type.
    icon: (() => null) as unknown as Parameters<AgentAnalyzer>[0]["icon"],
    iconColor: "#ffffff",
    status: "active",
    winRate: 50,
    totalTrades: 0,
    pnl: 0,
    selfImprovements: 0,
    confidence: confidenceOverride ?? entry.baseConfidence,
    isLearning: false,
    learningUntil: null,
    lastSignal: null,
    lastImprovement: null,
    improvementLog: [],
    sparkline: [],
    performance: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      profitFactor: 0,
      grossProfit: 0,
      grossLoss: 0,
      maxDrawdown: 0,
      avgHoldTimeMs: 0,
      sharpeRatio: 0,
      lastEvaluatedAt: 0,
    },
  };
}

/**
 * Run a single agent's analyzer over the supplied market data. Used by the
 * cron bot worker and by the backtest engine. Returns `null` when the agent
 * id is unknown.
 */
export function runAgentAnalysis(
  agentId: string,
  candles: Candle[],
  ticker: TickerStats,
  confidenceOverride?: number,
): AgentSignal | null {
  const entry = getAgentById(agentId);
  if (!entry) return null;
  const stub = makeAgentStub(entry, confidenceOverride);
  return entry.analyzer(stub, candles, ticker);
}

/**
 * Run EVERY registered agent's analyzer over the supplied market data and
 * return the resulting signals. Used by the cron bot worker (which can't
 * use the Zustand store) so the cron sees the same set of agents the UI
 * sees. Each agent's analyzer is wrapped in a try/catch so one failing
 * agent doesn't break the cycle.
 */
export function runAllAgentsAnalysis(
  candles: Candle[],
  ticker: TickerStats,
): AgentSignal[] {
  const signals: AgentSignal[] = [];
  for (const entry of AGENT_REGISTRY) {
    try {
      const stub = makeAgentStub(entry);
      signals.push(entry.analyzer(stub, candles, ticker));
    } catch {
      // Skip a failing agent — the cron should still be able to reach
      // consensus with the remaining agents.
    }
  }
  return signals;
}
