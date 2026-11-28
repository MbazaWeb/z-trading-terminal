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
import { useAuthStore } from "@/lib/authStore";
import { useDerivCallback } from "@/lib/useDerivCallback";
import { useTradeStore, computeAgentStats } from "@/lib/tradeStore";
import { useBotStore } from "@/lib/botStore";
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
  useEffect(() => {
    if (hasHydrated) return;
    useAuthStore.persist.rehydrate();
  }, [hasHydrated]);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accountType = useAuthStore((s) => s.accountType);
  const provider = useAuthStore((s) => s.provider);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshBalance = useAuthStore((s) => s.refreshBalance);

  // Handle the Deriv OAuth redirect (parses the URL hash on mount).
  useDerivCallback();

  // --- Real balance fetch after login ---------------------------------------
  // After the user logs in (or switches account type), pull the real balance
  // from the appropriate upstream:
  //   - Deriv  -> WebSocket API using the stored OAuth access token
  //   - MT5    -> server-side /api/mt5/balance endpoint (MetaApi.cloud)
  //   - Demo   -> no-op ($10,000 fixed balance)
  // The refresh happens on mount and whenever the auth state changes. We
  // also poll every 30s while authenticated so the sidebar stays current
  // without requiring a manual refresh.
  useEffect(() => {
    if (!isAuthenticated || !accountType) return;
    // Initial fetch on auth change.
    void refreshBalance();
    // Periodic refresh — 30s cadence keeps the balance live without
    // hammering the upstream APIs.
    const id = setInterval(() => {
      void refreshBalance();
    }, 30_000);
    return () => clearInterval(id);
    // refreshBalance is a stable Zustand action — excluded from deps to
    // prevent potential re-render loops.
  }, [isAuthenticated, accountType, provider, accessToken]);

  // --- Trade store: load history on auth ------------------------------------
  const fetchTrades = useTradeStore((s) => s.fetchTrades);
  useEffect(() => {
    if (isAuthenticated && accountType) {
      fetchTrades();
    }
  }, [isAuthenticated, accountType, fetchTrades]);

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
  // strategy take-profit target ($2.00), auto-close the position and log the
  // take-profit event to the bot activity feed.
  const activeSymbolLabelRef = useRef<string>(market.activeSymbol.label);
  const livePriceRef = useRef<number>(market.livePrice);
  useEffect(() => {
    activeSymbolLabelRef.current = market.activeSymbol.label;
  }, [market.activeSymbol.label]);
  useEffect(() => {
    livePriceRef.current = market.livePrice;
  }, [market.livePrice]);

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
          void store.closeTrade(t.id, livePrice, profit, pnlPct, "win");
          botStore.addBotLog(
            "TAKE-PROFIT",
            `TAKE-PROFIT: Closed ${t.market} position, profit $${profit.toFixed(2)}`,
          );
          // Self-correction: every agent that voted (manual trade has no
          // voting agents, but the consensus may have flagged a buy/sell). We
          // only correct on consensus-driven trades, which are tagged with an
          // agentId. Skip for pure manual trades.
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

      const side = consensus.decision;
      const positionSize = Math.min(
        config.maxPositionSize,
        Math.max(50, Math.round((5000 * config.riskPerTrade) / 100)),
      );
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
        `Position $${positionSize}, SL ${config.defaultStopLoss}%, TP ${config.defaultTakeProfit}% -- APPROVED`,
      );
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // --- Bot position price refresh + SL/TP automation -----------------------
  // For each open bot position, poll the live price from Binance (per symbol)
  // and auto-close on SL/TP crossings.
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
              // Self-correction on the agents that voted for this position.
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
      ) : !isAuthenticated ? (
        <LoginView />
      ) : !accountType ? (
        <AccountTypeSelect />
      ) : (
        <div className="flex flex-1">
          <Sidebar active={view} onSelect={setView} />
          <main className="min-w-0 flex-1">
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
