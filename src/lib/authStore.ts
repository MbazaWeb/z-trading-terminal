"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ---- Types ------------------------------------------------------------------

export interface AccountInfo {
  /** "CR123456" (Deriv real), "VR123456" (Deriv demo), "MT5-12345" (MetaTrader) */
  loginid: string;
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
  logout: () => void;
  /** Internal: flipped true by the persist middleware after rehydration. */
  _setHydrated: () => void;
}

// Default balances (used when the provider does not supply one).
const DEMO_BALANCE = 10_000;
const REAL_BALANCE = 5_000;

const MOCK_MT5_NAME = "MT5 Trader";
const MOCK_MT5_EMAIL = "trader@metatrader.com";

const DEFAULT_STATE = {
  isAuthenticated: false,
  provider: null as AuthProvider,
  accountType: null as AccountType,
  accountInfo: null as AccountInfo | null,
  accessToken: null as string | null,
  pendingAccountType: "demo" as PendingAccountType | null,
  _hasHydrated: false,
};

// ---- Store ------------------------------------------------------------------

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
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
        const accountType: "real" | "demo" = pending ?? inferred;
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
        set({
          isAuthenticated: true,
          provider: "metatrader",
          accessToken: null,
          accountType,
          accountInfo: {
            loginid,
            currency: "USD",
            balance: isDemo ? DEMO_BALANCE : REAL_BALANCE,
            email: MOCK_MT5_EMAIL,
            name: MOCK_MT5_NAME,
          },
        });
      },

      setAccountType: (t) => {
        const info = useAuthStore.getState().accountInfo;
        // Adjust balance to match the chosen mode when we still hold defaults.
        if (info) {
          set({
            accountType: t,
            accountInfo: { ...info, balance: t === "demo" ? DEMO_BALANCE : REAL_BALANCE },
          });
        } else {
          set({ accountType: t });
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
