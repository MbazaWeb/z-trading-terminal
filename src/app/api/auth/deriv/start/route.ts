import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  DERIV_OAUTH_REDIRECT_URI_COOKIE,
  DERIV_OAUTH_STATE_COOKIE,
  DERIV_OAUTH_VERIFIER_COOKIE,
  getDerivRedirectUri,
} from "@/lib/derivOAuth";

const DERIV_AUTHORIZATION_URL = "https://auth.deriv.com/oauth2/auth";
const OAUTH_COOKIE_MAX_AGE = 10 * 60;

function redirectToAppWithError(request: NextRequest, error: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("deriv_error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const clientId = process.env.DERIV_CLIENT_ID?.trim();
  if (!clientId) return redirectToAppWithError(request, "configuration");

  let redirectUri: string;
  try {
    redirectUri = getDerivRedirectUri(request.url);
  } catch {
    return redirectToAppWithError(request, "configuration");
  }

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");

  const authorizationUrl = new URL(DERIV_AUTHORIZATION_URL);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "trade",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const response = NextResponse.redirect(authorizationUrl);
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  };
  response.cookies.set(DERIV_OAUTH_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(DERIV_OAUTH_VERIFIER_COOKIE, verifier, cookieOptions);
  response.cookies.set(
    DERIV_OAUTH_REDIRECT_URI_COOKIE,
    redirectUri,
    cookieOptions,
  );
  return response;
}
