"use client";

import { useCallback, useState } from "react";
import { Mt5OrderPanel } from "@/components/trading/Mt5OrderPanel";
import { StatsStrip } from "@/components/trading/StatsStrip";
import { OrderBook } from "@/components/trading/OrderBook";
import { BottomPanel } from "@/components/trading/BottomPanel";
import { Header } from "@/components/trading/Header";
import { CandlestickChart } from "@/components/trading/CandlestickChart";
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
    <div className="flex flex-col">
      <Header
        symbols={market.symbols}
        activeSymbol={market.activeSymbol}
        livePrice={market.livePrice}
        onSelectSymbol={market.selectSymbol}
      />

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-2 py-2 sm:px-3 sm:py-3">
        {market.status!=="ready"&&<p role="alert" className="rounded border border-amber-500/40 p-3 text-sm text-amber-500">Market feed is stale or unavailable. New orders are disabled.</p>}
        <StatsStrip stats={market.stats} candles={market.candles} symbol={market.activeSymbol} direction={market.lastPriceDirection} quote={market.quote}/>
        <div className="p-3 text-sm">MT5 • {market.status} {market.quote && <> | Bid: {market.quote.bid} | Ask: {market.quote.ask} | Spread: {market.quote.ask-market.quote.bid} | Quote: {new Date(market.quote.time).toISOString()}</>}</div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:mt-3 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-[420px]">
            {market.candles.length ? <CandlestickChart
              candles={market.candles}
              symbol={market.activeSymbol}
              timeframe={market.timeframe}
              chartType={chartType}
              indicators={indicators}
              onTimeframeChange={market.setTimeframe}
              onChartTypeChange={setChartType}
              onToggleIndicator={toggleIndicator}
            /> : <section className="flex h-full min-h-[420px] flex-col rounded-xl border border-[var(--panel-border)] bg-[#0d1117]"><div className="flex gap-2 border-b p-3">{(["1m","5m","15m","1H","4H","1D","1W"] as const).map(tf=><button key={tf} className="rounded px-2 py-1 text-xs" onClick={()=>market.setTimeframe(tf)}>{tf}</button>)}</div><div className="m-auto text-sm text-muted-foreground">Market data unavailable</div></section>}
          </div>

          <div className="flex flex-col gap-2 sm:gap-3">
            <OrderBook orderBook={market.orderBook} symbol={market.activeSymbol} lastPrice={market.quote?market.livePrice:NaN}/>
            {canTrade ? <Mt5OrderPanel key={market.activeSymbol.id} symbol={market.activeSymbol.id} ready={market.status==="ready"} /> : <div className="rounded-lg border p-5"><h2 className="font-semibold">Trading locked</h2><p className="my-3 text-sm text-muted-foreground">Sign in with a verified demo account to place orders.</p><button className="rounded bg-emerald-600 px-4 py-2 text-white" onClick={onSignIn}>Sign in</button></div>}
          </div>
        </div>

        <div className="mt-2 sm:mt-3"><BottomPanel trades={market.trades} symbols={market.symbols} activeSymbolId={market.activeSymbol.id} livePrice={market.livePrice} onSelectSymbol={market.selectSymbol}/></div>
        <div className="p-3 text-xs">Chart volume is broker tick count, not traded quantity.</div>
      </main>

      <footer className="mt-auto border-t border-[var(--panel-border)] bg-[#070a11] px-4 py-3">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-1 text-[11px] text-muted-foreground sm:flex-row">
          <span className="font-medium tracking-wider text-foreground/70">
            Z TERMINAL
          </span>
          <span>
            MT5 broker feed. Demo execution requires explicit server configuration.
          </span>
          <span className="font-mono tabular-nums">v1.0.0</span>
        </div>
      </footer>
    </div>
  );
}
