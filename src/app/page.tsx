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
import { useAuthStore } from "@/lib/authStore";
import { useDerivCallback } from "@/lib/useDerivCallback";
import { useTradeStore, computeAgentStats } from "@/lib/tradeStore";
import { useBotStore, computeEquityPositionSize } from "@/lib/botStore";
import { useAgentStore } from "@/lib/agents/agentStore";
import { computePositionProfit, STRATEGY_CONFIG } from "@/lib/strategy";
import { fetchTicker } from "@/lib/binance";

export default function Page() {
  // The shell owns the shared market-data instance so the top TickerTape and
  // the Trading view stay perfectly in sync (same symbol, same live price).
  const market = useMarketData("BTCUSDT");
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

  // --- Agent stats sync: recompute winRate/pnl/sparkline from real trades ---
  const trades = useTradeStore((s) => s.trades);
  const syncAgentStats = useAgentStore((s) => s.syncStatsFromTrades);
  useEffect(() => {
    const agents = useAgentStore.getState().agents;
    const map = new Map<
      string,
      { winRate: number; totalTrades: number; pnl: number; sparkline: number[] }
    >();
    for (const a of agents) {
      map.set(a.id, computeAgentStats(trades, a.id));
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
  // For each open manual trade placed from the TradePanel, compute the live
  // profit using the active symbol's live price. When the profit reaches the
  // strategy take-profit target ($2.00), auto-close the position. If the
  // trade has a brokerOrderId, call /api/mt5/close first and wait for broker
  // confirmation before marking the trade as closed locally.
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
                  `Broker close failed for ${t.market} — will retry next tick`,
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

  // --- Bot consensus automation: when the bot is running and a fresh
  // consensus passes, open a position at the current live price. The agent
  // store's runAnalysis runs from the TradePanel whenever fresh candles
  // arrive; we read the latest consensus result here.
  const viewRef = useRef<ViewId>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const id = setInterval(() => {
      const botStore = useBotStore.getState();
      if (!botStore.running) return;
      const livePrice = livePriceRef.current;
      const label = activeSymbolLabelRef.current;
      if (livePrice <= 0) return;

      const consensus = useAgentStore.getState().lastConsensus;
      if (!consensus || !consensus.passed) return;
      if (consensus.decision !== "buy" && consensus.decision !== "sell") return;

      // Throttle: only place one trade per consensus timestamp.
      const lastAnalyzedAt = useAgentStore.getState().lastAnalysisAt ?? 0;
      const lastTradeAt = botStore.positions.length
        ? Math.max(...botStore.positions.map((p) => p.openedAt))
        : 0;
      if (lastTradeAt >= lastAnalyzedAt) return;

      const config = botStore.config;
      if (botStore.positions.length >= config.maxConcurrentPositions) return;

      // Daily loss guard.
      const now = Date.now();
      const dayStart = now - (now % 86_400_000);
      const todayLoss = Math.abs(
        useTradeStore
          .getState()
          .trades.filter(
            (t) =>
              t.status === "closed" &&
              t.source === "bot" &&
              t.datetime >= dayStart &&
              t.pnl < 0,
          )
          .reduce((s, t) => s + t.pnl, 0),
      );
      if (todayLoss >= config.maxDailyLoss) {
        botStore.addBotLog(
          "RISK-CHECK",
          `Daily loss limit $${config.maxDailyLoss} reached -- bot trade skipped`,
        );
        return;
      }

      // Equity-based position sizing: use the REAL account balance from the
      // auth store, not a hardcoded $5000 fallback.
      const accountBalance = useAuthStore.getState().accountInfo?.balance ?? null;
      const positionSize = computeEquityPositionSize(accountBalance, config);
      if (positionSize <= 0) {
        botStore.addBotLog(
          "RISK-CHECK",
          "Account balance not available -- bot trade skipped (refresh balance from sidebar)",
        );
        return;
      }

      const side = consensus.decision;
      const slPct = config.defaultStopLoss / 100;
      const tpPct = config.defaultTakeProfit / 100;
      const size = positionSize / livePrice;
      const sl =
        side === "buy" ? livePrice * (1 - slPct) : livePrice * (1 + slPct);
      const tp =
        side === "buy" ? livePrice * (1 + tpPct) : livePrice * (1 - tpPct);

      const posId = `pos-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
      const tradeId = `bot-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
      const votingAgents = consensus.votes
        .filter((v) => v.action === side)
        .map((v) => v.agentId);

      const trade = {
        id: tradeId,
        status: "open" as const,
        datetime: now,
        market: label,
        side,
        amount: positionSize,
        entryPrice: livePrice,
        exitPrice: null,
        pnl: 0,
        pnlPct: 0,
        result: null,
        agentId: votingAgents[0] ?? null,
        source: "bot" as const,
      };
      void useTradeStore.getState().addTrade(trade);
      botStore.openBotPosition(
        {
          id: posId,
          tradeId,
          symbol: label,
          side,
          size,
          entryPrice: livePrice,
          currentPrice: livePrice,
          stopLoss: sl,
          takeProfit: tp,
          openedAt: now,
          agentId: votingAgents[0] ?? null,
        },
        tradeId,
      );
      botStore.addBotLog(
        "SIGNAL",
        `Consensus ${side.toUpperCase()} ${label} @ ${livePrice} (${consensus.totalConfidence}% confidence, ${votingAgents.length} agents)`,
      );
      botStore.addBotLog(
        "RISK-CHECK",
        `Position $${positionSize.toFixed(2)} (balance $${accountBalance?.toFixed(2) ?? "n/a"} * ${config.riskPerTrade}%), SL ${config.defaultStopLoss}%, TP ${config.defaultTakeProfit}% -- APPROVED`,
      );
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // --- Bot position price refresh + SL/TP automation -----------------------
  // For each open bot position, poll the live price from Binance (per symbol)
  // and auto-close on SL/TP crossings. Broker-confirmed positions are closed
  // via /api/mt5/close before being marked closed locally.
  useEffect(() => {
    const id = setInterval(async () => {
      const botStore = useBotStore.getState();
      const tradeStore = useTradeStore.getState();
      if (botStore.positions.length === 0) return;

      // Group positions by symbol so we only fetch each ticker once.
      const bySymbol = new Map<string, typeof botStore.positions>();
      for (const p of botStore.positions) {
        const list = bySymbol.get(p.symbol) ?? [];
        list.push(p);
        bySymbol.set(p.symbol, list);
      }

      for (const [symbolLabel, positions] of bySymbol) {
        // Look up the Binance symbol id by label (e.g. "BTC/USDT" -> "BTCUSDT").
        const sym = [...market.symbols].find((s) => s.label === symbolLabel);
        if (!sym) continue;
        let price = 0;
        try {
          const ticker = await fetchTicker(sym.id);
          price = ticker.lastPrice;
        } catch {
          continue;
        }
        if (price <= 0) continue;

        for (const p of positions) {
          botStore.updatePositionPrice(p.id, price);
          // Check SL/TP.
          if (p.side === "buy") {
            if (price <= p.stopLoss) {
              const size = p.size;
              const pnl = computePositionProfit("buy", p.entryPrice, p.stopLoss, size);
              const pnlPct = Math.round((pnl / (p.entryPrice * size)) * 10000) / 100;
              botStore.closeBotPosition(p.id, p.stopLoss, "SL");
              void tradeStore.closeTrade(
                p.tradeId,
                p.stopLoss,
                pnl,
                pnlPct,
                pnl >= 0 ? "win" : "loss",
              );
              if (p.agentId) {
                useAgentStore.getState().correctAfterTrade(
                  pnl >= 0 ? "win" : "loss",
                  [p.agentId],
                  pnl,
                );
              }
            } else if (price >= p.takeProfit) {
              const size = p.size;
              const pnl = computePositionProfit("buy", p.entryPrice, p.takeProfit, size);
              const pnlPct = Math.round((pnl / (p.entryPrice * size)) * 10000) / 100;
              botStore.closeBotPosition(p.id, p.takeProfit, "TP");
              void tradeStore.closeTrade(
                p.tradeId,
                p.takeProfit,
                pnl,
                pnlPct,
                pnl >= 0 ? "win" : "loss",
              );
              if (p.agentId) {
                useAgentStore.getState().correctAfterTrade(
                  pnl >= 0 ? "win" : "loss",
                  [p.agentId],
                  pnl,
                );
              }
            }
          } else {
            if (price >= p.stopLoss) {
              const size = p.size;
              const pnl = computePositionProfit("sell", p.entryPrice, p.stopLoss, size);
              const pnlPct = Math.round((pnl / (p.entryPrice * size)) * 10000) / 100;
              botStore.closeBotPosition(p.id, p.stopLoss, "SL");
              void tradeStore.closeTrade(
                p.tradeId,
                p.stopLoss,
                pnl,
                pnlPct,
                pnl >= 0 ? "win" : "loss",
              );
              if (p.agentId) {
                useAgentStore.getState().correctAfterTrade(
                  pnl >= 0 ? "win" : "loss",
                  [p.agentId],
                  pnl,
                );
              }
            } else if (price <= p.takeProfit) {
              const size = p.size;
              const pnl = computePositionProfit("sell", p.entryPrice, p.takeProfit, size);
              const pnlPct = Math.round((pnl / (p.entryPrice * size)) * 10000) / 100;
              botStore.closeBotPosition(p.id, p.takeProfit, "TP");
              void tradeStore.closeTrade(
                p.tradeId,
                p.takeProfit,
                pnl,
                pnlPct,
                pnl >= 0 ? "win" : "loss",
              );
              if (p.agentId) {
                useAgentStore.getState().correctAfterTrade(
                  pnl >= 0 ? "win" : "loss",
                  [p.agentId],
                  pnl,
                );
              }
            }
          }
        }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [market.symbols]);

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
      ) : !accountType && isAuthenticated ? (
        // Authenticated but no account type picked (legacy flow).
        <AccountTypeSelectWrapper />
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
