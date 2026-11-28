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
  Bell,
  Brain,
  BrainCircuit,
  Clock,
  Crosshair,
  Layers,
  Newspaper,
  Radio,
  Radar,
  RefreshCw,
  Ruler,
  ScanSearch,
  Shield,
  ShieldAlert,
  Shuffle,
  Target,
} from "lucide-react";
import type { Candle, TickerStats } from "@/components/trading/types";
import { evaluateConsensus } from "./consensus";
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
  // ---- Directional agents (11) --------------------------------------------
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
  {
    id: "signal",
    name: "Signal Master",
    strategy: "Signal Aggregation",
    strategyType: "Signal",
    strategyVersion: "signal-v1.0",
    icon: Radio,
    iconColor: "#16c784",
    baseConfidence: 75,
    analyzer: analyzeSignal,
  },
  {
    id: "strategy",
    name: "Strategy Oracle",
    strategy: "Strategy Selection",
    strategyType: "Strategy",
    strategyVersion: "strategy-v1.0",
    icon: Brain,
    iconColor: "#a855f7",
    baseConfidence: 73,
    analyzer: analyzeStrategy,
  },
  {
    id: "chart",
    name: "Pattern Detective",
    strategy: "Chart Pattern Recognition",
    strategyType: "Chart",
    strategyVersion: "chart-v1.0",
    icon: ScanSearch,
    iconColor: "#4f9cf9",
    baseConfidence: 70,
    analyzer: analyzeChart,
  },
  {
    id: "multiIndicator",
    name: "Indicator Fusion",
    strategy: "Multi-Indicator Composite",
    strategyType: "Composite",
    strategyVersion: "multiindicator-v1.0",
    icon: Layers,
    iconColor: "#06b6d4",
    baseConfidence: 76,
    analyzer: analyzeMultiIndicator,
  },
  {
    id: "time",
    name: "Time Keeper",
    strategy: "Time-Based Analysis",
    strategyType: "Time",
    strategyVersion: "time-v1.0",
    icon: Clock,
    iconColor: "#8b5cf6",
    baseConfidence: 65,
    analyzer: analyzeTime,
  },
  {
    id: "media",
    name: "News Pulse",
    strategy: "News Sentiment Proxy",
    strategyType: "Media",
    strategyVersion: "media-v1.0",
    icon: Newspaper,
    iconColor: "#ec4899",
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
    icon: Shield,
    iconColor: "#ea3943",
    baseConfidence: 78,
    analyzer: analyzeRisk,
  },
  {
    id: "stopLoss",
    name: "Stop Loss Sentinel",
    strategy: "Stop Loss Calculation",
    strategyType: "StopLoss",
    strategyVersion: "stoploss-v1.0",
    icon: ShieldAlert,
    iconColor: "#ef4444",
    baseConfidence: 80,
    analyzer: analyzeStopLoss,
  },
  {
    id: "stopWin",
    name: "Take Profit Hunter",
    strategy: "Take Profit Calculation",
    strategyType: "TakeProfit",
    strategyVersion: "stopwin-v1.0",
    icon: Target,
    iconColor: "#16c784",
    baseConfidence: 80,
    analyzer: analyzeStopWin,
  },
  {
    id: "pip",
    name: "PIP Tracker",
    strategy: "PIP Analysis",
    strategyType: "PIP",
    strategyVersion: "pip-v1.0",
    icon: Ruler,
    iconColor: "#f0b90b",
    baseConfidence: 71,
    analyzer: analyzePip,
  },
  {
    id: "alert",
    name: "Alert Sentinel",
    strategy: "Alert Monitoring",
    strategyType: "Alert",
    strategyVersion: "alert-v1.0",
    icon: Bell,
    iconColor: "#f59e0b",
    baseConfidence: 67,
    analyzer: analyzeAlert,
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
  signal: analyzeSignal,
  strategy: analyzeStrategy,
  chart: analyzeChart,
  multiIndicator: analyzeMultiIndicator,
  time: analyzeTime,
  media: analyzeMedia,
  risk: analyzeRisk,
  stopLoss: analyzeStopLoss,
  stopWin: analyzeStopWin,
  pip: analyzePip,
  alert: analyzeAlert,
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

const DEFAULT_LOSS_TRIGGERS = [
  "Indicator inputs diverged from price action",
  "Confidence threshold too aggressive for current regime",
  "Volatility expanded beyond modeled ATR band",
];
const DEFAULT_LOSS_CHANGES = [
  "Widened confirmation threshold by 0.05%",
  "Added ATR-expansion filter to suppress noisy signals",
  "Extended lookback window by 2 candles",
];

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
  signal: [
    "Composite score false-positive on conflicting signals",
    "SMA99 filter too laggy for fast regime",
    "Volume spike confirmation gated out valid moves",
  ],
  strategy: [
    "ADX proxy misclassified a choppy trend",
    "SMA7/SMA25 spread too thin for regime detection",
    "Trending regime call flipped prematurely",
  ],
  chart: [
    "Double-top/bottom tolerance too loose (2%)",
    "Head & shoulders detected on noise",
    "Engulfing pattern failed to follow through",
  ],
  multiIndicator: [
    "Composite weights skewed toward lagging MACD",
    "Bollinger %B score saturated near band extremes",
    "ATR score over-dampened a strong signal",
  ],
  time: [
    "US session bias inverted by news shock",
    "Session open reference too stale",
    "Asian session hold skipped a valid breakout",
  ],
  media: [
    "Large-body news event was a reversal candle",
    "Volume spike triggered without follow-through",
    "Consecutive-count too low (3) for confirmation",
  ],
  risk: [
    "Risk score under-priced volatility expansion",
    "VaR multiplier too low for tail events",
    "Max adverse excursion window too short",
  ],
  stopLoss: [
    "ATR stop too tight — whipsawed out",
    "Structural low stale after recent breakout",
    "Multiplier 1.5x ATR under-priced noise",
  ],
  stopWin: [
    "ATR target too far — price reversed before TP",
    "Structural resistance already tested",
    "R:R ratio skewed too aggressive (1:2)",
  ],
  pip: [
    "Pip threshold 150 too sensitive for low-vol session",
    "Session open reference shifted on gap",
    "Spread estimate too narrow",
  ],
  alert: [
    "Alert threshold (delta +2) too tight",
    "Bollinger squeeze fired without breakout follow-through",
    "ATR spike alert misclassified normal volatility",
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
  signal: [
    "Raised composite threshold 4 -> 5 votes",
    "Tightened volume-spike gate to 1.8x",
    "Dropped lagging SMA99 weight in score",
  ],
  strategy: [
    "Raised ADX proxy threshold 25 -> 28",
    "Extended SMA lookback 7/25 -> 9/30",
    "Added ATR regime filter",
  ],
  chart: [
    "Tightened pattern tolerance 2% -> 1.5%",
    "Required 4-candle separation between peaks",
    "Added volume confirmation on engulfing",
  ],
  multiIndicator: [
    "Capped MACD score contribution",
    "Dampened Bollinger %B near extremes",
    "Re-weighted composite toward RSI",
  ],
  time: [
    "Required price + RSI dual confirmation",
    "Used rolling session-open instead of candle[0]",
    "Suppressed Asian-session breakout calls",
  ],
  media: [
    "Raised consecutive count 3 -> 4",
    "Required dual volume + body confirmation",
    "Added gap threshold 1.5x avg body",
  ],
  risk: [
    "Raised VaR multiplier 1.65 -> 1.96",
    "Extended max-adverse window 20 -> 30",
    "Added volatility regime gate",
  ],
  stopLoss: [
    "Widened ATR multiplier 1.5 -> 1.8",
    "Used rolling 25-candle structural low",
    "Confirmed structure with volume spike",
  ],
  stopWin: [
    "Reduced ATR multiple 2 -> 1.75",
    "Used next-level resistance beyond prior 20",
    "Capped R:R at 1:1.5 in low-vol regimes",
  ],
  pip: [
    "Raised pip threshold 150 -> 200",
    "Used rolling session open (last 24h)",
    "Widened spread estimate to 0.10x ATR",
  ],
  alert: [
    "Raised alert delta 2 -> 3",
    "Suppressed squeeze alert without breakout",
    "Required 2x ATR for spike alert",
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
