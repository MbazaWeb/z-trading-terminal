"use client";

import { TickerTape } from "@/components/trading/TickerTape";
import { TerminalStatus } from "@/components/views/TerminalStatus";
import { useEffect, useState } from "react";
import { PerformancePanel } from "@/components/views/PerformancePanel";
import { BotDashboard } from "@/components/views/BotDashboard";
import { AgentDashboard } from "@/components/views/AgentDashboard";
import { StrategyDashboard } from "@/components/views/StrategyDashboard";
import { Mt5Dashboard } from "@/components/views/Mt5Dashboard";
import { useMarketData } from "@/components/trading/useMarketData";
import { TradingView } from "@/components/trading/TradingView";
import { Sidebar, type ViewId } from "@/components/views/Sidebar";
import { LoginView } from "@/components/views/LoginView";
import { AccountTypeSelect } from "@/components/views/AccountTypeSelect";
import { useAuthStore } from "@/lib/authStore";
import { useDerivCallback } from "@/lib/useDerivCallback";

export default function Page() {
  // The shell owns the shared market-data instance so the top TickerTape and
  // the Trading view stay perfectly in sync (same symbol, same live price).
  const [view, setView] = useState<ViewId>("trading");
  const [showLogin, setShowLogin] = useState(false);

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
  useEffect(()=>{if(isAuthenticated)setShowLogin(false);},[isAuthenticated]);
  const accountType = useAuthStore((s) => s.accountType);
  const provider = useAuthStore((s) => s.provider);
  const market = useMarketData("", hasHydrated && (!isAuthenticated || provider === "metatrader"));

  // Handle the Deriv OAuth redirect (parses the URL hash on mount).
  useDerivCallback();

  // --- Render shell ----------------------------------------------------------
  // TickerTape is always visible (above login / overlay / app) for polish.
  // During SSR we render only the ticker so the auth gate (which depends on
  // client-only localStorage) never leaks a one-frame flash of the app.
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TickerTape symbols={market.symbols} activeSymbolId={market.activeSymbol.id} livePrice={market.livePrice} activeChangePercent={market.stats.changePercent} onSelectSymbol={market.selectSymbol}/>


      {!hasHydrated ? (
        // Reserve the layout during the very first client paint so the page
        // does not jump when the auth gate resolves.
        <div className="flex-1" />
      ) : !isAuthenticated && showLogin ? (
        <><button className="self-start m-4 rounded border px-4 py-2" onClick={()=>setShowLogin(false)}>Back to markets</button><LoginView /></>
      ) : isAuthenticated && !accountType ? (
        <AccountTypeSelect />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col md:flex-row">
          <Sidebar active={isAuthenticated ? view : "trading"} onSelect={id=>{if(!isAuthenticated && id!=="trading"){setShowLogin(true);return;}setView(id);}} />
          <main className="min-w-0 flex-1">{isAuthenticated ? <TerminalStatus provider={provider} marketStatus={market.status} onBot={()=>setView("bot")}/> : <header className="flex items-center justify-between gap-3 border-b p-4"><div><h1 className="text-lg font-semibold">Market overview</h1><p className="text-xs text-muted-foreground">Guest access · Read-only</p></div><button className="rounded bg-emerald-600 px-4 py-2 font-semibold text-white" onClick={()=>setShowLogin(true)}>Sign in</button></header>}
            {/* Keyed wrapper so each view switch replays the fade transition. */}
            <div key={view} className="animate-view-enter">
              {(!isAuthenticated || view === "trading") && <TradingView market={market} canTrade={isAuthenticated && provider==="metatrader" && accountType==="demo"} onSignIn={()=>setShowLogin(true)} />}
              {isAuthenticated && view === "dashboard" && (provider === "metatrader" ? <Mt5Dashboard /> : <div className="p-6">Deriv dashboard pending.</div>)}
              {isAuthenticated && view === "strategies" && (provider === "metatrader" ? <StrategyDashboard symbols={market.symbols} /> : <div className="p-6">MT5 demo connection required.</div>)}
              {isAuthenticated && view === "agents" && (provider === "metatrader" ? <AgentDashboard symbols={market.symbols} /> : <div className="p-6">MT5 demo required.</div>)}
              {isAuthenticated && view === "bot" && (provider === "metatrader" ? <BotDashboard symbols={market.symbols}/> : <div className="p-6">MT5 demo required.</div>)}
              {isAuthenticated && view === "reports" && (provider === "metatrader" ? <div className="p-4"><PerformancePanel/></div> : <div className="p-6">MT5 demo required.</div>)}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
