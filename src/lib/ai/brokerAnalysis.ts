import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { SessionData } from "@/lib/auth/session";
import { getBrokerSnapshot } from "./brokerRouter";
import { getAIControls } from "./controlStore";

// Do not fabricate 24-hour statistics or substitute tick counts for traded volume.
// Until agent inputs support missing statistics, return an explicit non-executable hold.
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
  return { action: "HOLD" as const, reason: "Agent ticker statistics require native 24-hour history",
    executable: false as const, market: { symbol: market.symbol, bid: market.bid,
      ask: market.ask, spread: market.spread, observedAt: market.observedAt,
      closedCandles: market.candles.length, volumeType: market.volumeType } };
}
