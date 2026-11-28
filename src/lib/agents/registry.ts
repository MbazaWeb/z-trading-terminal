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

export const AGENT_REGISTRY: AgentRegistryEntry[] = [
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
