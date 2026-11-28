import { NextResponse } from "next/server";
import { getSession, setSessionCookie } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseServer";

export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();

    if (!body.accountId) {
      return NextResponse.json({ error: "Broker accountId is required" }, { status: 400 });
    }
    const { data: account } = await supabaseAdmin
      .from("broker_accounts")
      .select("broker,account_number,server,account_type")
      .eq("id", body.accountId)
      .eq("user_id", session.userId)
      .eq("connection_status", "connected")
      .maybeSingle();
    if (!account) return NextResponse.json({ error: "Invalid broker account" }, { status: 404 });
    if (account.account_type !== body.accountType) {
      return NextResponse.json({ error: "Account type mismatch" }, { status: 409 });
    }

    const response = NextResponse.json({
      ok: true,
      accountType: session.accountType,
      tradingMode: session.tradingMode,
      realTradingEnabled: false
    });
    setSessionCookie(response, {
      userId: session.userId,
      provider: account.broker === "mt5" ? "metatrader" : "deriv",
      accountType: account.account_type,
      tradingMode: account.account_type === "demo" ? "demo" : "real",
      loginid: account.account_number,
      issuedAt: new Date().toISOString(),
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
