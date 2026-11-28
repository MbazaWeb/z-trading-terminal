"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatPrice, priceDecimals } from "./useMarketData";
import type { OrderBook as OrderBookType, SymbolInfo } from "./types";

interface OrderBookProps {
  orderBook: OrderBookType;
  symbol: SymbolInfo;
  lastPrice: number;
}

export function OrderBook({ orderBook, symbol, lastPrice }: OrderBookProps) {
  const { asks, bids, spread, spreadPercent } = orderBook;
  const decimals = symbol.digits ?? priceDecimals(lastPrice);

  // Cumulative max across both sides for depth-bar normalization.
  const maxTotal = useMemo(() => {
    const askMax = asks.length ? asks[asks.length - 1].total : 0;
    const bidMax = bids.length ? bids[bids.length - 1].total : 0;
    return Math.max(askMax, bidMax, 1);
  }, [asks, bids]);

  // Asks are stored ascending (best ask first). Display reversed so the
  // best ask sits right above the spread row.
  const asksDisplay = useMemo(() => asks.slice().reverse(), [asks]);

  const hasSpread = Number.isFinite(spread);
  const lastUp = hasSpread && lastPrice >= orderBook.midPrice;

  return (
    <section className="flex flex-col rounded-md border border-[var(--panel-border)] bg-[#0d1117] animate-fade-in-up">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">
          Order Book
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {symbol.label}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-left">Price</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Total</span>
      </div>

      {!asks.length && !bids.length && <div className="p-6 text-center text-xs text-muted-foreground">Market depth unavailable</div>}
      {/* Asks */}
      <div className="flex flex-col justify-end">
        {asksDisplay.map((row, i) => {
          const depthPct = (row.total / maxTotal) * 100;
          return (
            <div
              key={`ask-${i}`}
              className="relative grid grid-cols-3 px-3 py-[3px] text-xs transition-colors hover:bg-[#11161f]"
            >
              <div
                className="absolute inset-y-0 right-0 bg-gradient-to-l from-[#ea3943]/20 to-transparent"
                style={{ width: `${depthPct}%` }}
              />
              <span className="relative z-10 text-left font-mono tabular-nums text-[var(--bear)]">
                {formatPrice(row.price, decimals)}
              </span>
              <span className="relative z-10 text-right font-mono tabular-nums text-foreground/80">
                {row.amount.toFixed(4)}
              </span>
              <span className="relative z-10 text-right font-mono tabular-nums text-foreground/60">
                {row.total.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Spread / last price row */}
      <div className="my-1 flex items-center justify-between border-y border-[var(--panel-border)] bg-[#0a0e17] px-3 py-1.5">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "font-mono text-base font-bold tabular-nums",
              lastUp ? "text-[var(--bull)]" : "text-[var(--bear)]",
            )}
          >
            {formatPrice(lastPrice, decimals)}
          </span>
          <span
            className={cn(
              "text-[10px] font-medium",
              lastUp ? "text-[var(--bull)]" : "text-[var(--bear)]",
            )}
          >
            {hasSpread ? lastUp ? "^" : "v" : "—"}
          </span>
        </div>
        <div className="flex flex-col items-end leading-none">
          <span className="text-[10px] text-muted-foreground">Spread</span>
          <span className="font-mono text-[11px] tabular-nums text-foreground/80">
            {formatPrice(spread, decimals)} ({Number.isFinite(spreadPercent)?`${spreadPercent.toFixed(3)}%`:"—"})
          </span>
        </div>
      </div>

      {/* Bids */}
      <div className="flex flex-col">
        {bids.map((row, i) => {
          const depthPct = (row.total / maxTotal) * 100;
          return (
            <div
              key={`bid-${i}`}
              className="relative grid grid-cols-3 px-3 py-[3px] text-xs transition-colors hover:bg-[#11161f]"
            >
              <div
                className="absolute inset-y-0 right-0 bg-gradient-to-l from-[#16c784]/20 to-transparent"
                style={{ width: `${depthPct}%` }}
              />
              <span className="relative z-10 text-left font-mono tabular-nums text-[var(--bull)]">
                {formatPrice(row.price, decimals)}
              </span>
              <span className="relative z-10 text-right font-mono tabular-nums text-foreground/80">
                {row.amount.toFixed(4)}
              </span>
              <span className="relative z-10 text-right font-mono tabular-nums text-foreground/60">
                {row.total.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
