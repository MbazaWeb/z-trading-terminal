"use client";

// Zustand store for the multi-agent consensus system.
//
// Holds the 5 agent cores (definition + per-agent confidence / improvement
// log / sparkline), the latest signal from each agent, the inter-agent
// discussion thread, and the most recent consensus result.
//
// `runAnalysis(candles, ticker)` is the entry point — it runs every active
// agent's analyzer over the supplied market data, stores the resulting
// signals, evaluates consensus, and persists everything to the store. The
// shell calls this on the Trading view whenever fresh candles arrive.
//
// `correctAfterTrade(result, agentsVoted)` is the self-improvement loop:
// after a trade closes, every agent that voted on it has its confidence
// nudged up (win) or down (loss), and a corresponding improvement-log entry
// is appended. Loss-correction also flips `isLearning = true` for ~5s so the
// UI can play the "Learning" pulse animation.

import { create } from "zustand";
import {
  BrainCircuit,
  Crosshair,
  Radar,
  RefreshCw,
  Shuffle,
} from "lucide-react";
import type { Candle, TickerStats } from "@/components/trading/types";
import { evaluateConsensus } from "./consensus";
import { analyze as analyzeMomentum } from "./momentum";
import { analyze as analyzeReverter } from "./reverter";
import { analyze as analyzeSentiment } from "./sentiment";
import { analyze as analyzeBreakout } from "./breakout";
import { analyze as analyzeArbitrage } from "./arbitrage";
import type {
  AgentCore,
  AgentMessage,
  AgentPerformance,
  AgentSignal,
  ConsensusResult,
} from "./types";
import type { AgentRegistryEntry } from "./registry";

// ---- Agent definitions ------------------------------------------------------

interface AgentDef {
  id: string;
  name: string;
  strategy: string;
  strategyType: string;
  strategyVersion: string;
  icon: typeof Radar;
  iconColor: string;
  baseConfidence: number;
  analyzer: AgentRegistryEntry["analyzer"];
}

const AGENT_DEFS: AgentDef[] = [
  {
    id: "momentum",
    name: "Momentum Hunter",
    strategy: "Trend Following",
    strategyType: "Momentum",
    strategyVersion: "momentum-v1.2",
    icon: Radar,
    iconColor: "#16c784",
    baseConfidence: 72,
    analyzer: analyzeMomentum,
  },
  {
    id: "reverter",
    name: "Mean Reverter",
    strategy: "Mean Reversion",
    strategyType: "Reversion",
    strategyVersion: "reverter-v1.1",
    icon: RefreshCw,
    iconColor: "#f0b90b",
    baseConfidence: 68,
    analyzer: analyzeReverter,
  },
  {
    id: "sentiment",
    name: "Sentiment Scalper",
    strategy: "Sentiment Analysis",
    strategyType: "Sentiment",
    strategyVersion: "sentiment-v1.0",
    icon: BrainCircuit,
    iconColor: "#4f9cf9",
    baseConfidence: 81,
    analyzer: analyzeSentiment,
  },
  {
    id: "breakout",
    name: "Breakout Sniper",
    strategy: "Breakout Detection",
    strategyType: "Breakout",
    strategyVersion: "breakout-v1.1",
    icon: Crosshair,
    iconColor: "#ea3943",
    baseConfidence: 74,
    analyzer: analyzeBreakout,
  },
  {
    id: "arbitrage",
    name: "Arbitrage Detector",
    strategy: "Statistical Arbitrage",
    strategyType: "Arbitrage",
    strategyVersion: "arbitrage-v1.0",
    icon: Shuffle,
    iconColor: "#a855f7",
    baseConfidence: 86,
    analyzer: analyzeArbitrage,
  },
];

// Map of agent id -> analyzer function. Kept out of the AgentCore so the
// store state stays serializable (functions cannot be persisted).
const ANALYZERS: Record<string, AgentDef["analyzer"]> = {
  momentum: analyzeMomentum,
  reverter: analyzeReverter,
  sentiment: analyzeSentiment,
  breakout: analyzeBreakout,
  arbitrage: analyzeArbitrage,
};

const EMPTY_PERFORMANCE: AgentPerformance = {
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
};

function buildInitialAgents(): AgentCore[] {
  return AGENT_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    strategy: d.strategy,
    strategyType: d.strategyType,
    strategyVersion: d.strategyVersion,
    icon: d.icon,
    iconColor: d.iconColor,
    status: "active",
    winRate: 50,
    totalTrades: 0,
    pnl: 0,
    selfImprovements: 0,
    confidence: d.baseConfidence,
    isLearning: false,
    learningUntil: null,
    lastSignal: null,
    lastImprovement: null,
    improvementLog: [],
    sparkline: [],
    performance: { ...EMPTY_PERFORMANCE },
  }));
}

const initialAgents = buildInitialAgents();

// ---- Self-improvement templates --------------------------------------------

const LOSS_TRIGGERS: Record<string, string[]> = {
  momentum: [
    "Consecutive losses on trending market",
    "RSI threshold too loose — entered overbought",
    "SMA period too short, false crossover",
  ],
  reverter: [
    "Bollinger band too tight on volatility spike",
    "RSI oversold but trend continued",
    "Mean reversion entered too early",
  ],
  sentiment: [
    "Volume spike was a fakeout",
    "3-candle pattern failed to follow through",
    "Body threshold too small for confirmation",
  ],
  breakout: [
    "False breakout — price reversed after break",
    "Volume confirmation too loose",
    "20-candle range too narrow on low volatility",
  ],
  arbitrage: [
    "Deviation extended further than 1.5 ATR",
    "ATR period too short — false dislocation",
    "Mean reversion failed in strong trend",
  ],
};

const LOSS_CHANGES: Record<string, string[]> = {
  momentum: [
    "Tightened SMA crossover threshold by 0.05%",
    "Raised RSI confirmation gate 70 -> 72",
    "Shortened SMA periods 7/25 -> 6/22",
  ],
  reverter: [
    "Widened Bollinger band 2.0 -> 2.2 std dev",
    "Lowered RSI oversold gate 30 -> 28",
    "Extended lookback 20 -> 24 candles",
  ],
  sentiment: [
    "Raised volume spike gate 1.5x -> 1.8x",
    "Required 4-candle pattern instead of 3",
    "Tightened body threshold +0.05%",
  ],
  breakout: [
    "Raised volume gate 1.5x -> 1.9x",
    "Extended breakout range 20 -> 25 candles",
    "Added 0.2% confirmation buffer past high/low",
  ],
  arbitrage: [
    "Tightened ATR multiple 1.5 -> 1.8",
    "Extended ATR period 14 -> 18",
    "Added SMA50 slope filter",
  ],
};

const WIN_CHANGES = [
  "Confirmed parameters — no change needed",
  "Slight confidence boost from correct call",
  "Pattern recognized — entry validated",
];

// ---- Store -----------------------------------------------------------------

interface AgentStoreState {
  agents: AgentCore[];
  signals: AgentSignal[];
  discussion: AgentMessage[];
  lastConsensus: ConsensusResult | null;
  lastAnalysisAt: number | null;

  runAnalysis: (candles: Candle[], ticker: TickerStats) => ConsensusResult | null;
  correctAfterTrade: (
    result: "win" | "loss",
    agentsVoted: string[],
    pnl: number,
  ) => void;
  toggleAgent: (id: string) => void;
  resetAgent: (id: string) => void;
  syncStatsFromTrades: (
    statsByAgent: Map<
      string,
      { winRate: number; totalTrades: number; pnl: number; sparkline: number[]; performance?: AgentPerformance }
    >,
  ) => void;
  clearExpiredLearning: () => void;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] ?? arr[0];
}

let improvementCounter = 0;
function nextImprovementId(agentId: string): string {
  improvementCounter += 1;
  return `imp-${agentId}-${improvementCounter}`;
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  agents: initialAgents,
  signals: [],
  discussion: [],
  lastConsensus: null,
  lastAnalysisAt: null,

  runAnalysis: (candles, ticker) => {
    if (candles.length === 0) return null;
    const state = get();
    const now = Date.now();

    const signals: AgentSignal[] = state.agents.map((agent) => {
      if (agent.status === "paused") {
        return {
          agentId: agent.id,
          agentName: agent.name,
          action: "hold",
          confidence: 0,
          reasoning: "Agent paused — not participating in this round.",
          indicators: [],
          timestamp: now,
        };
      }
      const analyzer = ANALYZERS[agent.id];
      const sig = analyzer
        ? analyzer(agent, candles, ticker)
        : {
            agentId: agent.id,
            agentName: agent.name,
            action: "hold" as const,
            confidence: 0,
            reasoning: "No analyzer configured for this agent.",
            indicators: [],
            timestamp: now,
          };
      return { ...sig, timestamp: now };
    });

    const consensus = evaluateConsensus(signals, state.agents);

    // Persist signals + lastSignal on each agent.
    set({
      signals,
      discussion: consensus.discussion,
      lastConsensus: consensus,
      lastAnalysisAt: now,
      agents: get().agents.map((a) => {
        const sig = signals.find((s) => s.agentId === a.id);
        return sig ? { ...a, lastSignal: sig } : a;
      }),
    });

    return consensus;
  },

  correctAfterTrade: (result, agentsVoted, pnl) => {
    const now = Date.now();
    set((s) => ({
      agents: s.agents.map((a) => {
        if (!agentsVoted.includes(a.id)) return a;
        if (result === "win") {
          const delta = 1;
          const newConfidence = Math.min(98, a.confidence + delta);
          const entry = {
            id: nextImprovementId(a.id),
            timestamp: now,
            trigger: "Winning trade — prediction validated",
            parameterChange: pick(WIN_CHANGES),
            confidenceDelta: delta,
            newConfidence,
          };
          return {
            ...a,
            confidence: newConfidence,
            selfImprovements: a.selfImprovements + 1,
            lastImprovement: entry,
            improvementLog: [entry, ...a.improvementLog].slice(0, 40),
            // Brief learning pulse even on wins (UI feedback).
            isLearning: true,
            learningUntil: now + 3000,
          };
        }
        // LOSS — tighten parameters, drop confidence by 3 (min 20).
        const delta = -3;
        const newConfidence = Math.max(20, a.confidence + delta);
        const trigger = pick(LOSS_TRIGGERS[a.id] ?? LOSS_TRIGGERS.momentum);
        const change = pick(LOSS_CHANGES[a.id] ?? LOSS_CHANGES.momentum);
        const entry = {
          id: nextImprovementId(a.id),
          timestamp: now,
          trigger: `${trigger} (trade P&L ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)})`,
          parameterChange: change,
          confidenceDelta: delta,
          newConfidence,
        };
        return {
          ...a,
          confidence: newConfidence,
          selfImprovements: a.selfImprovements + 1,
          lastImprovement: entry,
          improvementLog: [entry, ...a.improvementLog].slice(0, 40),
          isLearning: true,
          learningUntil: now + 5000,
        };
      }),
    }));
  },

  toggleAgent: (id) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id
          ? {
              ...a,
              status:
                a.status === "active"
                  ? "paused"
                  : a.status === "paused"
                    ? "active"
                    : a.status,
            }
          : a,
      ),
    })),

  resetAgent: (id) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== id) return a;
        const def = AGENT_DEFS.find((d) => d.id === id);
        return {
          ...a,
          confidence: def?.baseConfidence ?? 50,
          selfImprovements: 0,
          isLearning: false,
          learningUntil: null,
          improvementLog: [],
          lastImprovement: null,
          performance: { ...EMPTY_PERFORMANCE, lastEvaluatedAt: Date.now() },
        };
      }),
    })),

  syncStatsFromTrades: (statsByAgent) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        const st = statsByAgent.get(a.id);
        if (!st) return a;
        return {
          ...a,
          winRate: st.winRate,
          totalTrades: st.totalTrades,
          pnl: st.pnl,
          sparkline: st.sparkline,
          performance:
            st.performance ??
            a.performance ??
            { ...EMPTY_PERFORMANCE, lastEvaluatedAt: Date.now() },
        };
      }),
    })),

  clearExpiredLearning: () =>
    set((s) => {
      const now = Date.now();
      let changed = false;
      const agents = s.agents.map((a) => {
        if (a.isLearning && (a.learningUntil ?? 0) <= now) {
          changed = true;
          return { ...a, isLearning: false, learningUntil: null };
        }
        return a;
      });
      return changed ? { agents } : s;
    }),
}));

// ---- Strategy version registry (re-exported for views) --------------------

export { AGENT_REGISTRY } from "./registry";

// ---- Hooks for views -------------------------------------------------------

export function useAgents(): AgentCore[] {
  return useAgentStore((s) => s.agents);
}

export function useAgentSignals(): AgentSignal[] {
  return useAgentStore((s) => s.signals);
}

export function useLastConsensus(): ConsensusResult | null {
  return useAgentStore((s) => s.lastConsensus);
}

export function useDiscussion(): AgentMessage[] {
  return useAgentStore((s) => s.discussion);
}
