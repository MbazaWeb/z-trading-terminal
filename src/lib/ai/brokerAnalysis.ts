import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { SessionData } from "@/lib/auth/session";
import { getBrokerSnapshot } from "./brokerRouter";
import { getAIControls } from "./controlStore";
import { nativeConsensus } from "@/lib/agents/nativeConsensus";

// Native strategies use closed prices without fabricated volume statistics.
export async function analyzeBrokerMarket(db: PrismaClient, session: SessionData, symbol: string) {
  const controls = await getAIControls(db, session.userId);
  if (!controls.running || controls.emergencyStop) {
    return { action: "HOLD" as const, reason: "AI stopped", executable: false as const };
  }
  const { market } = await getBrokerSnapshot(session, symbol);
  const current = await getAIControls(db, session.userId);
  if (!current.running || current.emergencyStop || current.revision !== controls.revision) {
    return { action: "HOLD" as const, reason: "AI controls changed", executable: false as const };
  }
  const consensus = nativeConsensus({provider:"mt5",symbol:market.symbol,observedAt:market.observedAt,
    candles:market.candles,volumeType:market.volumeType,quote:{kind:"bid_ask",bid:market.bid,ask:market.ask}},current.enabledAgentIds);
  return { action: "HOLD" as const, reason: "Independent native risk validation pending", consensus,
    executable: false as const, market: { symbol: market.symbol, bid: market.bid,
      ask: market.ask, spread: market.spread, observedAt: market.observedAt,
      closedCandles: market.candles.length, volumeType: market.volumeType } };
}
