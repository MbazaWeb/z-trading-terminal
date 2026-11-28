import { NextResponse } from "next/server";
import { requireAuth, authErrorResponse } from "@/lib/auth/session";
import { fetchDerivBalanceServer } from "@/lib/derivApiServer";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { decryptCredential } from "@/lib/brokerCredentials";

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
    if (session.provider !== "deriv") {
      return NextResponse.json(
        { error: "No Deriv account selected" },
        { status: 400 },
      );
    }
    const { data: account, error: accountError } = await supabaseAdmin
      .from("broker_accounts")
      .select("id,account_number")
      .eq("user_id", session.userId)
      .eq("broker", "deriv")
      .eq("account_number", session.loginid ?? "")
      .eq("connection_status", "connected")
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: "Deriv account not connected" }, { status: 403 });
    const { data: credential, error: credentialError } = await supabaseAdmin
      .from("broker_credentials")
      .select("ciphertext,iv")
      .eq("broker_account_id", account.id)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential) return NextResponse.json({ error: "Deriv authorization unavailable" }, { status: 400 });
    const accessToken = decryptCredential(credential.ciphertext, credential.iv);
    const info = await fetchDerivBalanceServer(accessToken);
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
