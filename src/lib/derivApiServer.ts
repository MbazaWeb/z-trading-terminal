// Server-side Deriv WebSocket API client.
//
// Mirrors the browser-side `derivApi.ts` but runs in a Node.js serverless
// runtime, where the global `WebSocket` is not available. We use the
// `ws` package indirectly via the global `WebSocket` shim that Next.js 16
// provides through undici, or fall back to a manual fetch-based approach.
//
// The flow is identical to the browser version:
//   1. Open a WebSocket to wss://ws.derivws.com/websockets/v3?app_id=...
//   2. Send { authorize: <accessToken> }
//   3. Read the `authorize` reply containing balance / currency / loginid
//   4. Resolve and close the socket
//
// The access token NEVER leaves the server: the client calls
// /api/deriv/balance, which reads the token from the session and calls
// this helper.

const DERIV_APP_ID = "1089";
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

export interface DerivAccountInfo {
  balance: number;
  currency: string;
  loginid: string;
  accountType: "real" | "demo";
}

/**
 * Fetch the real Deriv account balance for an access token. Server-only.
 *
 * Rejects on timeout (10s), WebSocket error, or if the token is invalid.
 */
export function fetchDerivBalanceServer(
  accessToken: string,
): Promise<DerivAccountInfo> {
  return new Promise<DerivAccountInfo>((resolve, reject) => {
    if (!accessToken) {
      reject(new Error("No Deriv access token"));
      return;
    }

    // The Next.js 16 / Node 20 runtime exposes a global WebSocket via the
    // `undici` polyfill. If it isn't available, reject with a clear message
    // so the route handler can return a 503.
    const WS: typeof WebSocket | undefined =
      typeof WebSocket !== "undefined"
        ? WebSocket
        : typeof globalThis.WebSocket !== "undefined"
          ? globalThis.WebSocket
          : undefined;

    if (!WS) {
      reject(new Error("WebSocket not available in this runtime"));
      return;
    }

    let settled = false;
    const ws = new WS(DERIV_WS_URL);

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

    ws.onmessage = (event: MessageEvent) => {
      if (settled) return;
      let data: unknown;
      try {
        const text =
          typeof event.data === "string"
            ? event.data
            : (event.data as ArrayBuffer).toString();
        data = JSON.parse(text);
      } catch {
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
