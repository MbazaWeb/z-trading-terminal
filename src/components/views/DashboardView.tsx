"use client";

import { memo, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  List,
  MinusCircle,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DAY_MS,
  formatDateTime,
  formatMoney,
  formatPrice,
  priceDecimals,
} from "@/lib/format";
import { useTrades, useTradeStore } from "@/lib/tradeStore";
import type { Trade } from "@/lib/tradeStore";

type Range = "today" | "7d" | "30d" | "all";
type Filter = "all" | "open" | "closed" | "wins" | "losses";
type SortKey = "datetime" | "market" | "amount" | "entryPrice" | "exitPrice" | "pnl" | "pnlPct";

function startOfDay(): number {
  const now = Date.now();
  return now - (now % DAY_MS);
}

function rangeFilter(range: Range): (t: Trade) => boolean {
  const todayStart = startOfDay();
  switch (range) {
    case "today":
      return (t) => t.datetime >= todayStart;
    case "7d":
      return (t) => t.datetime >= todayStart - 6 * DAY_MS;
    case "30d":
      return (t) => t.datetime >= todayStart - 29 * DAY_MS;
    case "all":
    default:
      return () => true;
  }
}

function previousRangeFilter(range: Range): (t: Trade) => boolean {
  const todayStart = startOfDay();
  switch (range) {
    case "today":
      return (t) => t.datetime >= todayStart - DAY_MS && t.datetime < todayStart;
    case "7d":
      return (t) =>
        t.datetime >= todayStart - 13 * DAY_MS && t.datetime < todayStart - 6 * DAY_MS;
    case "30d":
      return (t) =>
        t.datetime >= todayStart - 59 * DAY_MS && t.datetime < todayStart - 29 * DAY_MS;
    case "all":
    default:
      return () => false;
  }
}

// ---- Stats cards -----------------------------------------------------------

function StatCard({
  label,
  value,
  icon: Icon,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  delta?: string;
  tone?: "bull" | "bear" | "neutral" | "info";
}) {
  const toneClass =
    tone === "bull"
      ? "text-[var(--bull)]"
      : tone === "bear"
        ? "text-[var(--bear)]"
        : tone === "info"
          ? "text-[#4f9cf9]"
          : "text-foreground";
  const iconBg =
    tone === "bull"
      ? "bg-[var(--bull)]/10 text-[var(--bull)]"
      : tone === "bear"
        ? "bg-[var(--bear)]/10 text-[var(--bear)]"
        : tone === "info"
          ? "bg-[#4f9cf9]/10 text-[#4f9cf9]"
          : "bg-white/5 text-muted-foreground";
  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
      <div className="flex items-center gap-2">
        <div className={cn("flex size-8 items-center justify-center rounded-md", iconBg)}>
          <Icon className="size-4" />
        </div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn("mt-2 font-mono text-2xl font-bold tabular-nums", toneClass)}>
        {value}
      </div>
      {delta && (
        <div className="mt-1 text-[11px] text-muted-foreground">{delta}</div>
      )}
    </div>
  );
}

function RingProgress({
  percent,
  color,
  label,
}: {
  percent: number;
  color: string;
  label: string;
}) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const dash = (percent / 100) * c;
  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div
            className="mt-2 font-mono text-2xl font-bold tabular-nums"
            style={{ color }}
          >
            {percent.toFixed(1)}%
          </div>
        </div>
        <svg width="80" height="80" viewBox="0 0 80 80" className="shrink-0">
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke="#1e2530"
            strokeWidth="6"
          />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            transform="rotate(-90 40 40)"
            style={{ transition: "stroke-dasharray 0.4s ease" }}
          />
          <text
            x="40"
            y="44"
            textAnchor="middle"
            fontSize="13"
            fontWeight="700"
            fill={color}
            fontFamily="monospace"
          >
            {Math.round(percent)}%
          </text>
        </svg>
      </div>
    </div>
  );
}

// ---- Cumulative P&L area chart ---------------------------------------------

function CumulativePnlChart({ trades }: { trades: Trade[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 520;
  const H = 220;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 24;

  const series = useMemo(() => {
    const byDay = new Map<number, number>();
    const todayStart = startOfDay();
    trades
      .filter((t) => t.status === "closed")
      .forEach((t) => {
        const day = Math.floor((t.datetime - todayStart) / DAY_MS);
        byDay.set(day, (byDay.get(day) ?? 0) + t.pnl);
      });
    const days = Array.from(byDay.keys()).sort((a, b) => a - b);
    if (days.length === 0) return [] as { day: number; cum: number }[];
    let cum = 0;
    const out: { day: number; cum: number }[] = [];
    const minDay = days[0];
    const maxDay = days[days.length - 1];
    for (let d = minDay; d <= maxDay; d++) {
      cum += byDay.get(d) ?? 0;
      out.push({ day: d, cum });
    }
    return out;
  }, [trades]);

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const minCum = Math.min(0, ...series.map((s) => s.cum));
  const maxCum = Math.max(0, ...series.map((s) => s.cum));
  const range = maxCum - minCum || 1;
  const minDay = series.length ? series[0].day : 0;
  const maxDay = series.length ? series[series.length - 1].day : 1;
  const daySpan = maxDay - minDay || 1;

  const xFor = (day: number) => padL + ((day - minDay) / daySpan) * plotW;
  const yFor = (cum: number) => padT + plotH - ((cum - minCum) / range) * plotH;

  const linePath = series
    .map((s, i) => `${i === 0 ? "M" : "L"}${xFor(s.day).toFixed(1)},${yFor(s.cum).toFixed(1)}`)
    .join(" ");
  const areaPath =
    series.length > 0
      ? `${linePath} L${xFor(maxDay).toFixed(1)},${(padT + plotH).toFixed(1)} L${xFor(minDay).toFixed(1)},${(padT + plotH).toFixed(1)} Z`
      : "";
  const isUp = series.length > 0 ? series[series.length - 1].cum >= 0 : true;
  const lineColor = isUp ? "#16c784" : "#ea3943";

  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Cumulative P&amp;L
        </h3>
        <span
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            isUp ? "text-[var(--bull)]" : "text-[var(--bear)]",
          )}
        >
          {formatMoney(series.length ? series[series.length - 1].cum : 0)}
        </span>
      </div>
      {series.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
          No closed trades in range
        </div>
      ) : (
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          className="overflow-visible"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="pnl-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.35" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <line
              key={p}
              x1={padL}
              x2={W - padR}
              y1={padT + p * plotH}
              y2={padT + p * plotH}
              stroke="#161b22"
              strokeDasharray="2 4"
            />
          ))}
          {[0, 0.5, 1].map((p) => {
            const v = maxCum - p * range;
            return (
              <text
                key={p}
                x={padL - 6}
                y={padT + p * plotH + 3}
                textAnchor="end"
                fontSize="9"
                fill="#8b949e"
                fontFamily="monospace"
              >
                ${v >= 0 ? "" : "-"}{Math.abs(v).toFixed(0)}
              </text>
            );
          })}
          {minCum < 0 && (
            <line
              x1={padL}
              x2={W - padR}
              y1={yFor(0)}
              y2={yFor(0)}
              stroke="#2a3340"
              strokeWidth="1"
            />
          )}
          {areaPath && <path d={areaPath} fill="url(#pnl-area)" />}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={lineColor}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {series.map((s, i) => (
            <g key={i}>
              <circle
                cx={xFor(s.day)}
                cy={yFor(s.cum)}
                r={hoverIdx === i ? 4 : 2}
                fill={lineColor}
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(i)}
              />
              {hoverIdx === i && (
                <g>
                  <line
                    x1={xFor(s.day)}
                    x2={xFor(s.day)}
                    y1={padT}
                    y2={padT + plotH}
                    stroke={lineColor}
                    strokeDasharray="2 3"
                    strokeOpacity="0.5"
                  />
                  <rect
                    x={Math.min(xFor(s.day) + 6, W - padR - 110)}
                    y={padT + 4}
                    width="104"
                    height="34"
                    rx="4"
                    fill="#0a0e17"
                    stroke="#1e2530"
                  />
                  <text
                    x={Math.min(xFor(s.day) + 12, W - padR - 100)}
                    y={padT + 16}
                    fontSize="9"
                    fill="#8b949e"
                    fontFamily="monospace"
                  >
                    Day {s.day === 0 ? "today" : `${s.day}d ago`}
                  </text>
                  <text
                    x={Math.min(xFor(s.day) + 12, W - padR - 100)}
                    y={padT + 30}
                    fontSize="11"
                    fontWeight="700"
                    fill={s.cum >= 0 ? "#16c784" : "#ea3943"}
                    fontFamily="monospace"
                  >
                    {formatMoney(s.cum)}
                  </text>
                </g>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

// ---- Win/Loss donut --------------------------------------------------------

function WinLossDonut({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses;
  const winPct = total > 0 ? (wins / total) * 100 : 0;
  const r = 54;
  const c = 2 * Math.PI * r;
  const winDash = total > 0 ? (wins / total) * c : 0;
  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground">
        Win / Loss
      </h3>
      <div className="flex items-center justify-center">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r={r} fill="none" stroke="#1e2530" strokeWidth="16" />
          <circle
            cx="80"
            cy="80"
            r={r}
            fill="none"
            stroke="#16c784"
            strokeWidth="16"
            strokeDasharray={`${winDash} ${c - winDash}`}
            transform="rotate(-90 80 80)"
            style={{ transition: "stroke-dasharray 0.4s ease" }}
          />
          <text
            x="80"
            y="74"
            textAnchor="middle"
            fontSize="11"
            fill="#8b949e"
            fontFamily="monospace"
          >
            Win Rate
          </text>
          <text
            x="80"
            y="96"
            textAnchor="middle"
            fontSize="22"
            fontWeight="700"
            fill="#16c784"
            fontFamily="monospace"
          >
            {winPct.toFixed(0)}%
          </text>
        </svg>
      </div>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-[var(--bull)]">
          <span className="size-2 rounded-full bg-[var(--bull)]" /> Wins {wins}
        </span>
        <span className="flex items-center gap-1.5 text-[var(--bear)]">
          <span className="size-2 rounded-full bg-[var(--bear)]" /> Losses {losses}
        </span>
      </div>
    </div>
  );
}

// ---- Trade logs table ------------------------------------------------------

function ResultBadge({ result, status }: { result: Trade["result"]; status: Trade["status"] }) {
  if (status === "open") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[#4f9cf9]/15 text-[#4f9cf9]">
        Open
      </span>
    );
  }
  if (result === "win") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[var(--bull)]/15 text-[var(--bull)]">
        Win
      </span>
    );
  }
  if (result === "loss") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[var(--bear)]/15 text-[var(--bear)]">
        Loss
      </span>
    );
  }
  return <span className="text-muted-foreground">--</span>;
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "px-3 py-2 font-medium select-none",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 text-[10px] uppercase tracking-wider transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </button>
    </th>
  );
}

const PAGE_SIZE = 10;

function TradeLogsTable({ trades }: { trades: Trade[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("datetime");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let out = trades.slice();
    if (filter === "open") out = out.filter((t) => t.status === "open");
    else if (filter === "closed") out = out.filter((t) => t.status === "closed");
    else if (filter === "wins") out = out.filter((t) => t.result === "win");
    else if (filter === "losses") out = out.filter((t) => t.result === "loss");
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((t) => t.market.toLowerCase().includes(q));
    }
    out.sort((a, b) => {
      let av: string | number | null = a[sortKey];
      let bv: string | number | null = b[sortKey];
      if (sortKey === "exitPrice") {
        av = a.exitPrice ?? -1;
        bv = b.exitPrice ?? -1;
      }
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (av == null) av = -1;
      if (bv == null) bv = -1;
      return sortDir === "asc"
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });
    return out;
  }, [trades, filter, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed" },
    { id: "wins", label: "Wins" },
    { id: "losses", label: "Losses" },
  ];

  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] animate-fade-in-up">
      <div className="flex flex-col gap-2 border-b border-[var(--panel-border)] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFilter(f.id);
                setPage(0);
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f.id
                  ? "bg-[#1c2230] text-foreground"
                  : "text-muted-foreground hover:bg-[#11161f] hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-56">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search market..."
            className="h-8 border-[var(--panel-border)] bg-[#0a0e17] font-mono text-xs placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--panel-border)]">
              <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <SortHeader
                label="Date &amp; Time"
                active={sortKey === "datetime"}
                dir={sortDir}
                onClick={() => toggleSort("datetime")}
              />
              <SortHeader
                label="Market"
                active={sortKey === "market"}
                dir={sortDir}
                onClick={() => toggleSort("market")}
              />
              <SortHeader
                label="Side"
                active={false}
                dir={sortDir}
                onClick={() => {}}
              />
              <SortHeader
                label="Amount"
                active={sortKey === "amount"}
                dir={sortDir}
                onClick={() => toggleSort("amount")}
                align="right"
              />
              <SortHeader
                label="Entry"
                active={sortKey === "entryPrice"}
                dir={sortDir}
                onClick={() => toggleSort("entryPrice")}
                align="right"
              />
              <SortHeader
                label="Exit"
                active={sortKey === "exitPrice"}
                dir={sortDir}
                onClick={() => toggleSort("exitPrice")}
                align="right"
              />
              <SortHeader
                label="P&amp;L"
                active={sortKey === "pnl"}
                dir={sortDir}
                onClick={() => toggleSort("pnl")}
                align="right"
              />
              <SortHeader
                label="P&amp;L %"
                active={sortKey === "pnlPct"}
                dir={sortDir}
                onClick={() => toggleSort("pnlPct")}
                align="right"
              />
              <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  {trades.length === 0
                    ? "No trades yet. Start trading to see your stats."
                    : "No trades match the current filters."}
                </td>
              </tr>
            )}
            {pageRows.map((t) => {
              const isWin = t.result === "win";
              const isLoss = t.result === "loss";
              const isOpen = t.status === "open";
              const decimals = priceDecimals(t.entryPrice);
              return (
                <tr
                  key={t.id}
                  className={cn(
                    "border-b border-[var(--panel-border)]/50 transition-colors hover:bg-[#11161f]",
                    isWin && "bg-[var(--bull)]/[0.04]",
                    isLoss && "bg-[var(--bear)]/[0.04]",
                  )}
                >
                  <td className="px-3 py-2">
                    <ResultBadge result={t.result} status={t.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground tabular-nums">
                    {formatDateTime(t.datetime)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                      {t.market}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 font-semibold",
                      t.side === "buy"
                        ? "text-[var(--bull)]"
                        : "text-[var(--bear)]",
                    )}
                  >
                    {t.side === "buy" ? "Buy" : "Sell"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    ${t.amount.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatPrice(t.entryPrice, decimals)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {t.exitPrice != null ? (
                      formatPrice(t.exitPrice, decimals)
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono tabular-nums",
                      isOpen
                        ? "text-muted-foreground"
                        : t.pnl >= 0
                          ? "text-[var(--bull)]"
                          : "text-[var(--bear)]",
                    )}
                  >
                    {isOpen ? "--" : formatMoney(t.pnl)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono tabular-nums",
                      isOpen
                        ? "text-muted-foreground"
                        : t.pnlPct >= 0
                          ? "text-[var(--bull)]"
                          : "text-[var(--bear)]",
                    )}
                  >
                    {isOpen
                      ? "--"
                      : `${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2">
                    {isOpen ? (
                      <span className="text-muted-foreground">--</span>
                    ) : (
                      <ResultBadge result={t.result} status={t.status} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-[var(--panel-border)] px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          {filtered.length} trades
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="font-mono tabular-nums text-muted-foreground">
            {safePage + 1} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Main view -------------------------------------------------------------

export const DashboardView = memo(function DashboardView() {
  const trades = useTrades();
  const fetchTrades = useTradeStore((s) => s.fetchTrades);
  const loading = useTradeStore((s) => s.loading);
  const [range, setRange] = useState<Range>("today");

  // Load trades from Supabase (if configured) on mount.
  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  const inRange = useMemo(
    () => trades.filter(rangeFilter(range)),
    [trades, range],
  );
  const prevRange = useMemo(
    () => trades.filter(previousRangeFilter(range)),
    [trades, range],
  );

  const stats = useMemo(() => {
    const closed = inRange.filter((t) => t.status === "closed");
    const wins = closed.filter((t) => t.result === "win");
    const losses = closed.filter((t) => t.result === "loss");
    const amountWin = wins.reduce((s, t) => s + t.pnl, 0);
    const amountLoss = losses.reduce((s, t) => s + Math.abs(t.pnl), 0);
    const prevClosed = prevRange.filter((t) => t.status === "closed");
    const prevWins = prevClosed.filter((t) => t.result === "win");
    const prevLosses = prevClosed.filter((t) => t.result === "loss");
    const total = closed.length;
    const winRate = total > 0 ? (wins.length / total) * 100 : 0;
    const loseRate = total > 0 ? (losses.length / total) * 100 : 0;
    return {
      todayCount: inRange.length,
      winCount: wins.length,
      loseCount: losses.length,
      total,
      amountWin,
      amountLoss,
      winRate,
      loseRate,
      prevTodayCount: prevRange.length,
      prevWinCount: prevWins.length,
      prevLoseCount: prevLosses.length,
      prevTotal: prevClosed.length,
    };
  }, [inRange, prevRange]);

  const delta = (cur: number, prev: number): string => {
    if (range === "all") return "";
    const diff = cur - prev;
    if (diff === 0) return "same as previous";
    return `${diff > 0 ? "+" : ""}${diff} vs previous`;
  };

  const ranges: { id: Range; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "7d", label: "7D" },
    { id: "30d", label: "30D" },
    { id: "all", label: "All" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Dashboard
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Trading performance overview for{" "}
            {range === "today"
              ? "today"
              : range === "all"
                ? "all time"
                : `the last ${range === "7d" ? "7" : "30"} days`}
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-1">
          {ranges.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                range === r.id
                  ? "bg-[#1c2230] text-foreground"
                  : "text-muted-foreground hover:bg-[#11161f] hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {/* Empty state for new accounts */}
      {trades.length === 0 && !loading ? (
        <div className="rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-12 text-center animate-fade-in-up">
          <ArrowLeftRight className="mx-auto size-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            No trades yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open the Trading view to place your first trade. Trades are
            recorded locally and synced to Supabase when configured.
          </p>
        </div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard
              label="Today's Trades"
              value={String(stats.todayCount)}
              icon={ArrowLeftRight}
              delta={delta(stats.todayCount, stats.prevTodayCount)}
            />
            <StatCard
              label="Win Trades"
              value={String(stats.winCount)}
              icon={TrendingUp}
              tone="bull"
              delta={delta(stats.winCount, stats.prevWinCount)}
            />
            <StatCard
              label="Lose Trades"
              value={String(stats.loseCount)}
              icon={TrendingDown}
              tone="bear"
              delta={delta(stats.loseCount, stats.prevLoseCount)}
            />
            <StatCard
              label="Total Closed"
              value={String(stats.total)}
              icon={List}
              delta={delta(stats.total, stats.prevTotal)}
            />
            <StatCard
              label="Amount Win"
              value={formatMoney(stats.amountWin)}
              icon={DollarSign}
              tone="bull"
            />
            <StatCard
              label="Amount Loss"
              value={formatMoney(stats.amountLoss)}
              icon={MinusCircle}
              tone="bear"
            />
            <RingProgress
              percent={stats.winRate}
              color="#16c784"
              label="Win Rate"
            />
            <RingProgress
              percent={stats.loseRate}
              color="#ea3943"
              label="Lose Rate"
            />
          </div>

          {/* Charts row */}
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
            <CumulativePnlChart trades={inRange} />
            <WinLossDonut wins={stats.winCount} losses={stats.loseCount} />
          </div>

          {/* Trade logs */}
          <div className="mt-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-foreground">
              Trade Logs
            </h2>
            <TradeLogsTable trades={inRange} />
          </div>
        </>
      )}
    </div>
  );
});
