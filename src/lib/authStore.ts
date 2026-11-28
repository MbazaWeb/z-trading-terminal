"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ---- Types ------------------------------------------------------------------

export interface AccountInfo {
  /** Deriv account ID or local MetaTrader login label. */
  loginid: string;
  accountType?: "real" | "demo";
  currency: string;
  balance: number;
  email: string;
  name: string;
}

export type AuthProvider = "deriv" | "metatrader" | null;
export type AccountType = "real" | "demo" | null;
export type PendingAccountType = "real" | "demo";

interface AuthState {
  isAuthenticated: boolean;
  provider: AuthProvider;
  accountType: AccountType;
  accountInfo: AccountInfo | null;
  accessToken: string | null;
  /** Hint the user picked on the login screen, before OAuth/form resolves. */
  pendingAccountType: PendingAccountType | null;
  /** True once the persist middleware has rehydrated from localStorage. */
  _hasHydrated: boolean;

  // actions
  setPendingAccountType: (t: PendingAccountType) => void;
  loginWithDeriv: (token: string, accounts: AccountInfo[]) => void;
  loginWithMetaTrader: (loginid: string, accountType: AccountType) => void;
  setAccountType: (t: "real" | "demo") => void;
  /**
   * Patch the stored account info with a partial update. Used to push the
   * real balance (fetched from the Deriv WebSocket API or the MT5 REST API)
   * into the store after the initial login has resolved.
   */
  updateAccountInfo: (patch: Partial<AccountInfo>) => void;
  /**
   * Re-fetch the real balance from the appropriate upstream provider.
   *
   * For Deriv: opens a short-lived WebSocket to the Deriv API with the
   * stored access token and reads the authorize.balance field.
   *
   * For MetaTrader: hits the server-side /api/mt5/balance endpoint, which
   * proxies to MetaApi.cloud (configured via METAAPI_TOKEN + MT5_ACCOUNT_ID
   * env vars).
   *
   * For Demo / unauthenticated: no-op (demo balance is fixed at $10,000).
   */
  refreshBalance: () => Promise<void>;
  logout: () => void;
  /** Internal: flipped true by the persist middleware after rehydration. */
  _setHydrated: () => void;
}

// Default balances (used when the provider does not supply one).
const DEMO_BALANCE = 10_000;

// Real account balance: prefer the NEXT_PUBLIC_MT5_INITIAL_BALANCE env var so
// the demo environment mirrors a real Equiti brokerage account (e.g. $10.98).
// We deliberately use the NEXT_PUBLIC_ prefix so this is inlined into the
// client bundle at build time (non-prefixed vars are NOT exposed to client
// code by Next.js, so accessing `process.env.MT5_INITIAL_BALANCE` from the
// client silently returns undefined). Falls back to the non-prefixed var if
// the deploy sets that instead, then to a sensible $5,000 default.
const ENV_REAL_BALANCE_RAW =
  process.env.NEXT_PUBLIC_MT5_INITIAL_BALANCE ??
  process.env.MT5_INITIAL_BALANCE;
const ENV_REAL_BALANCE = Number(ENV_REAL_BALANCE_RAW);
const REAL_BALANCE =
  Number.isFinite(ENV_REAL_BALANCE) && ENV_REAL_BALANCE > 0
    ? ENV_REAL_BALANCE
    : 5_000;

// MT5 env vars: when set they drive the default login id + server name shown
// to the user on a MetaTrader login. Same NEXT_PUBLIC_ story as above.
const ENV_MT5_LOGIN =
  process.env.NEXT_PUBLIC_MT5_LOGIN ?? process.env.MT5_LOGIN;
const ENV_MT5_SERVER =
  process.env.NEXT_PUBLIC_MT5_SERVER ?? process.env.MT5_SERVER;

const MOCK_MT5_NAME = "MT5 Trader";
const MOCK_MT5_EMAIL = "trader@metatrader.com";

const DEFAULT_STATE = {
  isAuthenticated: false,
  provider: null as AuthProvider,
  accountType: null as AccountType,
  accountInfo: null as AccountInfo | null,
  accessToken: null as string | null,
  // Default to REAL account — demo is opt-in for training only.
  pendingAccountType: "real" as PendingAccountType | null,
  _hasHydrated: false,
};

// ---- Lazy imports (kept out of the module body so they don't run on SSR) ----

async function fetchDerivBalanceLazy(
  accessToken: string,
): Promise<{ balance: number; currency: string; loginid: string } | null> {
  try {
    const mod = await import("@/lib/derivApi");
    return await mod.fetchDerivBalance(accessToken);
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

// ---- Store ------------------------------------------------------------------

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,

      setPendingAccountType: (t) => set({ pendingAccountType: t }),

      _setHydrated: () => set({ _hasHydrated: true }),

      loginWithDeriv: (token, accounts) => {
        const picked = accounts[0];
        if (!picked) return;
        // Default to the pending hint (already chosen on login screen) and fall
        // back to inferring from the loginid prefix.
        const inferred: "real" | "demo" = picked.loginid.startsWith("VR")
          ? "demo"
          : picked.loginid.startsWith("CR")
            ? "real"
            : "real";
        const pending = useAuthStore.getState().pendingAccountType;
        const accountType: "real" | "demo" =
          picked.accountType ?? pending ?? inferred;
        set({
          isAuthenticated: true,
          provider: "deriv",
          accessToken: token,
          accountInfo: picked,
          accountType,
        });
      },

      loginWithMetaTrader: (loginid, accountType) => {
        const isDemo = accountType === "demo";
        // Prefer the login number from the MT5 env var when the caller did not
        // provide one. Prefix MT5 logins so they are visually distinguishable.
        const envLogin = ENV_MT5_LOGIN ? `MT5-${ENV_MT5_LOGIN}` : null;
        const resolvedLoginid = loginid?.trim()
          ? loginid
          : (envLogin ?? "MT5-account");
        // When a server env var is set, fold it into the email/name so the user
        // sees their real brokerage server on the account badge.
        const serverSuffix = ENV_MT5_SERVER ? ` (${ENV_MT5_SERVER})` : "";
        set({
          isAuthenticated: true,
          provider: "metatrader",
          accessToken: null,
          accountType,
          accountInfo: {
            loginid: resolvedLoginid,
            currency: "USD",
            balance: isDemo ? DEMO_BALANCE : REAL_BALANCE,
            email: MOCK_MT5_EMAIL,
            name: `${MOCK_MT5_NAME}${serverSuffix}`,
          },
        });
      },

      setAccountType: (t) => {
        const info = get().accountInfo;
        // Adjust balance to match the chosen mode when we still hold defaults.
        if (info) {
          set({
            accountType: t,
            accountInfo: {
              ...info,
              balance: t === "demo" ? DEMO_BALANCE : REAL_BALANCE,
            },
          });
        } else {
          set({ accountType: t });
        }
        // After switching, re-fetch the real balance so the sidebar reflects
        // the new account state. The refresh is a no-op for demo accounts.
        void get().refreshBalance();
      },

      updateAccountInfo: (patch) => {
        const info = get().accountInfo;
        if (!info) return;
        // Guard against NaN / undefined sneaking into the balance field and
        // propagating to rendering. If the upstream returned a non-finite
        // balance, we keep the previous balance.
        const next: AccountInfo = { ...info, ...patch };
        if (
          patch.balance !== undefined &&
          !Number.isFinite(patch.balance)
        ) {
          next.balance = info.balance;
        }
        // Skip the state update if nothing actually changed. This prevents
        // unnecessary re-renders and breaks potential infinite loops where a
        // useEffect calls refreshBalance which calls updateAccountInfo.
        if (
          next.balance === info.balance &&
          next.currency === info.currency &&
          next.loginid === info.loginid &&
          next.email === info.email &&
          next.name === info.name
        ) {
          return;
        }
        set({ accountInfo: next });
      },

      refreshBalance: async () => {
        const state = get();
        if (!state.isAuthenticated || !state.accountInfo) return;
        // Demo accounts use a fixed $10,000 virtual balance. Nothing to fetch.
        if (state.accountType === "demo") return;

        if (state.provider === "deriv" && state.accessToken) {
          const result = await fetchDerivBalanceLazy(state.accessToken);
          if (result) {
            get().updateAccountInfo({
              balance: result.balance,
              currency: result.currency,
              loginid: result.loginid,
            });
          }
          return;
        }

        if (state.provider === "metatrader") {
          const result = await fetchMT5BalanceLazy();
          if (result) {
            get().updateAccountInfo({
              balance: result.balance,
              currency: result.currency,
            });
          }
          return;
        }
      },

      logout: () => {
        set({ ...DEFAULT_STATE });
        // Best-effort: clear the persisted blob in case the reducer ran before
        // persist rehydrated.
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
      // The shell calls `useAuthStore.persist.rehydrate()` in a useEffect.
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        state?._setHydrated?.();
      },
      // Only persist the data fields, not the action functions.
      partialize: ({
        isAuthenticated,
        provider,
        accountType,
        accountInfo,
        accessToken,
        pendingAccountType,
      }: AuthState) => ({
        isAuthenticated,
        provider,
        accountType,
        accountInfo,
        accessToken,
        pendingAccountType,
      }),
    },
  ),
);
