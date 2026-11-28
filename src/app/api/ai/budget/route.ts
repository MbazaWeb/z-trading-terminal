import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { MONTHLY_LIMIT_MICRO_USD, DAILY_LIMIT_MICRO_USD, MAX_DAILY_REQUESTS } from "@/lib/ai/config";

export const dynamic = "force-dynamic";
type Usage = { reserved: bigint; actual: bigint; unresolved: bigint; daily: bigint; requests: bigint };

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await requireAdmin();
    const [usage] = await db.$queryRaw<Usage[]>`
      SELECT
        COALESCE(SUM(reserved_micro_usd) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS reserved,
        COALESCE(SUM(actual_micro_usd) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS actual,
        COUNT(*) FILTER (WHERE actual_micro_usd IS NULL AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS unresolved,
        COALESCE(SUM(reserved_micro_usd) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS daily,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS requests
      FROM private.ai_budget_reservations
    `;
    if (!usage) throw new Error("Budget unavailable");
    return NextResponse.json({
      scope: "application",
      timezone: "UTC",
      monthlyReservedMicroUsd: usage.reserved.toString(),
      monthlyRecordedActualMicroUsd: usage.actual.toString(),
      monthlyUnresolvedRequests: usage.unresolved.toString(),
      dailyReservedMicroUsd: usage.daily.toString(),
      dailyRequests: usage.requests.toString(),
      monthlyLimitMicroUsd: MONTHLY_LIMIT_MICRO_USD,
      dailyLimitMicroUsd: DAILY_LIMIT_MICRO_USD,
      dailyRequestLimit: MAX_DAILY_REQUESTS,
      observedAt: new Date().toISOString()
    }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AuthError ? "Access denied" : "Budget unavailable" },
      { status: error instanceof AuthError ? error.statusCode : 503, headers });
  }
}
