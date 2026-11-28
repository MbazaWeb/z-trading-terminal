import { NextRequest, NextResponse } from "next/server";
import {
  DERIV_OAUTH_REDIRECT_URI_COOKIE,
  DERIV_OAUTH_STATE_COOKIE,
  DERIV_OAUTH_VERIFIER_COOKIE,
  getDerivRedirectUri,
} from "@/lib/derivOAuth";
import { setSessionCookie, type SessionData } from "@/lib/auth/session";
import { requireAuth } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { encryptCredential } from "@/lib/brokerCredentials";

const DERIV_TOKEN_URL = "https://auth.deriv.com/oauth2/token";
const DERIV_ACCOUNTS_URL =
  "https://api.derivws.com/trading/v1/options/accounts";

interface DerivAccount {
  account_id: string;
  account_type: "demo" | "real";
  balance: number;
  currency: string;
  status: "active" | "inactive";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clearOAuthCookies(response: NextResponse) {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(DERIV_OAUTH_STATE_COOKIE, "", cookieOptions);
  response.cookies.set(DERIV_OAUTH_VERIFIER_COOKIE, "", cookieOptions);
  response.cookies.set(DERIV_OAUTH_REDIRECT_URI_COOKIE, "", cookieOptions);
  return response;
}

function redirectToApp(request: NextRequest, error: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("deriv_error", error);
  return clearOAuthCookies(NextResponse.redirect(url));
}

function isDerivAccount(value: unknown): value is DerivAccount {
  return (
    isRecord(value) &&
    typeof value.account_id === "string" &&
    (value.account_type === "demo" || value.account_type === "real") &&
    typeof value.balance === "number" &&
    typeof value.currency === "string" &&
    (value.status === "active" || value.status === "inactive")
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  let appSession;
  try {
    appSession = await requireAuth();
  } catch {
    return redirectToApp(request, "application_auth_required");
  }
  const query = request.nextUrl.searchParams;
  const code = query.get("code") || "";
  const state = query.get("state") || "";
  const clientId = process.env.DERIV_CLIENT_ID?.trim();
  const expectedState = request.cookies.get(DERIV_OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(DERIV_OAUTH_VERIFIER_COOKIE)?.value;
  const redirectUri = request.cookies.get(
    DERIV_OAUTH_REDIRECT_URI_COOKIE,
  )?.value;

  if (query.has("error")) return redirectToApp(request, "authorization_failed");
  if (!code || !state || !expectedState || !verifier || !redirectUri) {
    return redirectToApp(request, "invalid_state");
  }
  if (state !== expectedState) return redirectToApp(request, "invalid_state");
  if (!clientId) return redirectToApp(request, "configuration");

  let expectedRedirectUri: string;
  try {
    expectedRedirectUri = getDerivRedirectUri(request.url);
  } catch {
    return redirectToApp(request, "configuration");
  }
  const callbackUrl = new URL(request.url);
  const redirectUrl = new URL(redirectUri);
  if (
    redirectUri !== expectedRedirectUri ||
    redirectUrl.origin !== callbackUrl.origin ||
    redirectUrl.pathname !== callbackUrl.pathname
  ) {
    return redirectToApp(request, "configuration");
  }

  // Exchange the authorization code for an access token SERVER-SIDE.
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(DERIV_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });
  } catch {
    return redirectToApp(request, "token_exchange_failed");
  }

  const tokenPayload = await readJson(tokenResponse);
  if (
    !tokenResponse.ok ||
    !isRecord(tokenPayload) ||
    typeof tokenPayload.access_token !== "string"
  ) {
    return redirectToApp(request, "token_exchange_failed");
  }

  const accessToken = tokenPayload.access_token as string;

  // Look up the user's trading accounts so we can record the loginid + type
  // in the session. The access token itself never leaves the server.
  let accountsResponse: Response;
  try {
    accountsResponse = await fetch(DERIV_ACCOUNTS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Deriv-App-ID": clientId,
      },
      cache: "no-store",
    });
  } catch {
    return redirectToApp(request, "account_lookup_failed");
  }

  const accountsPayload = await readJson(accountsResponse);
  if (!accountsResponse.ok || !isRecord(accountsPayload)) {
    return redirectToApp(request, "account_lookup_failed");
  }

  const accounts = Array.isArray(accountsPayload.data)
    ? accountsPayload.data
        .filter(isDerivAccount)
        .filter((account) => account.status === "active")
    : [];
  if (accounts.length === 0) return redirectToApp(request, "no_accounts");

  // Pick the first active account. The client can switch account type via the
  // sidebar (which calls /api/auth/switch-account to update the session).
  const account = accounts[0];
  const accountType: "real" | "demo" = account.account_type;
  try {
    const { data: brokerAccount, error } = await supabaseAdmin
      .from("broker_accounts")
      .upsert({
        user_id: appSession.userId,
        broker: "deriv",
        account_number: account.account_id,
        server: "Deriv",
        currency: account.currency,
        balance: account.balance,
        equity: account.balance,
        account_type: accountType,
        connection_status: "connected",
        last_synced_at: new Date().toISOString(),
      }, { onConflict: "user_id,broker,account_number,server" })
      .select("id")
      .single();
    if (error) throw error;
    const encrypted = encryptCredential(accessToken);
    await supabaseAdmin.from("broker_credentials").upsert({
      broker_account_id: brokerAccount.id,
      user_id: appSession.userId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      key_id: encrypted.keyId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "broker_account_id" });
  } catch {
    return redirectToApp(request, "account_storage_failed");
  }

  // Enforce REAL_TRADING_ENABLED for real accounts. When real trading is
  // disabled we still issue a session so the user can see their (read-only)
  // account, but the trade endpoint will reject real orders.
  const sessionData: SessionData = {
    userId: appSession.userId,
    provider: "deriv",
    accountType,
    tradingMode: accountType === "demo" ? "demo" : "real",
    loginid: account.account_id,
    issuedAt: new Date().toISOString(),
  };

  // Sign and persist the session in an HttpOnly cookie before redirecting.
  // We build the redirect response first, then set both the session cookie
  // and the OAuth-clear cookies on the SAME response so they survive the
  // redirect (next/headers cookies() would not propagate to a returned
  // NextResponse.redirect).
  const appUrl = new URL("/?auth=deriv", request.url);
  const redirect = NextResponse.redirect(appUrl);
  setSessionCookie(redirect, sessionData);
  return clearOAuthCookies(redirect);
}
