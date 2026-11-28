import { NextResponse } from "next/server";
import {
  setSessionCookie,
  type SessionData,
  type TradingMode,
} from "@/lib/auth/session";

/**
 * POST /api/auth/mt5-login
 *
 * Initiates a MetaTrader 5 session. The client posts the MT5 login number,
 * server, and chosen account type (real/demo). The server creates a session
 * (without storing the password — the password is only needed for one-time
 * provisioning via /api/mt5/connect, which requires admin privileges).
 *
 * Body:
 *   {
 *     login:    string,        // MT5 login number (digits only)
 *     server?:  string,        // broker server name
 *     accountType: "real" | "demo",
 *   }
 *
 * Returns:
 *   { ok: true, loginid: string, accountType, tradingMode }
 */
interface Mt5LoginRequestBody {
  login?: string;
  server?: string;
  accountType?: "real" | "demo";
}

const ENV_MT5_LOGIN =
  process.env.NEXT_PUBLIC_MT5_LOGIN ?? process.env.MT5_LOGIN;
const ENV_MT5_SERVER =
  process.env.NEXT_PUBLIC_MT5_SERVER ?? process.env.MT5_SERVER;

export async function POST(request: Request) {
  let body: Mt5LoginRequestBody;
  try {
    body = (await request.json()) as Mt5LoginRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const login = body.login?.trim();
  const accountType = body.accountType;
  if (!login || !/^\d+$/.test(login)) {
    return NextResponse.json(
      { error: "login is required and must be digits only" },
      { status: 400 },
    );
  }
  if (accountType !== "real" && accountType !== "demo") {
    return NextResponse.json(
      { error: "accountType must be 'real' or 'demo'" },
      { status: 400 },
    );
  }

  const server = body.server?.trim() || ENV_MT5_SERVER || "MT5";
  const loginid = `MT5-${login}`;
  const tradingMode: TradingMode = accountType === "demo" ? "demo" : "real";

  const sessionData: SessionData = {
    userId: loginid,
    provider: "metatrader",
    accountType,
    tradingMode,
    loginid: server ? `${loginid} (${server})` : loginid,
    // No access token for MT5 — MetaApi uses env vars (METAAPI_TOKEN +
    // MT5_ACCOUNT_ID), not a per-session token.
    issuedAt: new Date().toISOString(),
  };

  const realTradingEnabled =
    String(process.env.REAL_TRADING_ENABLED ?? "false").toLowerCase() ===
      "true" || process.env.REAL_TRADING_ENABLED === "1";

  const response = NextResponse.json({
    ok: true,
    loginid: sessionData.loginid,
    accountType,
    tradingMode,
    realTradingEnabled,
    // Echo back the env-derived default login so the client can show a hint
    // when the user leaves the field blank on subsequent logins.
    envLogin: ENV_MT5_LOGIN ?? null,
  });
  setSessionCookie(response, sessionData);
  return response;
}
