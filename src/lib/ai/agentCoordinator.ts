import type { Candle, TickerStats } from "@/components/trading/types";
import { AGENT_REGISTRY, runAgentAnalysis } from "@/lib/agents/registry";
import type { AgentSignal } from "@/lib/agents/types";

export function coordinateAgents(candles: Candle[], ticker: TickerStats, enabledIds: readonly string[]) {
  const enabled = new Set(enabledIds);
  if ([...enabled].some(id => !AGENT_REGISTRY.some(agent => agent.id === id))) {
    throw new Error("Unknown agent configuration");
  }
  const signals: AgentSignal[] = [];
  const failures: string[] = [];
  const disabled: string[] = [];
  for (const agent of AGENT_REGISTRY) {
    if (!enabled.has(agent.id)) { disabled.push(agent.id); continue; }
    try {
      const signal = runAgentAnalysis(agent.id, candles, ticker);
      if (!signal || signal.agentId !== agent.id) throw new Error("Invalid signal");
      signals.push(signal);
    } catch {
      failures.push(agent.id);
    }
  }
  return { signals, failures, disabled, riskReady: ["risk", "stopLoss", "stopWin"].every(id =>
    enabled.has(id) && signals.some(signal => signal.agentId === id)) };
}
