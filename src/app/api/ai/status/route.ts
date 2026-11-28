import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const session = await requireAuth();
    const realSelected = session.accountType === "real" && session.tradingMode === "real" && !!session.provider && !!session.loginid;
    return NextResponse.json({
      selectedMode: session.tradingMode,
      analysisSource: "local",
      paidInferenceAvailable: false,
      realAccountVerified: false,
      freeAllowanceVerified: false,
      reason: realSelected ? "Real broker verification and AI release pending" : "OpenAI restricted to verified real accounts",
      monthlyApprovedUsd: 5
    }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AuthError ? "Access denied" : "Status unavailable" },
      { status: error instanceof AuthError ? error.statusCode : 503, headers });
  }
}
