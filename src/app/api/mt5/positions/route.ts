import { NextResponse } from "next/server";
import {
  requireAuth,
  authErrorResponse
} from "@/lib/auth/session";
import {
  bridgeRequest,
  getBridgeAccount,
  type BridgePosition
} from "@/lib/mt5BridgeServer";
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

    const result = await bridgeRequest<{
      positions: BridgePosition[];
    }>("/positions");

    if (!Array.isArray(result.positions)) {
      throw new Error("Invalid broker positions");
    }

    const positions = result.positions.map(p => ({
      ...p,
      unrealizedProfit: p.profit,
      swap: null,
      stopLoss: p.stopLoss || null,
      takeProfit: p.takeProfit || null,
      comment: null
    }));

    return NextResponse.json({
      configured: true,
      connected: true,
      positions,
      count: positions.length,
      server: account.server,
      login: account.login
    });
  } catch {
    return NextResponse.json(
      {
        configured: Boolean(process.env.MT5_BRIDGE_URL),
        connected: false,
        error: "Broker positions unavailable"
      },
      { status: 503 }
    );
  }
}
