import "server-only";
import type { PrismaClient } from "@prisma/client";
import { getAIControls } from "@/lib/ai/controlStore";
import { reserveOrder, transitionOrder } from "./orderReservation";

type Scope = { userId: string; provider: "metatrader"; accountId: string };
type BrokerOutcome = { status: "confirmed"; brokerOrderId: string } | { status: "unknown" };
// Transport must independently enforce demo account binding, protective orders,
// fresh broker preflight, durable request identity and aggregate risk checks.
export async function submitReservedDemoOrder(
  db: PrismaClient, scope: Scope, signalKey: string,
  transport: (reservationId: string) => Promise<BrokerOutcome>
) {
  if (process.env.REAL_TRADING_ENABLED !== "false" ||
      process.env.MT5_DEMO_EXECUTION !== "true" ||
      process.env.ZT_OWNER_USER_ID !== scope.userId ||
      process.env.MT5_LOGIN !== scope.accountId) throw new Error("Demo execution disabled");
  const initial = await getAIControls(db, scope.userId);
  if (!initial.running || initial.emergencyStop) throw new Error("Strategy controller stopped");
  const id = await reserveOrder(db, scope, signalKey);
  const current = await getAIControls(db, scope.userId);
  if (!current.running || current.emergencyStop || current.revision !== initial.revision) {
    await transitionOrder(db, scope, id, "reserved", "rejected");
    throw new Error("Strategy controls changed");
  }
  await transitionOrder(db, scope, id, "reserved", "submitting");
  let outcome: BrokerOutcome;
  try {
    outcome = await transport(id);
  } catch {
    outcome = { status: "unknown" };
  }
  if (outcome.status === "confirmed" && outcome.brokerOrderId?.trim()) {
    await transitionOrder(db, scope, id, "submitting", "confirmed", outcome.brokerOrderId);
    return { id, status: "confirmed" as const, brokerOrderId: outcome.brokerOrderId };
  }
  await transitionOrder(db, scope, id, "submitting", "unknown");
  return { id, status: "unknown" as const };
}
