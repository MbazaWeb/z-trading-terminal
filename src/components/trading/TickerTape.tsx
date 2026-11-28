"use client";

import { useMemo } from "react";
import { formatPrice } from "./useMarketData";
import type { SymbolInfo } from "./types";
import { cn } from "@/lib/utils";

interface TickerTapeProps {
  symbols: SymbolInfo[];
  activeSymbolId: string;
  livePrice: number;
  activeChangePercent: number;
  onSelectSymbol: (id: string) => void;
}

export function TickerTape({
  symbols,
  activeSymbolId,
  livePrice,
  activeChangePercent,
  onSelectSymbol,
}: TickerTapeProps) {
  const items = useMemo(
    () =>
      symbols.map((s) => {
        const isActive = s.id === activeSymbolId;
        const change = isActive ? activeChangePercent : s.changePercent ?? NaN;
        const price = isActive ? livePrice : s.basePrice;
        return { symbol: s, price, change, isActive };
      }),
    [symbols, activeSymbolId, livePrice, activeChangePercent],
  );

  // Duplicate the list so the marquee loops seamlessly (translateX -50%).
  const loop = [...items, ...items];

  return (
    <div className="relative z-30 h-8 overflow-hidden border-b border-[var(--panel-border)] bg-[#070a11]">
      <div className="animate-ticker flex h-full w-max items-center whitespace-nowrap">
        {!loop.length && <span className="px-4 text-xs text-muted-foreground">Market feed unavailable</span>}
        {loop.map((item, idx) => {
          const up = item.change >= 0;
          return (
            <button
              key={`${item.symbol.id}-${idx}`}
              type="button"
              onClick={() => onSelectSymbol(item.symbol.id)}
              className={cn(
                "flex h-full items-center gap-2 border-r border-[var(--panel-border)] px-4 text-xs transition-colors hover:bg-[#11161f]",
                item.isActive && "bg-[#0d1117]",
              )}
            >
              <span className="font-semibold text-foreground/90">
                {item.symbol.label}
              </span>
              <span className="font-mono text-foreground/70">
                {formatPrice(item.price)}
              </span>
              <span
                className={cn(
                  "font-mono",
                  up ? "text-[var(--bull)]" : "text-[var(--bear)]",
                )}
              >
                {Number.isFinite(item.change) ? `${up?"+":""}${item.change.toFixed(2)}%` : "—"}
              </span>
            </button>
          );
        })}
      </div>
      {/* Edge fades for a polished look */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-[#070a11] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[#070a11] to-transparent" />
    </div>
  );
}
