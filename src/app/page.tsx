"use client";

import { useEffect, useRef, useState } from "react";
import { TickerTape } from "@/components/trading/TickerTape";
import { useMarketData } from "@/components/trading/useMarketData";
import { TradingView } from "@/components/trading/TradingView";
import { Sidebar, type ViewId } from "@/components/views/Sidebar";
import { DashboardView } from "@/components/views/DashboardView";
import { AgentsView } from "@/components/views/AgentsView";
import { BotView } from "@/components/views/BotView";
import { ReportsView } from "@/components/views/ReportsView";
import { LoginView } from "@/components/views/LoginView";
import { BrokerAccountsView } from "@/components/views/BrokerAccountsView";
import { useAuthStore } from "@/lib/authStore";
import { useDerivCallback } from "@/lib/useDerivCallback";
import { useTradeStore, computeAgentStats } from "@/lib/tradeStore";
import { useBotStore } from "@/lib/botStore";
import { useAgentStore } from "@/lib/agents/agentStore";
import { calculatePerformance } from "@/lib/agents/performance";
import type { AgentPerformance } from "@/lib/agents/types";
import { computePositionProfit, STRATEGY_CONFIG } from "@/lib/strategy";

export default function Page() {
  // The shell owns the shared market-data instance so the top TickerTape and
  // the Trading view stay perfectly in sync (same symbol, same live price).
  const market = useMarketData("PAXGUSDT");
  const [view, setView] = useState<ViewId>("trading");

  // --- Auth gate -------------------------------------------------------------
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const syncFromServerSession = useAuthStore((s) => s.syncFromServerSession);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accountType = useAuthStore((s) => s.accountType);
  const provider = useAuthStore((s) => s.provider);
  const tradingMode = useAuthStore((s) => s.tradingMode);
  const refreshBalance = useAuthStore((s) => s.refreshBalance);

  useEffect(() => {
    if (hasHydrated) return;
    useAuthStore.persist.rehydrate();
  }, [hasHydrated]);

  // Handle the Deriv OAuth redirect (parses the URL on mount).
  useDerivCallback();

  // On hydration, sync from the server-side session. This picks up sessions
  // from prior visits (the HttpOnly cookie is sent automatically) and from
  // the Deriv OAuth callback redirect.
  useEffect(() => {
    if (!hasHydrated) return;
    void syncFromServerSession();
  }, [hasHydrated, syncFromServerSession]);

  // --- Real balance fetch after login ---------------------------------------
  // After the user logs in (or switches account type), pull the real balance
  // from the appropriate upstream:
  //   - Deriv       -> server-side /api/deriv/balance (reads token from session)
  //   - MetaTrader  -> server-side /api/mt5/balance (MetaApi.cloud)
  //   - Demo        -> no-op ($10,000 fixed virtual balance)
  //   - Paper       -> no-op (no broker)
  useEffect(() => {
    if (!isAuthenticated || !accountType) return;
    void refreshBalance();
    const id = setInterval(() => {
      void refreshBalance();
    }, 30_000);
    return () => clearInterval(id);
    // refreshBalance is a stable Zustand action — excluded from deps.
  }, [isAuthenticated, accountType, provider, tradingMode, refreshBalance]);

  // --- Trade store: load history on auth ------------------------------------
  const fetchTrades = useTradeStore((s) => s.fetchTrades);
  const syncPendingTrades = useTradeStore((s) => s.syncPendingTrades);
  useEffect(() => {
    if (isAuthenticated && accountType) {
      void fetchTrades();
    }
  }, [isAuthenticated, accountType, fetchTrades]);

  // Retry persisting trades that failed to save on the previous attempt.
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => {
      void syncPendingTrades();
    }, 15_000);
    return () => clearInterval(id);
  }, [isAuthenticated, syncPendingTrades]);

  // --- Agent stats sync: recompute winRate/pnl/sparkline + performance from real trades ---
  const trades = useTradeStore((s) => s.trades);
  const syncAgentStats = useAgentStore((s) => s.syncStatsFromTrades);
  useEffect(() => {
    const agents = useAgentStore.getState().agents;
    const map = new Map<
      string,
      { winRate: number; totalTrades: number; pnl: number; sparkline: number[]; performance?: AgentPerformance }
    >();
    for (const a of agents) {
      const base = computeAgentStats(trades, a.id);
      const perf = calculatePerformance(trades, a.id);
      map.set(a.id, { ...base, performance: perf });
    }
    syncAgentStats(map);
  }, [trades, syncAgentStats]);

  // --- Clear expired agent "Learning" badges --------------------------------
  useEffect(() => {
    const id = setInterval(() => {
      useAgentStore.getState().clearExpiredLearning();
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // --- Take-profit automation for manual (TradePanel) positions -------------
  // The browser only manages TP automation for trades the user placed
  // manually from the TradePanel (the $2 take-profit target from the Drop
  // Catcher strategy). Bot-driven positions are managed server-side by the
  // cron worker (/api/cron/bot) — no bot intervals run in the browser
  // anymore.
  const activeSymbolLabelRef = useRef<string>(market.activeSymbol.label);
  const livePriceRef = useRef<number>(market.livePrice);
  useEffect(() => {
    activeSymbolLabelRef.current = market.activeSymbol.label;
  }, [market.activeSymbol.label]);
  useEffect(() => {
    livePriceRef.current = market.livePrice;
  }, [market.livePrice]);

  async function closeTradeViaBroker(trade: { id: string; brokerOrderId?: string | null; side: "buy" | "sell"; market: string }): Promise<boolean> {
    if (!trade.brokerOrderId) return true; // paper trade — close locally
    try {
      const res = await fetch("/api/mt5/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId: trade.brokerOrderId }),
        cache: "no-store",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        console.warn("[page] broker close failed:", err.error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn("[page] broker close threw:", err);
      return false;
    }
  }

  useEffect(() => {
    const id = setInterval(() => {
      const store = useTradeStore.getState();
      const botStore = useBotStore.getState();
      const label = activeSymbolLabelRef.current;
      const livePrice = livePriceRef.current;
      if (livePrice <= 0) return;
      const openManual = store.trades.filter(
        (t) =>
          t.status === "open" &&
          t.source === "manual" &&
          t.market === label,
      );
      if (openManual.length === 0) return;
      for (const t of openManual) {
        const size = t.entryPrice > 0 ? t.amount / t.entryPrice : 0;
        const profit = computePositionProfit(
          t.side,
          t.entryPrice,
          livePrice,
          size,
        );
        if (profit >= STRATEGY_CONFIG.takeProfitTarget) {
          const pnlPct = Math.round((profit / t.amount) * 10000) / 100;
          // If the trade has a broker order id, close via the broker first.
          if (t.brokerOrderId) {
            void closeTradeViaBroker(t).then((ok) => {
              if (ok) {
                void store.closeTrade(t.id, livePrice, profit, pnlPct, "win");
                botStore.addBotLog(
                  "TAKE-PROFIT",
                  `TAKE-PROFIT: Closed ${t.market} position (broker), profit $${profit.toFixed(2)}`,
                );
              } else {
                botStore.addBotLog(
                  "INFO",
                  `Broker close failed for ${t.market} -- will retry next tick`,
                );
              }
            });
          } else {
            // Paper trade — close locally.
            void store.closeTrade(t.id, livePrice, profit, pnlPct, "win");
            botStore.addBotLog(
              "TAKE-PROFIT",
              `TAKE-PROFIT: Closed ${t.market} paper position, profit $${profit.toFixed(2)}`,
            );
          }
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // NOTE: Bot automation used to run here as two browser-side intervals
  // (consensus -> open position; price poll -> SL/TP). Both have been
  // removed in favor of the server-side cron worker at /api/cron/bot. The
  // browser now only displays data fetched from the server (positions via
  // /api/mt5/positions, logs via /api/bot/logs, config via /api/bot/config).
  // The agent analysis display stays local so the Trading view can render
  // signals without a round-trip — but no orders are placed from the browser.

  // --- Render shell ----------------------------------------------------------
  // Public dashboard access (FIX 9): when NOT authenticated, show the market
  // dashboard with a "Sign in to trade" banner. The Trading view is
  // accessible without login (view-only — no Buy/Sell panel). Dashboard,
  // Agents, Bot, and Reports require login.
  const isGuest = !isAuthenticated;
  const [showLogin, setShowLogin] = useState(false);

  const handleSignIn = () => {
    // The login view is shown below when isGuest is true AND the user clicked
    // "Sign in to trade". We toggle a state to flip from guest dashboard to
    // the login card.
    setShowLogin(true);
  };

  // Restricted views require authentication. Guests can only see "trading".
  // Derive the effective view instead of calling setState in an effect.
  const effectiveView: ViewId = isGuest ? "trading" : view;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TickerTape
        activeSymbolId={market.activeSymbol.id}
        livePrice={market.livePrice}
        activeChangePercent={market.stats.changePercent}
        onSelectSymbol={market.selectSymbol}
      />

      {!hasHydrated ? (
        <div className="flex-1" />
      ) : isGuest && !showLogin ? (
        // Guest browsing: full Trading view (view-only) + guest sidebar.
        <div className="flex flex-1">
          <Sidebar
            active={effectiveView}
            onSelect={setView}
            guest
            onSignIn={handleSignIn}
          />
          <main className="min-w-0 flex-1">
            <GuestBanner onSignIn={handleSignIn} />
            <div key={effectiveView} className="animate-view-enter">
              <TradingView market={market} viewOnly />
            </div>
          </main>
        </div>
      ) : isGuest && showLogin ? (
        <LoginView
          onBrowseAsGuest={() => {
            setShowLogin(false);
            setView("trading");
          }}
        />
      ) : (
        <div className="flex flex-1">
          <Sidebar active={effectiveView} onSelect={setView} />
          <main className="min-w-0 flex-1">
            <div key={effectiveView} className="animate-view-enter">
              {effectiveView === "trading" && <TradingView market={market} />}
              {effectiveView === "dashboard" && <DashboardView />}
              {effectiveView === "agents" && <AgentsView />}
              {effectiveView === "bot" && <BotView />}
              {effectiveView === "reports" && <ReportsView />}
              {effectiveView === "brokers" && <BrokerAccountsView />}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

// --- Guest banner -----------------------------------------------------------

function GuestBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--bull)]/30 bg-[rgba(22,199,132,0.06)] px-4 py-2 text-[11px]">
      <span className="text-muted-foreground">
        Browsing as guest — market data is live; trading is disabled.
      </span>
      <button
        type="button"
        onClick={onSignIn}
        className="rounded border border-[var(--bull)]/60 bg-[rgba(22,199,132,0.12)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--bull)] transition-colors hover:bg-[rgba(22,199,132,0.2)]"
      >
        Sign in to trade
      </button>
    </div>
  );
}

// --- Account type select wrapper --------------------------------------------

function AccountTypeSelectWrapper() {
  // Lazy import to keep the guest dashboard bundle small.
  const [Comp, setComp] = useState<React.ComponentType | null>(null);
  useEffect(() => {
    void import("@/components/views/AccountTypeSelect").then((m) => {
      setComp(() => m.AccountTypeSelect);
    });
  }, []);
  if (!Comp) return <div className="flex-1" />;
  return <Comp />;
}
