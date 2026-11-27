"use client";

import { useCallback, useState } from "react";
import { Header } from "@/components/trading/Header";
import { StatsStrip } from "@/components/trading/StatsStrip";
import { CandlestickChart } from "@/components/trading/CandlestickChart";
import { OrderBook } from "@/components/trading/OrderBook";
import { Mt5OrderPanel } from "@/components/trading/Mt5OrderPanel";
import { BottomPanel } from "@/components/trading/BottomPanel";
import type { MarketState } from "@/components/trading/useMarketData";
import type { ChartType, IndicatorState } from "@/components/trading/types";

/**
 * The original Bloomberg-style trading terminal. This was the entire `page.tsx`
 * before the multi-view shell was added; preserved here verbatim so the Trading
 * nav item renders exactly the same UI as before. The shell owns the shared
 * `useMarketData` instance (so the top TickerTape and this view stay in sync)
 * and passes it in via the `market` prop.
 */
export function TradingView({ market, canTrade, onSignIn }: { market: MarketState; canTrade: boolean; onSignIn: ()=>void }) {

  const [chartType, setChartType] = useState<ChartType>("candles");
  const [indicators, setIndicators] = useState<IndicatorState>({
    sma7: false,
    sma25: true,
    sma99: false,
  });

  const toggleIndicator = useCallback((key: keyof IndicatorState) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="flex min-w-0 flex-col">
      <Header
        symbols={market.symbols}
        activeSymbol={market.activeSymbol}
        livePrice={market.livePrice}
        onSelectSymbol={market.selectSymbol}
      />

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-2 py-2 sm:px-3 sm:py-3">
        <StatsStrip
          stats={market.stats}
          candles={market.candles}
          symbol={market.activeSymbol}
          direction={market.lastPriceDirection}
          quote={market.quote}
        />

        <div className="mt-2 grid grid-cols-1 gap-2 sm:mt-3 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-[420px] min-w-0">
            {market.candles.length ? <CandlestickChart
              candles={market.candles}
              symbol={market.activeSymbol}
              timeframe={market.timeframe}
              chartType={chartType}
              indicators={indicators}
              onTimeframeChange={market.setTimeframe}
              onChartTypeChange={setChartType}
              onToggleIndicator={toggleIndicator}
            /> : <div className="flex min-h-[420px] flex-col rounded-md border border-[var(--panel-border)] bg-[#0d1117] p-3"><div className="flex flex-wrap gap-2">{(["1m","5m","15m","1H","4H","1D","1W"] as const).map(tf=><button key={tf} onClick={()=>market.setTimeframe(tf)} className={`rounded px-2 py-1 text-xs ${market.timeframe===tf?"bg-[var(--bull)] text-black":"text-muted-foreground"}`}>{tf}</button>)}</div><div className="mt-3 flex gap-2">{(["candles","line","area"] as const).map(c=><button key={c} onClick={()=>setChartType(c)} className="rounded border px-2 py-1 text-xs capitalize">{c}</button>)}</div><div className="m-auto text-sm text-muted-foreground">Market data unavailable</div></div>}
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:gap-3">
            <OrderBook
              orderBook={market.orderBook}
              symbol={market.activeSymbol}
              lastPrice={market.livePrice}
            />
            {canTrade ? <Mt5OrderPanel key={market.activeSymbol.id} symbol={market.activeSymbol.id} ready={market.status==="ready"}/> : <section className="rounded-md border border-[var(--panel-border)] bg-[#0d1117] p-3"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wide">Trade</h2><div className="grid grid-cols-2 gap-2"><button onClick={onSignIn} className="rounded-lg bg-[var(--bull)] py-3 font-bold text-[#0a0e17]">BUY</button><button onClick={onSignIn} className="rounded-lg bg-[var(--bear)] py-3 font-bold text-white">SELL</button></div><p className="mt-3 text-center text-xs text-muted-foreground">Sign in to trade on a verified demo account.</p></section>}
          </div>
        </div>

        <div className="mt-2 sm:mt-3">
          <BottomPanel
            trades={market.trades}
            symbols={market.symbols}
            activeSymbolId={market.activeSymbol.id}
            livePrice={market.livePrice}
            onSelectSymbol={market.selectSymbol}
          />
        </div>
      </main>

      <footer className="mt-auto border-t border-[var(--panel-border)] bg-[#070a11] px-4 py-3">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-1 text-[11px] text-muted-foreground sm:flex-row">
          <span className="font-medium tracking-wide text-foreground/70">
            Z TERMINAL
          </span>
          <span>
            MT5 broker feed · Demo execution only.
          </span>
          <span className="font-mono tabular-nums">v1.0.0</span>
        </div>
      </footer>
    </div>
  );
}
