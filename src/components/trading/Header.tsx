"use client";

import { useSyncExternalStore, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  Search,
  Settings,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { getMarketStatus } from "@/lib/binance";
import type { SymbolInfo } from "./types";

type MarketFilter = "all" | "open" | "closed";

interface HeaderProps {
  symbols: SymbolInfo[];
  activeSymbol: SymbolInfo;
  livePrice: number;
  onSelectSymbol: (id: string) => void;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Subscribe to the system wall-clock via useSyncExternalStore so we avoid
// hydration mismatches and any imperative setState-in-effect. The snapshot
// is rounded to whole seconds so it is stable between ticks (otherwise
// Date.now() would change every millisecond and trigger render loops).
function useWallClock(): Date | null {
  const seconds = useSyncExternalStore(
    (cb) => {
      const id = setInterval(cb, 1000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 1000),
    () => 0,
  );
  return seconds === 0 ? null : new Date(seconds * 1000);
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
        active
          ? "bg-[#1c2230] text-foreground"
          : "text-muted-foreground hover:bg-[#11161f] hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function Header({
  symbols,
  activeSymbol,
  livePrice,
  onSelectSymbol,
}: HeaderProps) {
  const now = useWallClock();
  const [filter, setFilter] = useState<MarketFilter>("all");

  const utcString =
    now == null
      ? "--:--:--"
      : `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(
          now.getUTCSeconds(),
        )} UTC`;

  const dateStr =
    now == null
      ? ""
      : now.toUTCString().split(" ").slice(0, 4).join(" ");

  // Pre-compute market status for every symbol so the dropdown can show the
  // open / closed badge without re-computing per render.
  const enriched = useMemo(
    () =>
      symbols.map((s) => {
        const status = getMarketStatus(s);
        return { symbol: s, status };
      }),
    [symbols],
  );

  const filtered = useMemo(() => {
    if (filter === "open") return enriched.filter((e) => e.status.open);
    if (filter === "closed") return enriched.filter((e) => !e.status.open);
    return enriched;
  }, [enriched, filter]);

  const openCount = enriched.filter((e) => e.status.open).length;
  const closedCount = enriched.length - openCount;
  const marketBanner =
    closedCount === 0
      ? "All markets open"
      : `${openCount} open / ${closedCount} closed`;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-[var(--panel-border)] bg-[#0a0e17]/95 px-3 backdrop-blur sm:px-4">
      {/* Left: Logo */}
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-md bg-gradient-to-br from-[var(--bull)] to-[#0e7a4d] text-[#0a0e17] shadow-[0_0_12px_rgba(22,199,132,0.45)]">
          <Zap className="size-5" strokeWidth={2.5} />
        </div>
        <div className="hidden flex-col leading-none sm:flex">
          <span className="text-sm font-bold tracking-wider text-foreground">
            Z TERMINAL
          </span>
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
            LIVE MARKET DATA
          </span>
        </div>
        <span className="text-sm font-bold tracking-wider text-foreground sm:hidden">
          Z
        </span>
      </div>

      {/* Center: Symbol selector */}
      <div className="flex flex-1 items-center justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 min-w-[180px] gap-2 border-[var(--panel-border)] bg-[#0d1117] px-3 hover:bg-[#11161f] hover:text-foreground sm:min-w-[240px]"
            >
              <Search className="size-3.5 text-muted-foreground" />
              <span className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold">
                  {activeSymbol.label}
                </span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  / {activeSymbol.name}
                </span>
              </span>
              <ChevronDown className="ml-auto size-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            className="w-[320px] border-[var(--panel-border)] bg-[#0d1117] p-1"
          >
            <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Select Market
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[var(--panel-border)]" />

            {/* Market status banner */}
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-live rounded-full bg-[var(--bull)]" />
                  <span className="relative inline-flex size-2 rounded-full bg-[var(--bull)]" />
                </span>
                <span className="font-semibold uppercase tracking-wider text-[var(--bull)]">
                  {marketBanner}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Crypto 24/7
              </span>
            </div>

            {/* Filter pills */}
            <div className="flex items-center gap-1 px-2 py-1.5">
              <FilterPill
                label="All"
                active={filter === "all"}
                onClick={() => setFilter("all")}
              />
              <FilterPill
                label="Open"
                active={filter === "open"}
                onClick={() => setFilter("open")}
              />
              <FilterPill
                label="Closed"
                active={filter === "closed"}
                onClick={() => setFilter("closed")}
              />
            </div>
            <DropdownMenuSeparator className="bg-[var(--panel-border)]" />

            <div className="max-h-72 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                  No markets match this filter.
                </div>
              )}
              {filtered.map(({ symbol: s, status }) => {
                const isActive = s.id === activeSymbol.id;
                return (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => onSelectSymbol(s.id)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm outline-none transition-colors hover:bg-[#11161f] focus:bg-[#11161f]",
                      isActive && "bg-[#11161f]",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          status.open
                            ? "bg-[var(--bull)] shadow-[0_0_6px_rgba(22,199,132,0.8)]"
                            : "bg-[var(--bear)]",
                        )}
                        aria-hidden="true"
                      />
                      <span className="font-mono text-sm font-semibold">
                        {s.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {s.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {status.label}
                      </span>
                      {isActive && (
                        <span className="size-1.5 rounded-full bg-[var(--bull)] shadow-[0_0_6px_rgba(22,199,132,0.8)]" />
                      )}
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Right: clock, status, settings */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden flex-col items-end leading-none md:flex">
          <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
            {utcString}
          </span>
          <span className="text-[10px] text-muted-foreground">{dateStr}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--panel-border)] bg-[#0d1117] px-2 py-1">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-live rounded-full bg-[var(--bull)]" />
            <span className="relative inline-flex size-2 rounded-full bg-[var(--bull)]" />
          </span>
          <span className="text-[11px] font-semibold tracking-wider text-[var(--bull)]">
            LIVE
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 text-muted-foreground hover:bg-[#11161f] hover:text-foreground"
          aria-label="Settings"
        >
          <Settings className="size-5" />
        </Button>
        <div className="hidden items-center gap-1 rounded-md border border-[var(--panel-border)] bg-[#0d1117] px-2 py-1.5 text-[11px] text-muted-foreground lg:flex">
          <Activity className="size-3.5 text-[var(--bull)]" />
          <span className="font-mono tabular-nums">{formatPrice(livePrice)}</span>
        </div>
      </div>
    </header>
  );
}
