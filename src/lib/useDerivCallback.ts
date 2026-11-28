"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/authStore";

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

/**
 * Deriv OAuth redirect handler.
 *
 * The server-side /api/auth/deriv/callback route exchanges the authorization
 * code for an access token, stores it in the HttpOnly session cookie, and
 * redirects to `/?auth=deriv`. This hook detects that redirect and asks the
 * server for the redacted session info via /api/auth/me — the access token
 * never reaches the client.
 *
 * Also handles error redirects (`/?deriv_error=...`) by showing a toast.
 */
export function useDerivCallback() {
  const syncFromServerSession = useAuthStore((s) => s.syncFromServerSession);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const ranRef = useRef(false);

  useEffect(() => {
    if (!hasHydrated || ranRef.current) return;
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

    // The server-side callback redirects to /?auth=deriv on success. Pick
    // up the new session from /api/auth/me and clean the URL.
    const authFlag = query.get("auth");
    if (authFlag === "deriv") {
      ranRef.current = true;
      void syncFromServerSession().then(() => {
        const state = useAuthStore.getState();
        if (state.isAuthenticated) {
          toast.success(`Welcome back, ${state.accountInfo?.loginid ?? "trader"}`, {
            description: `Connected via ${state.provider ?? "Deriv"} (${state.tradingMode} mode)`,
          });
        }
        window.history.replaceState(null, "", window.location.pathname);
      });
    }
    // No auth flag — fall through. The shell also calls syncFromServerSession
    // on mount to pick up sessions from prior visits.
  }, [hasHydrated, syncFromServerSession]);
}
