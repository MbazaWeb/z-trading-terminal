import { NextResponse } from "next/server";
import {
  requireAuth,
  authErrorResponse
} from "@/lib/auth/session";
import { getBridgeAccount } from "@/lib/mt5BridgeServer";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let session;
  try {
    session = await requireAuth();
  } catch (error) {
    const { status, body } = authErrorResponse(error);
    return NextResponse.json(body, { status });
  }

  try {
    const { data: ownedAccount } = await supabaseAdmin
      .from("broker_accounts")
      .select("id")
      .eq("user_id", session.userId)
      .eq("broker", "mt5")
      .eq("account_number", process.env.MT5_LOGIN?.trim() ?? "")
      .eq("server", process.env.MT5_SERVER?.trim() ?? "")
      .eq("connection_status", "connected")
      .maybeSingle();
    if (!ownedAccount) {
      return NextResponse.json({ error: "MT5 broker account is not connected to this application user" }, { status: 403 });
    }
    const account = await getBridgeAccount();

    return NextResponse.json({
      ...account,
      configured: true,
      connected: true,
      provider: "mt5",
      platform: "mt5",
      accountCurrency: account.currency,
      marginLevel: account.margin > 0
        ? account.equity / account.margin * 100
        : null
    });
  } catch {
    return NextResponse.json(
      {
        configured: Boolean(process.env.MT5_BRIDGE_URL),
        connected: false,
        error: "MT5 account unavailable"
      },
      { status: 503 }
    );
  }
}
