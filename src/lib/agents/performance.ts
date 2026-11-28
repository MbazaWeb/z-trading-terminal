// Performance metrics for trading agents.
// All functions are pure and operate on the Trade shape from the trade store.
// Used for measurable strategy evaluation (ZT-13).

import type { AgentPerformance } from "./types";

// Re-export for convenience
export type { AgentPerformance };

// The Trade type used for performance calculation — has pnl, status, result, agentId.
// This is the trade-store Trade, NOT the Binance recent-trade type.
export interface PerformanceTrade {
  id?: string;
  status: "open" | "closed";
  datetime: number;
  pnl: number;
  result: "win" | "loss" | null;
  agentId: string | null;
  holdTimeMs?: number | null;
}

/**
 * Calculate performance metrics from a list of closed trades for a specific agent.
 */
export function calculatePerformance(
  trades: PerformanceTrade[],
  agentId: string,
): AgentPerformance {
  const agentTrades = trades.filter(
    (t) => t.agentId === agentId && t.status === "closed",
  );
  const wins = agentTrades.filter((t) => t.result === "win");
  const losses = agentTrades.filter((t) => t.result === "loss");

  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, t) => sum + t.pnl, 0),
  );

  // Max drawdown: largest peak-to-trough decline in cumulative P&L
  let peak = 0;
  let cumulative = 0;
  let maxDD = 0;
  // Sort by datetime ascending to get chronological order
  const sorted = [...agentTrades].sort((a, b) => a.datetime - b.datetime);
  for (const t of sorted) {
    cumulative += t.pnl;
    peak = Math.max(peak, cumulative);
    maxDD = Math.max(maxDD, peak - cumulative);
  }

  // Sharpe ratio (simplified): mean P&L / std dev of P&L
  const pnls = sorted.map((t) => t.pnl);
  const n = pnls.length;
  const mean = n > 0 ? pnls.reduce((a, b) => a + b, 0) / n : 0;
  const variance =
    n > 0
      ? pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / n
      : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? mean / std : 0;

  // Average hold time (from broker timestamps if available, else 0)
  const holdTimes = sorted
    .filter((t) => (t as any).holdTimeMs != null)
    .map((t) => (t as any).holdTimeMs as number);
  const avgHold =
    holdTimes.length > 0
      ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
      : 0;

  return {
    totalTrades: agentTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: agentTrades.length > 0 ? (wins.length / agentTrades.length) * 100 : 0,
    totalPnl: cumulative,
    grossProfit,
    grossLoss,
    profitFactor:
      grossLoss > 0
        ? grossProfit / grossLoss
        : grossProfit > 0
          ? Infinity
          : 0,
    maxDrawdown: maxDD,
    avgHoldTimeMs: avgHold,
    sharpeRatio: sharpe,
    lastEvaluatedAt: Date.now(),
  };
}

/**
 * Calculate a composite score for ranking agents.
 * Weighted: winRate (40%), profitFactor (30%), sharpe (20%), -maxDrawdown (10%)
 */
export function agentScore(perf: AgentPerformance): number {
  const winRateScore = perf.winRate;
  const pfScore = Math.min(perf.profitFactor === Infinity ? 10 : perf.profitFactor, 10) * 10;
  const sharpeScore = Math.max(0, Math.min(perf.sharpeRatio * 20, 100));
  const ddScore = Math.max(0, 100 - perf.maxDrawdown * 2);
  return winRateScore * 0.4 + pfScore * 0.3 + sharpeScore * 0.2 + ddScore * 0.1;
}

/**
 * Format performance metrics for display.
 */
export function formatPerformance(perf: AgentPerformance): {
  winRate: string;
  profitFactor: string;
  maxDrawdown: string;
  sharpe: string;
  totalPnl: string;
} {
  return {
    winRate: `${perf.winRate.toFixed(1)}%`,
    profitFactor:
      perf.profitFactor === Infinity ? "∞" : perf.profitFactor.toFixed(2),
    maxDrawdown: `$${perf.maxDrawdown.toFixed(2)}`,
    sharpe: perf.sharpeRatio.toFixed(2),
    totalPnl: `${perf.totalPnl >= 0 ? "+" : ""}$${perf.totalPnl.toFixed(2)}`,
  };
}

/**
 * Format just the profit factor for display (used by AgentsView badges).
 */
export function formatProfitFactor(profitFactor: number): string {
  return profitFactor === Infinity ? "\u221e" : profitFactor.toFixed(2);
}
