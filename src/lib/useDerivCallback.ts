"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuthStore, type AccountInfo } from "@/lib/authStore";

function errorDescription(error: string): string {
  switch (error) {
    case "configuration":
      return "Deriv OAuth is not configured. Check DERIV_CLIENT_ID and DERIV_REDIRECT_URI.";
    case "invalid_state":
      return "The Deriv sign-in could not be verified. Please try again.";
    case "authorization_failed":
      return "Deriv authorization was cancelled or rejected.";
    case "token_exchange_failed":
      return "Deriv could not complete sign-in. Check the registered redirect URI and client ID.";
    case "account_lookup_failed":
      return "Deriv sign-in succeeded, but trading accounts could not be loaded.";
    case "no_accounts":
      return "No active Deriv trading accounts were found.";
    default:
      return "Deriv sign-in was cancelled or could not be completed.";
  }
}

function showDerivError(error: string) {
  toast.error("Deriv login failed", { description: errorDescription(error) });
  window.history.replaceState(null, "", window.location.pathname);
}

function completeLegacyCallback(
  params: URLSearchParams,
  loginWithDeriv: (token: string, accounts: AccountInfo[]) => void,
) {
  const error = params.get("error");
  if (error) {
    showDerivError(error);
    return true;
  }

  const accessToken = params.get("access_token");
  if (!accessToken) return false;

  const accounts: AccountInfo[] = [];
  for (let i = 1; ; i++) {
    const loginid = params.get(`acct${i}`);
    if (!loginid) break;
    const accountType = params.get(`type${i}`);
    const balance = Number(params.get(`bal${i}`));
    accounts.push({
      loginid,
      accountType:
        accountType === "demo" || accountType === "real"
          ? accountType
          : undefined,
      currency: params.get(`cur${i}`) || "USD",
      balance:
        Number.isFinite(balance) && params.has(`bal${i}`)
          ? balance
          : loginid.startsWith("VR")
            ? 10_000
            : 5_000,
      email: "",
      name: `Deriv ${loginid}`,
    });
  }

  if (accounts.length === 0) {
    toast.error("No accounts returned by Deriv");
    window.history.replaceState(null, "", window.location.pathname);
    return true;
  }

  const pending = useAuthStore.getState().pendingAccountType;
  const selected =
    (pending &&
      accounts.find(
        (account) =>
          account.accountType === pending ||
          (pending === "demo" && account.loginid.startsWith("VR")) ||
          (pending === "real" && account.loginid.startsWith("CR")),
      )) ||
    accounts[0];
  loginWithDeriv(accessToken, [selected]);
  window.history.replaceState(null, "", window.location.pathname);
  toast.success(`Welcome back, ${selected.name || selected.loginid}`, {
    description: `Connected via Deriv (${selected.loginid})`,
  });
  return true;
}

/**
 * Deriv OAuth redirect handler.
 *
 * The authorization code is exchanged by the server; the legacy fragment
 * handler remains for callbacks already in flight from the old Deriv flow.
 */
export function useDerivCallback() {
  const loginWithDeriv = useAuthStore((s) => s.loginWithDeriv);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const ranRef = useRef(false);

  useEffect(() => {
    if (!hasHydrated || ranRef.current) return;
    // Guard against SSR / non-browser environments.
    if (typeof window === "undefined") return;

    const query = new URLSearchParams(window.location.search);
    const callbackError = query.get("deriv_error");
    if (callbackError) {
      ranRef.current = true;
      showDerivError(callbackError);
      return;
    }

    const providerError = query.get("error");
    if (providerError) {
      ranRef.current = true;
      showDerivError(providerError);
      return;
    }

    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    const params = new URLSearchParams(hash.slice(1));
    if (!params.has("access_token") && !params.has("error")) return;
    ranRef.current = true;
    completeLegacyCallback(params, loginWithDeriv);
  }, [hasHydrated, loginWithDeriv]);
}
