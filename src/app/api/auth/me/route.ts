import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

/**
 * GET /api/auth/me
 *
 * Returns a redacted view of the current server-side session. The Deriv
 * access token is NEVER returned to the client — the response only includes
 * the fields the client needs to render the UI (provider, accountType,
 * loginid, tradingMode). The client uses this on mount and after the Deriv
 * OAuth redirect to know whether a server session exists.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    provider: session.provider,
    accountType: session.accountType,
    tradingMode: session.tradingMode,
    loginid: session.loginid,
    issuedAt: session.issuedAt,
  });
}
