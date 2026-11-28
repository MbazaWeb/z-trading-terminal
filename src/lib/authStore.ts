"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ---- Types ------------------------------------------------------------------

/**
 * Trading mode is the source of truth for what happens when the user clicks
 * "Trade Now":
 *
 *   paper — local simulation only. No broker round-trip. Trades are tagged
 *           `source: "paper"` and `brokerOrderId: null`. The trade is
 *           recorded locally and (when Supabase is configured) persisted
 *           via /api/trades with user_id from the server session.
 *
 *   demo  — broker demo account (Deriv VRTC* or MT5 demo). Orders go through
 *           /api/mt5/trade (or the Deriv equivalent). The server enforces
 *           risk controls and returns a broker order id.
 *
 *   real  — broker real account (Deriv CR* or MT5 live). Disabled by
 *           default; requires REAL_TRADING_ENABLED=true. The trade route
 *           rejects real-account orders with a clear error otherwise.
 */
export type TradingMode = "paper" | "demo" | "real";

export interface AccountInfo {
  /** Deriv account ID or local MetaTrader login label. */
  loginid: string;
  accountType?: "real" | "demo";
  currency: string;
  /** Real balance fetched from the upstream broker. NULL while loading. */
  balance: number | null;
  /** Status of the last balance fetch — drives the sidebar badge. */
  balanceStatus: "loading" | "ok" | "error";
  email: string;
  name: string;
  /** Stable user id from the server session (used for Supabase writes). */
  userId?: string;
}

export type AuthProvider = "deriv" | "metatrader" | null;
export type AccountType = "real" | "demo" | null;
export type PendingAccountType = "real" | "demo";

interface AuthState {
  isAuthenticated: boolean;
  provider: AuthProvider;
  accountType: AccountType;
  /** Active trading mode derived from provider + accountType (or "paper"). */
  tradingMode: TradingMode;
  accountInfo: AccountInfo | null;
  /**
   * The Deriv OAuth access token is NOT stored here anymore. It lives in the
   * server-side session (HttpOnly cookie) and is only ever read by server
   * routes (/api/deriv/balance, etc.). The field remains (always null) for
   * backwards-compat with code that reads `state.accessToken`.
   */
  accessToken: string | null;
  /** Stable user id from the server session. Used for Supabase writes. */
  userId: string | null;
  /** Hint the user picked on the login screen, before OAuth/form resolves. */
  pendingAccountType: PendingAccountType | null;
  /** True once the persist middleware has rehydrated from localStorage. */
  _hasHydrated: boolean;

  // actions
  setPendingAccountType: (t: PendingAccountType) => void;
  /**
   * Finalize a Deriv OAuth login. The access token has already been stored
   * in the server-side session by /api/auth/deriv/callback — the client
   * only needs the redacted account info (loginid, accountType, currency).
   */
  loginWithDeriv: (accounts: AccountInfo[]) => void;
  /**
   * MetaTrader login. The server session is created by /api/auth/mt5-login.
   * The balance is NOT fabricated — it stays null until /api/mt5/balance
   * resolves. Demo accounts get a virtual $10,000 (clearly labeled).
   */
  loginWithMetaTrader: (loginid: string, accountType: AccountType) => void;
  setAccountType: (t: "real" | "demo") => void;
  setTradingMode: (mode: TradingMode) => void;
  /** Patch the stored account info with a partial update. */
  updateAccountInfo: (patch: Partial<AccountInfo>) => void;
  /** Set the balance status (loading / ok / error) for the sidebar badge. */
  setBalanceStatus: (status: "loading" | "ok" | "error") => void;
  /**
   * Re-fetch the real balance from the appropriate upstream provider.
   *   Deriv       -> server-side /api/deriv/balance (reads token from session)
   *   MetaTrader  -> server-side /api/mt5/balance (MetaApi.cloud)
   *   Demo        -> no-op (demo balance is fixed at $10,000 virtual)
   */
  refreshBalance: () => Promise<void>;
  /** Sync the client auth state from the server-side session (/api/auth/me). */
  syncFromServerSession: () => Promise<void>;
  /** Sign out: clear local state + call /api/auth/logout to clear cookie. */
  logout: () => Promise<void>;
  /** Internal: flipped true by the persist middleware after rehydration. */
  _setHydrated: () => void;
}

// Demo accounts use a fixed $10,000 VIRTUAL balance (clearly labeled). This
// is the ONLY balance the client sets without an upstream fetch — and it is
// explicitly marked as virtual so it's never confused with real money.
const DEMO_BALANCE = 10_000;

const ENV_MT5_LOGIN =
  process.env.NEXT_PUBLIC_MT5_LOGIN ?? process.env.MT5_LOGIN;
const ENV_MT5_SERVER =
  process.env.NEXT_PUBLIC_MT5_SERVER ?? process.env.MT5_SERVER;

const MT5_NAME = "MT5 Trader";
const MT5_EMAIL = "trader@metatrader.com";

const DEFAULT_STATE = {
  isAuthenticated: false,
  provider: null as AuthProvider,
  accountType: null as AccountType,
  tradingMode: "paper" as TradingMode,
  accountInfo: null as AccountInfo | null,
  accessToken: null as string | null,
  userId: null as string | null,
  // Default to REAL account — demo is opt-in for training only.
  pendingAccountType: "real" as PendingAccountType | null,
  _hasHydrated: false,
};

// ---- Lazy server-session sync ----------------------------------------------

async function fetchServerSession(): Promise<{
  authenticated: boolean;
  userId?: string;
  provider?: "deriv" | "metatrader";
  accountType?: "real" | "demo";
  tradingMode?: TradingMode;
  loginid?: string;
} | null> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Awaited<ReturnType<typeof fetchServerSession>>;
  } catch (err) {
    console.warn("[authStore] /api/auth/me fetch failed:", err);
    return null;
  }
}

async function fetchDerivBalanceServer(): Promise<{
  balance: number;
  currency: string;
  loginid: string;
} | null> {
  try {
    const res = await fetch("/api/deriv/balance", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (
      typeof data?.balance === "number" &&
      Number.isFinite(data.balance) &&
      typeof data?.currency === "string"
    ) {
      return {
        balance: data.balance,
        currency: data.currency,
        loginid: typeof data.loginid === "string" ? data.loginid : "",
      };
    }
    return null;
  } catch (err) {
    console.warn("[authStore] Deriv balance fetch failed:", err);
    return null;
  }
}

async function fetchMT5BalanceLazy(): Promise<{
  balance: number;
  currency: string;
} | null> {
  try {
    const res = await fetch("/api/mt5/balance", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (
      typeof data?.balance === "number" &&
      Number.isFinite(data.balance) &&
      typeof data?.currency === "string"
    ) {
      return { balance: data.balance, currency: data.currency };
    }
    return null;
  } catch (err) {
    console.warn("[authStore] MT5 balance fetch failed:", err);
    return null;
  }
}

async function postLogout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      cache: "no-store",
    });
  } catch {
    /* best-effort */
  }
}

// ---- Store ------------------------------------------------------------------

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,

      setPendingAccountType: (t) => set({ pendingAccountType: t }),

      _setHydrated: () => set({ _hasHydrated: true }),

      loginWithDeriv: (accounts) => {
        const picked = accounts[0];
        if (!picked) return;
        const inferred: "real" | "demo" = picked.loginid.startsWith("VR")
          ? "demo"
          : "real";
        const pending = useAuthStore.getState().pendingAccountType;
        const accountType: "real" | "demo" =
          picked.accountType ?? pending ?? inferred;
        const tradingMode: TradingMode =
          accountType === "demo" ? "demo" : "real";
        set({
          isAuthenticated: true,
          provider: "deriv",
          accessToken: null,
          accountInfo: {
            ...picked,
            // Deriv sends the balance from the OAuth accounts list — keep it,
            // but mark as "loading" so the sidebar knows to refresh from the
            // server-side /api/deriv/balance endpoint (which uses the live
            // token rather than the snapshot from the OAuth response).
            balance: picked.balance ?? null,
            balanceStatus: "loading",
          },
          accountType,
          tradingMode,
        });
      },

      loginWithMetaTrader: (loginid, accountType) => {
        const isDemo = accountType === "demo";
        const envLogin = ENV_MT5_LOGIN ? `MT5-${ENV_MT5_LOGIN}` : null;
        const resolvedLoginid = loginid?.trim()
          ? loginid
          : (envLogin ?? "MT5-account");
        const serverSuffix = ENV_MT5_SERVER ? ` (${ENV_MT5_SERVER})` : "";
        const tradingMode: TradingMode =
          accountType === "demo" ? "demo" : "real";
        set({
          isAuthenticated: true,
          provider: "metatrader",
          accessToken: null,
          accountType,
          tradingMode,
          accountInfo: {
            loginid: resolvedLoginid,
            currency: "USD",
            // NO fabricated balance — demo accounts get the virtual $10,000,
            // real accounts stay null until /api/mt5/balance resolves.
            balance: isDemo ? DEMO_BALANCE : null,
            balanceStatus: isDemo ? "ok" : "loading",
            email: MT5_EMAIL,
            name: `${MT5_NAME}${serverSuffix}`,
          },
        });
      },

      setAccountType: (t) => {
        const info = get().accountInfo;
        const tradingMode: TradingMode = t === "demo" ? "demo" : "real";
        if (info) {
          set({
            accountType: t,
            tradingMode,
            accountInfo: {
              ...info,
              balance: t === "demo" ? DEMO_BALANCE : info.balance,
              balanceStatus: t === "demo" ? "ok" : info.balanceStatus,
            },
          });
        } else {
          set({ accountType: t, tradingMode });
        }
        void get().refreshBalance();
      },

      setTradingMode: (mode) => set({ tradingMode: mode }),

      updateAccountInfo: (patch) => {
        const info = get().accountInfo;
        if (!info) return;
        const next: AccountInfo = { ...info, ...patch };
        if (
          patch.balance !== undefined &&
          (typeof patch.balance !== "number" || !Number.isFinite(patch.balance))
        ) {
          next.balance = info.balance;
        }
        set({ accountInfo: next });
      },

      setBalanceStatus: (status) => {
        const info = get().accountInfo;
        if (!info) return;
        set({ accountInfo: { ...info, balanceStatus: status } });
      },

      refreshBalance: async () => {
        const state = get();
        if (!state.isAuthenticated || !state.accountInfo) return;
        // Demo accounts use a fixed $10,000 virtual balance — no fetch.
        if (state.accountType === "demo") {
          get().updateAccountInfo({ balance: DEMO_BALANCE, balanceStatus: "ok" });
          return;
        }

        // Paper mode: no broker — leave balance as-is (null for real accounts
        // until they switch to demo/real broker mode).
        if (state.tradingMode === "paper") {
          return;
        }

        get().setBalanceStatus("loading");

        if (state.provider === "deriv") {
          const result = await fetchDerivBalanceServer();
          if (result) {
            get().updateAccountInfo({
              balance: result.balance,
              currency: result.currency,
              loginid: result.loginid || state.accountInfo.loginid,
              balanceStatus: "ok",
            });
          } else {
            get().setBalanceStatus("error");
          }
          return;
        }

        if (state.provider === "metatrader") {
          const result = await fetchMT5BalanceLazy();
          if (result) {
            get().updateAccountInfo({
              balance: result.balance,
              currency: result.currency,
              balanceStatus: "ok",
            });
          } else {
            get().setBalanceStatus("error");
          }
          return;
        }
      },

      syncFromServerSession: async () => {
        const server = await fetchServerSession();
        if (!server || !server.authenticated) {
          // No server session — if the client thinks it's authenticated, log
          // out (the cookie may have expired).
          const state = get();
          if (state.isAuthenticated && state.provider) {
            // Only clear if we previously had a provider session — don't
            // clobber paper mode (which intentionally has no server session).
            if (state.tradingMode !== "paper") {
              set({ ...DEFAULT_STATE });
            }
          }
          return;
        }
        // Server session exists — reconcile client state.
        const info = get().accountInfo;
        const accountType = server.accountType ?? null;
        const tradingMode: TradingMode = server.tradingMode ?? "paper";
        set({
          isAuthenticated: true,
          provider: server.provider ?? null,
          accountType,
          tradingMode,
          userId: server.userId ?? null,
          accessToken: null,
          accountInfo: info
            ? {
                ...info,
                loginid: server.loginid ?? info.loginid,
                userId: server.userId,
              }
            : {
                loginid: server.loginid ?? "",
                accountType: accountType ?? undefined,
                currency: "USD",
                balance: null,
                balanceStatus: "loading",
                email: "",
                name: "",
                userId: server.userId,
              },
        });
      },

      logout: async () => {
        await postLogout();
        set({ ...DEFAULT_STATE });
        try {
          window.localStorage.removeItem("zt_auth");
        } catch {
          /* ignore */
        }
      },
    }),
    {
      name: "zt_auth",
      storage: createJSONStorage(() => localStorage),
      // Defer rehydration so SSR + client first-render produce identical
      // HTML (avoiding hydration mismatches when a session is persisted).
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        state?._setHydrated?.();
      },
      // Persist only the data fields needed to render the UI. The Deriv
      // access token is intentionally NOT persisted — it lives only in the
      // server-side session cookie.
      partialize: ({
        isAuthenticated,
        provider,
        accountType,
        tradingMode,
        accountInfo,
        userId,
        pendingAccountType,
      }: AuthState) => ({
        isAuthenticated,
        provider,
        accountType,
        tradingMode,
        accountInfo,
        userId,
        pendingAccountType,
        // accessToken is deliberately omitted.
      }),
    },
  ),
);
