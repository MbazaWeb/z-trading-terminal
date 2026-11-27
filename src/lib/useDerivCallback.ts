"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuthStore, type AccountInfo } from "@/lib/authStore";

/**
 * Deriv OAuth redirect handler.
 *
 * Deriv returns the access token and account list in the URL *fragment*
 * (after the `#`). Example:
 *
 *   #access_token=xxx&acct1=CR123&token1=yyy&cur1=USD&acct2=VR456&token2=zzz&cur2=USD&...
 *
 * We parse that fragment, pick the account that matches the
 * `pendingAccountType` the user chose on the login screen (preferring `VR`
 * prefixes for demo and `CR` for real), then hand the result to the auth
 * store. If an `error` key is present instead, we surface a toast and stay on
 * the login screen.
 */
export function useDerivCallback() {
  const loginWithDeriv = useAuthStore((s) => s.loginWithDeriv);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    // Guard against SSR / non-browser environments.
    if (typeof window === "undefined") return;

    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    ranRef.current = true;

    const error = params.get("error");
    if (error) {
      toast.error("Deriv login failed", {
        description: error.replace(/\+/g, " "),
      });
      // Clean the URL so a refresh does not replay the error.
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    const accessToken = params.get("access_token");
    if (!accessToken) {
      // Nothing we can do here — let the user proceed normally.
      return;
    }

    // Collect every account Deriv returned. Keys look like acct1 / cur1 / ...
    const accounts: AccountInfo[] = [];
    for (let i = 1; ; i++) {
      const acct = params.get(`acct${i}`);
      const cur = params.get(`cur${i}`);
      if (!acct) break;
      accounts.push({
        loginid: acct,
        currency: cur || "USD",
        balance: 0, // Provider does not surface balance in the OAuth fragment.
        email: "", // Will be fetched in a real integration via the WS API.
        name: `Deriv ${acct}`,
      });
    }

    if (accounts.length === 0) {
      toast.error("No accounts returned by Deriv");
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    const pending = useAuthStore.getState().pendingAccountType;
    const wantReal = pending === "real";
    const wantDemo = pending === "demo";

    let selected = accounts[0];
    if (wantDemo) {
      selected =
        accounts.find((a) => a.loginid.startsWith("VR")) || selected;
    } else if (wantReal) {
      selected =
        accounts.find((a) => a.loginid.startsWith("CR")) || selected;
    }

    // Apply default balances since the OAuth fragment does not include them.
    const isDemoAccount = selected.loginid.startsWith("VR");
    selected = {
      ...selected,
      balance: isDemoAccount ? 10_000 : 5_000,
    };

    loginWithDeriv(accessToken, [selected]);

    window.history.replaceState(null, "", window.location.pathname);

    toast.success(`Welcome back, ${selected.name || selected.loginid}`, {
      description: `Connected via Deriv (${selected.loginid})`,
    });
  }, [loginWithDeriv]);
}
