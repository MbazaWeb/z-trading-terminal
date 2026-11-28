import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth/session";

import { getVerifiedBridgeAccount } from "@/lib/mt5BridgeServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const session = await requireAuth();
    const realSelected = session.accountType === "real" && session.tradingMode === "real" && !!session.provider && !!session.loginid;
    let realAccountVerified = false;
    if (realSelected && session.provider === "metatrader" && session.userId === process.env.ZT_OWNER_USER_ID?.trim()) {
      try {
        const account = await getVerifiedBridgeAccount();
        realAccountVerified = account.accountType === "real" && account.login === session.loginid;
      } catch { /* Unavailable identity remains unverified. */ }
    }
    return NextResponse.json({
      selectedMode: session.tradingMode,
      analysisSource: "local",
      paidInferenceAvailable: false,
      realAccountVerified,
      freeAllowanceVerified: false,
      reason: realAccountVerified ? "Real MT5 identity verified; AI release pending" : realSelected ? "Real broker verification and AI release pending" : "OpenAI restricted to verified real accounts",
      monthlyApprovedUsd: 5
    }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AuthError ? "Access denied" : "Status unavailable" },
      { status: error instanceof AuthError ? error.statusCode : 503, headers });
  }
}
