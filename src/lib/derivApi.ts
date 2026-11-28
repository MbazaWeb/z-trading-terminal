"use client";

// Deriv WebSocket API client.
//
// After Deriv OAuth login, the access token is stored in `authStore.accessToken`.
// We use it to fetch the REAL account balance from the Deriv WebSocket API.
//
// Docs: https://api.deriv.com/
// WebSocket: wss://ws.derivws.com/websockets/v3?app_id={APP_ID}
//
// The flow is:
//   1. Open a WebSocket to the Deriv streaming endpoint with the app_id.
//   2. Send `{ authorize: <accessToken> }` once the socket opens.
//   3. The server replies with an `authorize` message that contains the
//      current balance, currency, loginid, and account_type (CR/VRTC/etc.).
//   4. Resolve with the parsed balance + close the socket.
//
// If anything goes wrong (timeout, server error, network drop) the promise
// rejects so the caller can fall back to the previously stored balance.

const DERIV_APP_ID = "1089"; // Same app id used by the OAuth flow.

export interface DerivAccountInfo {
  balance: number;
  currency: string;
  loginid: string;
  accountType: "real" | "demo";
}

/**
 * Fetch the real account balance for a Deriv access token.
 *
 * Returns the parsed account info on success. Rejects on timeout (10s),
 * WebSocket error, or if the server returns an `error` payload (e.g. the
 * token is expired or invalid).
 */
export function fetchDerivBalance(
  accessToken: string,
): Promise<DerivAccountInfo> {
  return new Promise<DerivAccountInfo>((resolve, reject) => {
    if (!accessToken) {
      reject(new Error("No Deriv access token"));
      return;
    }
    // Guard against SSR / non-browser environments. This module is marked
    // "use client" but the import is sometimes hoisted during SSR builds.
    if (typeof WebSocket === "undefined") {
      reject(new Error("WebSocket not available"));
      return;
    }

    let settled = false;
    const ws = new WebSocket(
      `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`,
    );

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error("Deriv API timeout"));
    }, 10_000);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ authorize: accessToken }));
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(err instanceof Error ? err : new Error("Deriv send failure"));
      }
    };

    ws.onmessage = (event) => {
      if (settled) return;
      let data: unknown;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        // Ignore non-JSON frames (heartbeats etc.) and wait for the real reply.
        return;
      }
      const payload = data as {
        msg_type?: string;
        error?: { message?: string };
        authorize?: {
          balance?: string;
          currency?: string;
          loginid?: string;
          account_type?: string;
        };
      };
      if (payload.error) {
        settled = true;
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(
          new Error(payload.error.message ?? "Deriv authorize failed"),
        );
        return;
      }
      if (payload.msg_type === "authorize" && payload.authorize) {
        const auth = payload.authorize;
        const balance = parseFloat(auth.balance ?? "");
        const loginid = auth.loginid ?? "";
        // Deriv login ids starting with "VR" / "VRTC" are virtual (demo)
        // accounts. Everything else (CR/MF/...) is real money.
        const accountType: "real" | "demo" =
          loginid.startsWith("VR") || loginid.startsWith("VRT")
            ? "demo"
            : "real";
        settled = true;
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve({
          balance: Number.isFinite(balance) ? balance : 0,
          currency: auth.currency ?? "USD",
          loginid,
          accountType,
        });
      }
    };

    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error("Deriv WebSocket error"));
    };

    ws.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error("Deriv WebSocket closed before authorize"));
    };
  });
}
