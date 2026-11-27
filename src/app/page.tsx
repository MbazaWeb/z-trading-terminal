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
import { AccountTypeSelect } from "@/components/views/AccountTypeSelect";
import { useStore } from "@/lib/mockData";
import { useAuthStore } from "@/lib/authStore";
import { useDerivCallback } from "@/lib/useDerivCallback";

export default function Page() {
  // The shell owns the shared market-data instance so the top TickerTape and
  // the Trading view stay perfectly in sync (same symbol, same live price).
  const market = useMarketData("BTCUSDT");
  const [view, setView] = useState<ViewId>("trading");

  // --- Auth gate -------------------------------------------------------------
  // The auth store uses `skipHydration: true` so the first client render
  // matches the SSR HTML (default logged-out state). We then call
  // `rehydrate()` in an effect — this synchronously reads localStorage and
  // flips `_hasHydrated` to true, which triggers a single re-render with the
  // persisted session (if any).
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  useEffect(() => {
    if (hasHydrated) return;
    useAuthStore.persist.rehydrate();
  }, [hasHydrated]);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accountType = useAuthStore((s) => s.accountType);

  // Handle the Deriv OAuth redirect (parses the URL hash on mount).
  useDerivCallback();

  // --- Background simulation (runs on every view so shared data stays live) ---
  // Sim clock: advance 1s every second. This drives timestamps on new events,
  // the bot uptime timer, and the activity feed.
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().tickClock();
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Clear expired agent "Learning" badges shortly after their window ends.
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().clearExpiredLearning();
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Agent simulation: every ~5s a random active agent executes a trade; if it
  // was a loss, it immediately self-improves (pulses the Learning badge).
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().simulateAgentTick();
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Bot position price drift + stop-loss / take-profit automation: every 2s,
  // drift current prices and auto-close any position that hit its SL or TP.
  useEffect(() => {
    const id = setInterval(() => {
      const store = useStore.getState();
      if (!store.bot.running) return;
      store.driftBotPositions();
      // Read the freshly-drifted positions and check SL/TP crossings.
      const positions = useStore.getState().bot.positions;
      positions.forEach((p) => {
        if (p.side === "buy") {
          if (p.currentPrice <= p.stopLoss) {
            useStore.getState().closeBotPosition(p.id, p.stopLoss, "SL");
          } else if (p.currentPrice >= p.takeProfit) {
            useStore.getState().closeBotPosition(p.id, p.takeProfit, "TP");
          }
        } else {
          if (p.currentPrice >= p.stopLoss) {
            useStore.getState().closeBotPosition(p.id, p.stopLoss, "SL");
          } else if (p.currentPrice <= p.takeProfit) {
            useStore.getState().closeBotPosition(p.id, p.takeProfit, "TP");
          }
        }
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Bot order cycle: SIGNAL -> RISK-CHECK -> ORDER every 5-8s (randomized).
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      const delay = 5000 + Math.random() * 3000;
      botTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        useStore.getState().simulateBotTick();
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
    };
  }, []);

  // --- Render shell ----------------------------------------------------------
  // TickerTape is always visible (above login / overlay / app) for polish.
  // During SSR we render only the ticker so the auth gate (which depends on
  // client-only localStorage) never leaks a one-frame flash of the app.
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TickerTape
        activeSymbolId={market.activeSymbol.id}
        livePrice={market.livePrice}
        activeChangePercent={market.stats.changePercent}
        onSelectSymbol={market.selectSymbol}
      />

      {!hasHydrated ? (
        // Reserve the layout during the very first client paint so the page
        // does not jump when the auth gate resolves.
        <div className="flex-1" />
      ) : !isAuthenticated ? (
        <LoginView />
      ) : !accountType ? (
        <AccountTypeSelect />
      ) : (
        <div className="flex flex-1">
          <Sidebar active={view} onSelect={setView} />
          <main className="min-w-0 flex-1">
            {/* Keyed wrapper so each view switch replays the fade transition. */}
            <div key={view} className="animate-view-enter">
              {view === "trading" && <TradingView market={market} />}
              {view === "dashboard" && <DashboardView />}
              {view === "agents" && <AgentsView />}
              {view === "bot" && <BotView />}
              {view === "reports" && <ReportsView />}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
