import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

type Scope = { userId: string; provider: "metatrader" | "deriv"; accountId: string };
export async function reserveOrder(db: PrismaClient, scope: Scope, signalKey: string) {
  if (!scope.accountId.trim() || !/^[a-f0-9]{64}$/.test(signalKey)) throw new Error("Invalid order identity");
  const id = randomUUID();
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{id:string}>>`INSERT INTO private.execution_reservations(id,user_id,provider,account_id,signal_key)
      VALUES (${id}::uuid,${scope.userId}::uuid,${scope.provider},${scope.accountId},${signalKey})
      ON CONFLICT DO NOTHING RETURNING id`;
    if (rows.length !== 1) throw new Error("Duplicate signal or unresolved account order");
    return id;
  });
}
type Status = "reserved" | "submitting" | "unknown" | "confirmed" | "rejected";
const transitions: Record<Status, readonly Status[]> = {
  reserved: ["submitting","rejected"], submitting: ["unknown","confirmed","rejected"],
  unknown: ["confirmed","rejected"], confirmed: [], rejected: []
};
// Only trusted execution/reconciliation code may call this function.
// Rejection after submission requires definitive broker evidence, never a timeout.
export async function transitionOrder(db: PrismaClient, scope: Scope, id: string, from: Status, to: Status, brokerOrderId?: string) {
  if (!transitions[from].includes(to) || (to === "confirmed" && !brokerOrderId?.trim())) throw new Error("Invalid execution transition");
  const count = await db.$executeRaw`UPDATE private.execution_reservations
    SET status=${to},broker_order_id=COALESCE(${brokerOrderId ?? null},broker_order_id),updated_at=now()
    WHERE id=${id}::uuid AND user_id=${scope.userId}::uuid AND provider=${scope.provider}
    AND account_id=${scope.accountId} AND status=${from}`;
  if (count !== 1) throw new Error("Order state changed or unavailable");
}
