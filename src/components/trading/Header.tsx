"use client";

import { useSyncExternalStore } from "react";
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
import { formatPrice } from "./useMarketData";
import type { SymbolInfo } from "./types";

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

export function Header({
  symbols,
  activeSymbol,
  livePrice,
  onSelectSymbol,
}: HeaderProps) {
  const now = useWallClock();

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

  return (
    <header className="sticky top-0 z-20 flex min-h-14 min-w-0 items-center justify-between gap-1 sm:gap-3 border-b border-[var(--panel-border)] bg-[#0a0e17]/95 px-3 backdrop-blur sm:px-4">
      {/* Left: Logo */}
      <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
        <div className="flex size-8 items-center justify-center rounded-md bg-[var(--bull)] text-[#0a0e17] ">
          <Zap className="size-5" strokeWidth={2.5} />
        </div>
        <div className="hidden flex-col leading-none sm:flex">
          <span className="text-sm font-bold tracking-wide text-foreground">
            Z TERMINAL
          </span>
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
            MARKET DATA
          </span>
        </div>
        <span className="text-sm font-bold tracking-wide text-foreground sm:hidden">
          Z
        </span>
      </div>

      {/* Center: Symbol selector */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-11 w-full min-w-0 gap-2 border-[var(--panel-border)] bg-[#0d1117] px-3 hover:bg-[#11161f] hover:text-foreground sm:max-w-[320px]"
            >
              <Search className="size-3.5 text-muted-foreground" />
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-sm font-semibold">
                  {activeSymbol.label}
                </span>
                <span className="hidden truncate text-xs text-muted-foreground xl:inline">
                  / {activeSymbol.name}
                </span>
              </span>
              <ChevronDown className="ml-auto size-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            className="w-[280px] max-w-[calc(100vw-24px)] border-[var(--panel-border)] bg-[#0d1117] p-1"
          >
            <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Select Market
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[var(--panel-border)]" />
            <div className="max-h-72 overflow-y-auto">
              {symbols.map((s) => {
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
                      <span className="font-mono text-sm font-semibold">
                        {s.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {s.kind === "crypto" ? "Crypto" : "Stock"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatPrice(s.basePrice)}
                      </span>
                      {isActive && (
                        <span className="size-1.5 rounded-full bg-[var(--bull)] " />
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
      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        <div className="hidden flex-col items-end leading-none md:flex">
          <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
            {utcString}
          </span>
          <span className="text-[10px] text-muted-foreground">{dateStr}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--panel-border)] bg-[#0d1117] px-2 py-1">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full rounded-full bg-[var(--bull)]" />
            <span className="relative inline-flex size-2 rounded-full bg-[var(--bull)]" />
          </span>
          <span className="text-[11px] font-semibold tracking-wide text-[var(--bull)]">
            FEED
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 text-muted-foreground hover:bg-[#11161f] hover:text-foreground"
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
