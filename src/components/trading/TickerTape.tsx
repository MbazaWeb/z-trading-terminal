"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchAllTickers } from "@/lib/binance";
import { SYMBOLS } from "./useMarketData";
import { formatPrice } from "@/lib/format";
import type { TickerStats } from "./types";
import { cn } from "@/lib/utils";

interface TickerTapeProps {
  activeSymbolId: string;
  livePrice: number;
  activeChangePercent: number;
  onSelectSymbol: (id: string) => void;
}

interface TickerItem {
  id: string;
  label: string;
  price: number;
  change: number;
  isActive: boolean;
}

export function TickerTape({
  activeSymbolId,
  livePrice,
  activeChangePercent,
  onSelectSymbol,
}: TickerTapeProps) {
  const [allTickers, setAllTickers] = useState<Map<string, TickerStats>>(new Map());

  // Poll all tickers every 10s. The Binance /ticker/24hr (all) endpoint is
  // cached for 5s in the binance module so we round up to 10s here.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const map = await fetchAllTickers();
        if (!cancelled) setAllTickers(map);
      } catch {
        /* keep last known */
      }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const items: TickerItem[] = useMemo(() => {
    return SYMBOLS.map((s) => {
      const isActive = s.id === activeSymbolId;
      if (isActive) {
        return {
          id: s.id,
          label: s.label,
          price: livePrice,
          change: activeChangePercent,
          isActive,
        };
      }
      const t = allTickers.get(s.id);
      return {
        id: s.id,
        label: s.label,
        price: t?.lastPrice ?? 0,
        change: t?.changePercent ?? 0,
        isActive,
      };
    });
  }, [allTickers, activeSymbolId, livePrice, activeChangePercent]);

  // Duplicate the list so the marquee loops seamlessly (translateX -50%).
  const loop = [...items, ...items];

  return (
    <div className="relative z-30 h-8 overflow-hidden border-b border-[var(--panel-border)] bg-[#070a11]">
      <div className="animate-ticker flex h-full w-max items-center whitespace-nowrap">
        {loop.map((item, idx) => {
          const up = item.change >= 0;
          return (
            <button
              key={`${item.id}-${idx}`}
              type="button"
              onClick={() => onSelectSymbol(item.id)}
              className={cn(
                "flex h-full items-center gap-2 border-r border-[var(--panel-border)] px-4 text-xs transition-colors hover:bg-[#11161f]",
                item.isActive && "bg-[#0d1117]",
              )}
            >
              <span className="font-semibold text-foreground/90">
                {item.label}
              </span>
              <span className="font-mono text-foreground/70">
                {item.price > 0 ? formatPrice(item.price) : "--"}
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
