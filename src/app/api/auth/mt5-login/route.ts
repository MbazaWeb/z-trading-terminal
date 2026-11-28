import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth/session";
import { getBridgeAccount } from "@/lib/mt5BridgeServer";
import { requireAuth } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  if (origin !== new URL(request.url).origin) {
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 }
    );
  }

  let appSession;
  try {
    appSession = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Sign in to Z Trading Terminal first" }, { status: 401 });
  }

  const ownerId = process.env.MT5_OWNER_USER_ID?.trim();
  if (!ownerId) {
    return NextResponse.json({ error: "MT5 owner UUID is not configured" }, { status: 503 });
  }
  if (appSession.userId !== ownerId) {
    return NextResponse.json({ error: "This local MT5 account is restricted to its verified owner" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const login = String(body.login ?? "").trim();
    const server = String(body.server ?? "").trim();

    if (
      body.accountType !== "demo" ||
      !login
    ) {
      return NextResponse.json(
        { error: "A valid demo account number and server are required" },
        { status: 400 }
      );
    }

    const account = await getBridgeAccount();

    if (
      account.login !== login ||
      account.server !== server ||
      account.accountType !== "demo"
    ) {
      return NextResponse.json(
        { error: "Broker account mismatch" },
        { status: 403 }
      );
    }

    const loginid = `MT5-${login}`;
    const { error: accountWriteError } = await supabaseAdmin.from("broker_accounts").upsert({
      user_id: appSession.userId,
      broker: "mt5",
      account_number: login,
      server,
      currency: account.currency,
      account_type: "demo",
      connection_status: "connected",
      balance: account.balance,
      equity: account.equity,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: "user_id,broker,account_number,server" });
    if (accountWriteError) throw accountWriteError;

    const response = NextResponse.json({
      ok: true,
      loginid,
      accountType: "demo",
      tradingMode: "demo",
      realTradingEnabled: false
    });

    setSessionCookie(response, {
      userId: appSession.userId,
      loginid,
      provider: "metatrader",
      accountType: "demo",
      tradingMode: "demo",
      issuedAt: new Date().toISOString()
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "MT5 authentication unavailable" },
      { status: 503 }
    );
  }
}
