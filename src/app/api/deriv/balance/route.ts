import { NextResponse } from "next/server";
import { requireAuth, authErrorResponse } from "@/lib/auth/session";
import { fetchDerivBalanceServer } from "@/lib/derivApiServer";

/**
 * GET /api/deriv/balance
 *
 * Fetches the real Deriv account balance by reading the OAuth access token
 * from the server-side session and calling the Deriv WebSocket API from the
 * server. The access token never reaches the client.
 *
 * Returns HTTP 401 when no session exists; HTTP 400 when the session has no
 * Deriv token (e.g. the user logged in via MetaTrader); HTTP 502 when the
 * Deriv API call fails.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    if (session.provider !== "deriv" || !session.accessToken) {
      return NextResponse.json(
        { error: "No Deriv access token in session" },
        { status: 400 },
      );
    }

    const info = await fetchDerivBalanceServer(session.accessToken);
    return NextResponse.json({
      configured: true,
      balance: info.balance,
      currency: info.currency,
      loginid: info.loginid,
      accountType: info.accountType,
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    if (status === 401) {
      return NextResponse.json(body, { status });
    }
    // Deriv API error
    return NextResponse.json(
      {
        configured: true,
        error: err instanceof Error ? err.message : "Deriv balance fetch failed",
      },
      { status: 502 },
    );
  }
}
