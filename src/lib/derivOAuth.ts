export const DERIV_OAUTH_STATE_COOKIE = "deriv_oauth_state";
export const DERIV_OAUTH_VERIFIER_COOKIE = "deriv_oauth_verifier";
export const DERIV_OAUTH_REDIRECT_URI_COOKIE = "deriv_oauth_redirect_uri";

export function getDerivRedirectUri(requestUrl: string): string {
  const configuredUri = process.env.DERIV_REDIRECT_URI?.trim();
  const redirectUri = configuredUri
    ? /^https?:\/\//i.test(configuredUri)
      ? configuredUri
      : `https://${configuredUri}`
    : new URL("/api/auth/deriv/callback", requestUrl).toString();
  const parsedUri = new URL(redirectUri);

  if (
    (parsedUri.protocol !== "https:" && parsedUri.protocol !== "http:") ||
    parsedUri.origin !== new URL(requestUrl).origin
  ) {
    throw new Error("Deriv redirect URI must use this app's origin.");
  }

  return redirectUri;
}
