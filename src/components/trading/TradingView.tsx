"use client";

import { useCallback, useState } from "react";
import { Header } from "@/components/trading/Header";
import { StatsStrip } from "@/components/trading/StatsStrip";
import { CandlestickChart } from "@/components/trading/CandlestickChart";
import { OrderBook } from "@/components/trading/OrderBook";
import { TradePanel } from "@/components/trading/TradePanel";
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
export function TradingView({ market }: { market: MarketState }) {

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
        <StatsStrip
          stats={market.stats}
          candles={market.candles}
          symbol={market.activeSymbol}
          direction={market.lastPriceDirection}
        />

        <div className="mt-2 grid grid-cols-1 gap-2 sm:mt-3 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-[420px]">
            <CandlestickChart
              candles={market.candles}
              symbol={market.activeSymbol}
              timeframe={market.timeframe}
              chartType={chartType}
              indicators={indicators}
              onTimeframeChange={market.setTimeframe}
              onChartTypeChange={setChartType}
              onToggleIndicator={toggleIndicator}
            />
          </div>

          <div className="flex flex-col gap-2 sm:gap-3">
            <OrderBook
              orderBook={market.orderBook}
              symbol={market.activeSymbol}
              lastPrice={market.livePrice}
            />
            <TradePanel
              symbol={market.activeSymbol}
              livePrice={market.livePrice}
            />
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
          <span className="font-medium tracking-wider text-foreground/70">
            Z TERMINAL
          </span>
          <span>
            All market data is simulated for demonstration. No real orders are
            executed.
          </span>
          <span className="font-mono tabular-nums">v1.0.0 / build 2024</span>
        </div>
      </footer>
    </div>
  );
}
