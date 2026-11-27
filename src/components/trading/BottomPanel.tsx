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

function seededChange(symbol: SymbolInfo): number {
  let h = 2166136261;
  const s = symbol.id + "pairs";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  return (h % 1200) / 100 - 6 + Math.sin(Date.now() / 60000 + h) * 0.4;
}

const FAKE_ORDERS = [
  { id: "#A8F21", pair: "BTC/USDT", type: "Limit", side: "buy" as const, price: 67100, amount: 0.25, filled: 42, status: "Partial" },
  { id: "#A8F22", pair: "ETH/USDT", type: "Limit", side: "sell" as const, price: 3580, amount: 3.5, filled: 0, status: "Open" },
  { id: "#A8F23", pair: "SOL/USDT", type: "Market", side: "buy" as const, price: 164.2, amount: 50, filled: 100, status: "Filled" },
  { id: "#A8F24", pair: "BNB/USDT", type: "Stop", side: "sell" as const, price: 590, amount: 12, filled: 0, status: "Open" },
  { id: "#A8F25", pair: "AAPL", type: "Limit", side: "buy" as const, price: 222.5, amount: 100, filled: 18, status: "Partial" },
];

export function BottomPanel({
  trades,
  symbols,
  activeSymbolId,
  livePrice,
  onSelectSymbol,
}: BottomPanelProps) {
  const pairs = useMemo(
    () =>
      symbols.map((s) => {
        const isActive = s.id === activeSymbolId;
        const change = isActive ? 0 : seededChange(s);
        const price = isActive ? livePrice : s.basePrice * (1 + change / 100);
        return { symbol: s, price, change, isActive };
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
              Trades
            </TabsTrigger>
            <TabsTrigger
              value="orders"
              className="h-7 rounded px-3 text-xs font-semibold data-[state=active]:bg-[#1c2230] data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Open Orders
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

        {/* Trades */}
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

        {/* Open Orders */}
        <TabsContent value="orders" className="mt-0 flex-1 outline-none">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--panel-border)] text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Order ID</th>
                  <th className="px-3 py-1.5 font-medium">Pair</th>
                  <th className="px-3 py-1.5 font-medium">Type</th>
                  <th className="px-3 py-1.5 font-medium">Side</th>
                  <th className="px-3 py-1.5 text-right font-medium">Price</th>
                  <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-1.5 text-right font-medium">Filled</th>
                  <th className="px-3 py-1.5 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {FAKE_ORDERS.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-[var(--panel-border)]/50 transition-colors hover:bg-[#11161f]"
                  >
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {o.id}
                    </td>
                    <td className="px-3 py-1.5 font-mono font-medium">
                      {o.pair}
                    </td>
                    <td className="px-3 py-1.5 text-foreground/80">{o.type}</td>
                    <td
                      className={cn(
                        "px-3 py-1.5 font-medium",
                        o.side === "buy"
                          ? "text-[var(--bull)]"
                          : "text-[var(--bear)]",
                      )}
                    >
                      {o.side === "buy" ? "Buy" : "Sell"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {formatPrice(o.price, priceDecimals(o.price))}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-foreground/80">
                      {o.amount}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-foreground/60">
                      {o.filled}%
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right font-medium",
                        o.status === "Filled"
                          ? "text-[var(--bull)]"
                          : o.status === "Partial"
                            ? "text-[#f0b90b]"
                            : "text-muted-foreground",
                      )}
                    >
                      {o.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  <th className="px-3 py-1.5 text-right font-medium">
                    24h Change
                  </th>
                  <th className="px-3 py-1.5 text-right font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => {
                  const up = p.change >= 0;
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
                        {formatPrice(p.price)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right font-mono tabular-nums",
                          up ? "text-[var(--bull)]" : "text-[var(--bear)]",
                        )}
                      >
                        {up ? "+" : ""}
                        {p.change.toFixed(2)}%
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
