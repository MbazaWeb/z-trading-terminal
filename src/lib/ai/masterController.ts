import type { PrismaClient } from "@prisma/client";
import type { Candle, TickerStats } from "@/components/trading/types";
import { AGENT_REGISTRY } from "@/lib/agents/registry";
import type { AgentSignal } from "@/lib/agents/types";
import { analyzeEvidence } from "./client";
import { coordinateAgents } from "./agentCoordinator";
import { getAIControls } from "./controlStore";

const specialists = new Set(["risk", "stopLoss", "stopWin", "pip", "alert"]);
export function gateSignals(signals: AgentSignal[], now: number) {
  const valid = signals.filter(s => AGENT_REGISTRY.some(a => a.id === s.agentId) &&
    Number.isFinite(s.timestamp) && s.timestamp <= now && now - s.timestamp <= 60000 &&
    Number.isFinite(s.confidence) && s.confidence >= 0 && s.confidence <= 100);
  const unique = new Map(valid.map(s => [s.agentId, s]));
  if (unique.size !== valid.length) return "HOLD" as const;
  const risk = unique.get("risk")?.indicators.find(i => i.name === "RiskScore")?.value;
  if (risk === undefined || !Number.isFinite(risk) || risk < 0 || risk >= 60) return "HOLD" as const;
  const directional = [...unique.values()].filter(s => !specialists.has(s.agentId));
  if (directional.length < 6) return "HOLD" as const;
  const buy = directional.filter(s => s.action === "buy" && s.confidence >= 60).length;
  const sell = directional.filter(s => s.action === "sell" && s.confidence >= 60).length;
  if (buy >= 4 && buy / directional.length >= 0.7) return "BUY" as const;
  if (sell >= 4 && sell / directional.length >= 0.7) return "SELL" as const;
  return "HOLD" as const;
}

// Internal advisory only. Caller must supply verified broker data, not browser input.
export async function evaluateMarket(db: PrismaClient, userId: string, market: {
  symbol: string; observedAt: number; marketOpen: boolean; candles: Candle[]; ticker: TickerStats;
}) {
  const now = Date.now();
  const hold = (reason: string) => ({ action: "HOLD" as const, reason, executable: false as const });
  if (!market.marketOpen || !Number.isFinite(market.observedAt) || market.observedAt > now ||
      now - market.observedAt > 60000 || market.candles.length < 50 ||
      !Number.isFinite(market.ticker.lastPrice) || market.ticker.lastPrice <= 0) return hold("Market data unavailable or stale");
  const controls = await getAIControls(db, userId).catch(() => null);
  if (!controls?.running || controls.emergencyStop) return hold("AI controls stopped or unavailable");
  const { signals, riskReady } = coordinateAgents(market.candles, market.ticker, controls.enabledAgentIds);
  if (!riskReady) return hold("Required risk agents unavailable");
  const candidate = gateSignals(signals, Date.now());
  if (candidate === "HOLD") return hold("Insufficient consensus or elevated risk");
  const evidence = JSON.stringify({ symbol: market.symbol, price: market.ticker.lastPrice,
    candidate, signals: signals.map(s => [s.agentId, s.action, s.confidence]) });
  try {
    const before = await getAIControls(db, userId);
    if (!before.running || before.emergencyStop || before.revision !== controls.revision) return hold("AI controls changed");
    const result = await analyzeEvidence(db, evidence);
    const after = await getAIControls(db, userId);
    if (!after.running || after.emergencyStop || after.revision !== controls.revision) return hold("AI controls changed");
    if (Date.now() - market.observedAt > 60000 || result.decision.action !== candidate) return hold("AI disagreement or expired evidence");
    return { action: candidate, reason: result.decision.rationale, reservationId: result.reservationId, executable: false as const };
  } catch {
    return hold("AI unavailable or budget limit reached");
  }
}
