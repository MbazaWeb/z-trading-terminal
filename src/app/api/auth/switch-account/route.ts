import { NextResponse } from "next/server";
import {
  getSession,
  setSessionCookie,
  type SessionData,
  type TradingMode,
} from "@/lib/auth/session";

/**
 * POST /api/auth/switch-account
 *
 * Switches the active account type (real <-> demo) in the server-side
 * session. Used by the sidebar's Real/Demo toggle. Reads the existing
 * session, mutates the accountType + tradingMode, and re-signs the cookie.
 *
 * Body: { accountType: "real" | "demo" }
 */
interface SwitchRequestBody {
  accountType?: "real" | "demo";
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  let body: SwitchRequestBody;
  try {
    body = (await request.json()) as SwitchRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const next = body.accountType;
  if (next !== "real" && next !== "demo") {
    return NextResponse.json(
      { error: "accountType must be 'real' or 'demo'" },
      { status: 400 },
    );
  }

  // Real trading is disabled by default — refuse to switch to real mode
  // when REAL_TRADING_ENABLED is false. The user can still view their real
  // account but cannot place real-money trades (the trade route enforces
  // this separately).
  const realTradingEnabled =
    String(process.env.REAL_TRADING_ENABLED ?? "false").toLowerCase() ===
      "true" || process.env.REAL_TRADING_ENABLED === "1";

  const tradingMode: TradingMode = next === "demo" ? "demo" : "real";

  const updated: SessionData = {
    ...session,
    accountType: next,
    tradingMode,
  };

  const response = NextResponse.json({
    ok: true,
    accountType: next,
    tradingMode,
    realTradingEnabled,
  });
  setSessionCookie(response, updated);
  return response;
}
