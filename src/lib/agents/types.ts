// Type definitions for the multi-agent consensus system.
//
// Each agent runs independently over the same candle + ticker data and emits an
// `AgentSignal` (buy / sell / hold with confidence + reasoning). The consensus
// module collects every signal, weights each vote by the agent's historical
// accuracy, and produces a single `ConsensusResult` the bot / TradePanel can
// act on.

import type { LucideIcon } from "lucide-react";
import type { Candle, TickerStats } from "@/components/trading/types";

export type AgentAction = "buy" | "sell" | "hold";
export type AgentStatus = "active" | "paused" | "training";

export interface AgentIndicator {
  name: string;
  value: number;
}

export interface AgentSignal {
  agentId: string;
  agentName: string;
  action: AgentAction;
  confidence: number; // 0-100
  reasoning: string;
  indicators: AgentIndicator[];
  timestamp: number;
}

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string | "all";
  toAgentName: string;
  message: string;
  agreement: boolean;
  timestamp: number;
}

export interface ConsensusVote {
  agentId: string;
  agentName: string;
  action: AgentAction;
  confidence: number;
  weight: number;
}

export interface ConsensusResult {
  decision: AgentAction; // final decision (buy / sell / hold)
  totalConfidence: number; // 0-100 weighted
  votes: ConsensusVote[];
  discussion: AgentMessage[];
  threshold: number; // minimum confidence to act (default 70)
  passed: boolean; // totalConfidence >= threshold AND decision != hold
  reason: string;
}

export interface ImprovementLogEntry {
  id: string;
  timestamp: number;
  trigger: string;
  parameterChange: string;
  confidenceDelta: number; // can be negative on loss-correction
  newConfidence: number;
}

export interface AgentCore {
  id: string;
  name: string;
  strategy: string;
  strategyType: string;
  icon: LucideIcon;
  iconColor: string;
  status: AgentStatus;
  winRate: number; // 0-100, derived from trade history (kept in sync by store)
  totalTrades: number; // derived from trade history
  pnl: number; // derived from trade history
  selfImprovements: number;
  confidence: number; // 0-100, base confidence level
  isLearning: boolean;
  learningUntil: number | null;
  lastSignal: AgentSignal | null;
  lastImprovement: ImprovementLogEntry | null;
  improvementLog: ImprovementLogEntry[];
  sparkline: number[];
}

// Agent analysis function signature — every agent implements this.
export type AgentAnalyzer = (
  agent: AgentCore,
  candles: Candle[],
  ticker: TickerStats,
) => AgentSignal;
