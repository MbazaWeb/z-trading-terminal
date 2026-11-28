import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DAILY_LIMIT_MICRO_USD, MONTHLY_LIMIT_MICRO_USD, MAX_DAILY_REQUESTS } from "./config";

// All reservations remain charged conservatively, including ambiguous failures.
// No automatic refunds: actual usage reconciliation is a separate operation.
export async function reserveAIRequest(db: PrismaClient, cost: number): Promise<string> {
  if (!Number.isSafeInteger(cost) || cost <= 0 || cost > DAILY_LIMIT_MICRO_USD) {
    throw new Error("Invalid AI reservation");
  }
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(82917463)) AS guard`;
    const rows = await tx.$queryRaw<Array<{monthly: bigint; daily: bigint; requests: bigint}>>`
      SELECT
        COALESCE(SUM(reserved_micro_usd) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS monthly,
        COALESCE(SUM(reserved_micro_usd) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS daily,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS requests
      FROM private.ai_budget_reservations
    `;
    const usage = rows[0];
    if (!usage || usage.monthly + BigInt(cost) > BigInt(MONTHLY_LIMIT_MICRO_USD) ||
        usage.daily + BigInt(cost) > BigInt(DAILY_LIMIT_MICRO_USD) ||
        usage.requests >= BigInt(MAX_DAILY_REQUESTS)) throw new Error("AI budget exhausted");
    const id = randomUUID();
    await tx.$executeRaw`INSERT INTO private.ai_budget_reservations (id, reserved_micro_usd) VALUES (${id}::uuid, ${cost})`;
    return id;
  });
}
