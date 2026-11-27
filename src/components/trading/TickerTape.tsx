"use client";

import { useMemo } from "react";
import { SYMBOLS, formatPrice } from "./useMarketData";
import type { SymbolInfo } from "./types";
import { cn } from "@/lib/utils";

interface TickerTapeProps {
  activeSymbolId: string;
  livePrice: number;
  activeChangePercent: number;
  onSelectSymbol: (id: string) => void;
}

// Deterministic pseudo change-percent for non-active symbols.
function seededChange(symbol: SymbolInfo): number {
  let h = 2166136261;
  const s = symbol.id + "ticker";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  return (h % 1200) / 100 - 6;
}

export function TickerTape({
  activeSymbolId,
  livePrice,
  activeChangePercent,
  onSelectSymbol,
}: TickerTapeProps) {
  const items = useMemo(
    () =>
      SYMBOLS.map((s) => {
        const isActive = s.id === activeSymbolId;
        const change = isActive ? activeChangePercent : seededChange(s);
        const price = isActive ? livePrice : s.basePrice * (1 + change / 100);
        return { symbol: s, price, change, isActive };
      }),
    [activeSymbolId, livePrice, activeChangePercent],
  );

  // Duplicate the list so the marquee loops seamlessly (translateX -50%).
  const loop = [...items, ...items];

  return (
    <div className="relative z-30 h-8 overflow-hidden border-b border-[var(--panel-border)] bg-[#070a11]">
      <div className="animate-ticker flex h-full w-max items-center whitespace-nowrap">
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
                {up ? "+" : ""}
                {item.change.toFixed(2)}%
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
