"use client";

import { useMemo } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatCompact,
  formatPrice,
  priceDecimals,
} from "@/lib/format";
import type { Candle, SymbolInfo, TickerStats } from "./types";

interface StatsStripProps {
  stats: TickerStats;
  candles: Candle[];
  symbol: SymbolInfo;
  direction: "up" | "down" | "flat";
}

function Sparkline({
  values,
  positive,
}: {
  values: number[];
  positive: boolean;
}) {
  const w = 80;
  const h = 24;
  const path = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = w / (values.length - 1);
    return values
      .map((v, i) => {
        const x = i * step;
        const y = h - ((v - min) / range) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values]);

  const color = positive ? "#16c784" : "#ea3943";
  const fillId = positive ? "spark-up" : "spark-down";

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {path && (
        <>
          <path
            d={`${path} L${w},${h} L0,${h} Z`}
            fill={`url(#${fillId})`}
            stroke="none"
          />
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

function StatCard({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-lg border border-[var(--panel-border)] bg-[#0d1117] px-3 py-2",
        className,
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

export function StatsStrip({
  stats,
  candles,
  symbol,
  direction,
}: StatsStripProps) {
  const up = stats.changePercent >= 0;
  const decimals = priceDecimals(stats.lastPrice);

  const sparkValues = useMemo(
    () => candles.slice(-24).map((c) => c.close),
    [candles],
  );

  const directionColor =
    direction === "up"
      ? "text-[var(--bull)]"
      : direction === "down"
        ? "text-[var(--bear)]"
        : "text-foreground";

  return (
    <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 sm:gap-2.5 sm:p-3 lg:grid-cols-6">
      {/* Last Price */}
      <StatCard label="Last Price" className="lg:col-span-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "font-mono text-xl font-bold tabular-nums transition-colors sm:text-2xl",
              directionColor,
              direction === "up" && "text-glow-bull",
              direction === "down" && "text-glow-bear",
            )}
          >
            {stats.lastPrice > 0 ? formatPrice(stats.lastPrice, decimals) : "--"}
          </span>
          <Sparkline values={sparkValues} positive={up} />
        </div>
      </StatCard>

      {/* 24h Change */}
      <StatCard label="24h Change">
        <div className="flex flex-col">
          <span
            className={cn(
              "flex items-center gap-1 font-mono text-base font-semibold tabular-nums",
              up ? "text-[var(--bull)]" : "text-[var(--bear)]",
            )}
          >
            {up ? (
              <ArrowUp className="size-3.5" />
            ) : (
              <ArrowDown className="size-3.5" />
            )}
            {up ? "+" : ""}
            {stats.changePercent.toFixed(2)}%
          </span>
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              up ? "text-[var(--bull)]/80" : "text-[var(--bear)]/80",
            )}
          >
            {up ? "+" : ""}
            {formatPrice(stats.changeAbs, decimals)}
          </span>
        </div>
      </StatCard>

      {/* 24h High / Low */}
      <StatCard label="24h High / Low">
        <div className="flex flex-col">
          <span className="font-mono text-sm font-semibold text-[var(--bull)] tabular-nums">
            {formatPrice(stats.high24h, decimals)}
          </span>
          <span className="font-mono text-sm font-semibold text-[var(--bear)] tabular-nums">
            {formatPrice(stats.low24h, decimals)}
          </span>
        </div>
      </StatCard>

      {/* 24h Volume */}
      <StatCard label={`24h Volume (${symbol.quote})`}>
        <span className="font-mono text-base font-semibold tabular-nums">
          {formatCompact(stats.volume24h)}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {formatCompact(stats.volumeBase24h)} {symbol.base}
        </span>
      </StatCard>

      {/* Open24h reference */}
      <StatCard label="24h Open">
        <span className="font-mono text-base font-semibold tabular-nums">
          {formatPrice(stats.open24h, decimals)}
        </span>
        <span className="text-[11px] text-muted-foreground">Binance spot</span>
      </StatCard>

      {/* Bid / Ask approximation (from last price) */}
      <StatCard label="Bid / Ask">
        <div className="flex flex-col">
          <span className="font-mono text-sm font-semibold text-[var(--bear)] tabular-nums">
            {formatPrice(stats.lastPrice * 0.9999, decimals)}
          </span>
          <span className="font-mono text-sm font-semibold text-[var(--bull)] tabular-nums">
            {formatPrice(stats.lastPrice * 1.0001, decimals)}
          </span>
        </div>
      </StatCard>
    </div>
  );
}
