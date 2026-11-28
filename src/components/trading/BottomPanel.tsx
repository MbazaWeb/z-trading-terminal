"use client";

import { useMemo } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  SYMBOLS,
  formatPrice,
  priceDecimals,
} from "./useMarketData";
import type { SymbolInfo, Trade } from "./types";

interface BottomPanelProps {
  trades: Trade[];
  symbols: SymbolInfo[];
  activeSymbolId: string;
  livePrice: number;
  onSelectSymbol: (id: string) => void;
}

function formatTradeTime(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function BottomPanel({
  trades,
  symbols,
  activeSymbolId,
  livePrice,
  onSelectSymbol,
}: BottomPanelProps) {
  // Pairs tab: show only the active symbol's live price (we don't fetch every
  // symbol here to keep this lightweight — the TickerTape already does that).
  const pairs = useMemo(
    () =>
      symbols.map((s) => {
        const isActive = s.id === activeSymbolId;
        return { symbol: s, price: isActive ? livePrice : 0, isActive };
      }),
    [symbols, activeSymbolId, livePrice],
  );

  return (
    <section className="flex flex-col rounded-xl border border-[var(--panel-border)] bg-[#0d1117] animate-fade-in-up">
      <Tabs defaultValue="trades" className="flex h-full flex-col gap-0">
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-2 py-1.5">
          <TabsList className="h-8 bg-[#0a0e17] p-0.5">
            <TabsTrigger
              value="trades"
              className="h-7 rounded px-3 text-xs font-semibold data-[state=active]:bg-[#1c2230] data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Recent Trades
            </TabsTrigger>
            <TabsTrigger
              value="pairs"
              className="h-7 rounded px-3 text-xs font-semibold data-[state=active]:bg-[#1c2230] data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Market Pairs
            </TabsTrigger>
          </TabsList>
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            {trades.length} live trades
          </span>
        </div>

        {/* Recent trades (real Binance trades feed) */}
        <TabsContent value="trades" className="mt-0 flex-1 outline-none">
          <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="text-left">Price</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Time</span>
          </div>
          <div className="max-h-64 overflow-y-auto px-1 pb-2">
            {trades.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Waiting for trades...
              </div>
            )}
            {trades.map((t) => {
              const isBuy = t.side === "buy";
              return (
                <div
                  key={t.id}
                  className={cn(
                    "grid grid-cols-3 px-3 py-[3px] text-xs transition-colors hover:bg-[#11161f]",
                  )}
                >
                  <span
                    className={cn(
                      "text-left font-mono tabular-nums",
                      isBuy ? "text-[var(--bull)]" : "text-[var(--bear)]",
                    )}
                  >
                    {formatPrice(t.price)}
                  </span>
                  <span className="text-right font-mono tabular-nums text-foreground/80">
                    {t.amount.toFixed(4)}
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted-foreground">
                    {formatTradeTime(t.time)}
                  </span>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* Market Pairs */}
        <TabsContent value="pairs" className="mt-0 flex-1 outline-none">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--panel-border)] text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Pair</th>
                  <th className="px-3 py-1.5 text-right font-medium">
                    Last Price
                  </th>
                  <th className="px-3 py-1.5 text-right font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => {
                  return (
                    <tr
                      key={p.symbol.id}
                      onClick={() => onSelectSymbol(p.symbol.id)}
                      className={cn(
                        "cursor-pointer border-b border-[var(--panel-border)]/50 transition-colors hover:bg-[#11161f]",
                        p.isActive && "bg-[#11161f]",
                      )}
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">
                            {p.symbol.label}
                          </span>
                          {p.isActive && (
                            <span className="size-1.5 rounded-full bg-[var(--bull)] shadow-[0_0_6px_rgba(22,199,132,0.8)]" />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {p.price > 0
                          ? formatPrice(p.price, priceDecimals(p.price))
                          : "--"}
                      </td>
                      <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground">
                        {p.symbol.kind === "crypto" ? "Crypto" : "Stock"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
