// Server-side session utility.
//
// Implements a lightweight, dependency-free signed-cookie session: the session
// payload (userId, provider, accountType, loginid, optional Deriv access
// token) is JSON-encoded, base64url-encoded, and HMAC-SHA256 signed using a
// secret derived from the SESSION_SECRET env var (or a random ephemeral key
// in development when SESSION_SECRET is not set). The signed blob is stored
// in an HttpOnly, Secure, SameSite=Strict cookie named "zt_session".
//
// IMPORTANT: the Deriv OAuth access token lives ONLY inside this server-side
// session. It is never sent to the client. Any client that needs to call the
// Deriv API must go through a server-side route that reads the token from the
// session via `getSession()` / `requireAuth()`.
//
// Used by:
//   - /api/auth/deriv/callback (createSession after token exchange)
//   - /api/mt5/{trade,connect,balance,positions} (requireAuth guard)
//   - /api/deriv/balance (requireAuth + reads accessToken)
//   - /api/auth/logout (clearSession)

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "zt_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days (seconds)

// Derive the HMAC signing key once at module load. In production the deploy
// MUST set SESSION_SECRET (a 32+ byte random string). When it is missing we
// fall back to a per-process random key so local dev still works, but every
// server restart invalidates existing sessions (acceptable for dev only).
const SESSION_SECRET = process.env.SESSION_SECRET?.trim();
const FALLBACK_SECRET =
  !SESSION_SECRET && process.env.NODE_ENV !== "production"
    ? randomBytes(32).toString("hex")
    : null;
const SIGNING_KEY = SESSION_SECRET || FALLBACK_SECRET || "";

if (!SESSION_SECRET && process.env.NODE_ENV === "production") {
  console.error(
    "[session] SESSION_SECRET is not set in production. Sessions will be " +
      "signed with an empty key, which is insecure. Set SESSION_SECRET to a " +
      "32+ byte random string.",
  );
}

export type TradingMode = "paper" | "demo" | "real";

export interface SessionData {
  /** Stable user identifier (Deriv loginid or MT5 login label). */
  userId: string;
  provider: "deriv" | "metatrader";
  accountType: "real" | "demo";
  /** The active trading mode derived from provider + accountType. */
  tradingMode: TradingMode;
  loginid: string;
  /**
   * Deriv OAuth access token. Server-side only — never serialized to the
   * client bundle. Used by /api/deriv/balance to call the Deriv API.
   */
  accessToken?: string;
  /** ISO timestamp when the session was created. */
  issuedAt: string;
}

function sign(payload: string): string {
  if (!SIGNING_KEY || (process.env.NODE_ENV === "production" && SIGNING_KEY.length < 32)) throw new Error("Secure SESSION_SECRET required");
  return createHmac("sha256", SIGNING_KEY).update(payload).digest("base64url");
}

function encodeSession(data: SessionData): string {
  const json = JSON.stringify(data);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

function decodeSession(raw: string): SessionData | null {
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  if (!b64 || !sig) return null;

  // Constant-time signature comparison to avoid timing attacks.
  const expected = sign(b64);
  try {
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as SessionData;
    if (
      typeof parsed?.userId !== "string" ||
      typeof parsed?.provider !== "string" ||
      typeof parsed?.accountType !== "string" ||
      typeof parsed?.loginid !== "string"
    ) {
      return null;
    }
    if (!["deriv", "metatrader"].includes(parsed.provider) || !["demo", "real"].includes(parsed.accountType)) return null;
    const issued = Date.parse(parsed.issuedAt);
    if (!Number.isFinite(issued) || issued > Date.now() || Date.now() - issued > SESSION_MAX_AGE * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

/**
 * Set the session cookie on an existing NextResponse (e.g. a redirect). Use
 * this from route handlers that build their own response object instead of
 * relying on the implicit cookies() store.
 */
export function setSessionCookie(
  response: NextResponse,
  data: SessionData,
): void {
  const token = encodeSession(data);
  response.cookies.set(SESSION_COOKIE, token, cookieOptions());
}

/**
 * Clear the session cookie on an existing NextResponse.
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

/**
 * Create a new server-side session and set the signed HttpOnly cookie.
 *
 * Call this from a server action or route handler that returns the implicit
 * response (no explicit NextResponse). When building a custom response (e.g.
 * a redirect) use `setSessionCookie(response, data)` instead so the cookie
 * lands on the response that is actually returned.
 */
export async function createSession(data: SessionData): Promise<void> {
  const store = await cookies();
  const token = encodeSession(data);
  store.set(SESSION_COOKIE, token, cookieOptions());
}

/**
 * Read the current session from the cookie. Returns null when there is no
 * session, the cookie is malformed, or the signature does not verify.
 */
export async function getSession(): Promise<SessionData | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return decodeSession(raw);
}

/**
 * Clear the session cookie (logout). Also callable from a server route that
 * the client hits to sign out.
 */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

/**
 * Authentication guard for API routes. Returns the session data when the user
 * is authenticated; otherwise throws an AuthError that the route handler can
 * catch and convert into a 401 response.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getSession();
  if (!session) {
    throw new AuthError("Authentication required", 401);
  }
  return session;
}

/**
 * Convenience helper for routes that also need admin privileges (e.g.
 * provisioning a new MetaApi account). The owner is identified by the
 * ZT_OWNER_USER_ID env var — when unset, only the first session issued is
 * treated as admin (sufficient for single-user dev deployments).
 */
export async function requireAdmin(): Promise<SessionData> {
  const session = await requireAuth();
  const ownerId = process.env.ZT_OWNER_USER_ID?.trim();
  if (!ownerId || session.userId !== ownerId) {
    throw new AuthError("Admin privileges required", 403);
  }
  return session;
}

/**
 * Convert a thrown AuthError (or any error) into a 401/403 NextResponse.
 * Route handlers can wrap requireAuth()/requireAdmin() in try/catch and pass
 * the error here to keep boilerplate minimal.
 */
export function authErrorResponse(error: unknown): {
  status: number;
  body: { error: string };
} {
  if (error instanceof AuthError) {
    return { status: error.statusCode, body: { error: error.message } };
  }
  return {
    status: 500,
    body: {
      error: error instanceof Error ? error.message : "Internal server error",
    },
  };
}

/**
 * Resolve the trading mode for a session. Paper mode is never persisted to a
 * server session (it is purely local), so this always returns "demo" or
 * "real" for an authenticated session.
 */
export function sessionTradingMode(session: SessionData): TradingMode {
  return session.tradingMode ?? (session.accountType === "demo" ? "demo" : "real");
}
