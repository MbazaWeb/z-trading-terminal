"use client";

// Shared formatting helpers for the Z Trading Terminal.
// These are pure functions with no module side-effects, so they can be safely
// imported from both server and client code (the `"use client"` directive is
// only here so client components that re-export them stay on the client bundle).

export const DAY_MS = 86_400_000;

export function priceDecimals(price: number): number {
  if (price >= 1) return 2;
  if (price >= 0.01) return 4;
  return 6;
}

export function formatPrice(price: number, decimals?: number): string {
  const d = decimals ?? priceDecimals(price);
  return price.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function formatCompact(value: number): string {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatAmount(amount: number): string {
  if (amount >= 1000) return amount.toFixed(2);
  if (amount >= 1) return amount.toFixed(3);
  if (amount >= 0.01) return amount.toFixed(4);
  return amount.toFixed(6);
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---- CSV helpers ------------------------------------------------------------

export function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface TradeCsvRow {
  id: string;
  status: "open" | "closed";
  datetime: number;
  market: string;
  side: "buy" | "sell";
  amount: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number;
  pnlPct: number;
  result: "win" | "loss" | null;
  agentId: string | null;
  source: "seed" | "agent" | "bot" | "manual" | "paper";
}

export function tradesToCsv(trades: TradeCsvRow[]): string {
  const header = [
    "ID",
    "Status",
    "Datetime",
    "Market",
    "Side",
    "Amount",
    "Entry Price",
    "Exit Price",
    "PnL",
    "PnL %",
    "Result",
    "Agent",
    "Source",
  ];
  const rows = trades.map((t) =>
    [
      t.id,
      t.status,
      formatDateTime(t.datetime),
      t.market,
      t.side,
      t.amount.toFixed(2),
      t.entryPrice.toString(),
      t.exitPrice != null ? t.exitPrice.toString() : "",
      t.pnl.toFixed(2),
      t.pnlPct.toFixed(2),
      t.result ?? "",
      t.agentId ?? "",
      t.source,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.map(csvEscape).join(","), ...rows].join("\n");
}

export interface AgentCsvRow {
  name: string;
  strategy: string;
  status: string;
  winRate: number;
  totalTrades: number;
  pnl: number;
  selfImprovements: number;
  confidence: number;
  lastImprovement: {
    timestamp: number;
    parameterChange: string;
  } | null;
}

export function agentsToCsv(agents: AgentCsvRow[]): string {
  const header = [
    "Agent",
    "Strategy",
    "Status",
    "Win Rate %",
    "Total Trades",
    "PnL",
    "Self-Improvements",
    "Confidence %",
    "Last Improvement",
  ];
  const rows = agents.map((a) =>
    [
      a.name,
      a.strategy,
      a.status,
      a.winRate.toFixed(1),
      a.totalTrades.toString(),
      a.pnl.toFixed(2),
      a.selfImprovements.toString(),
      a.confidence.toString(),
      a.lastImprovement
        ? `${formatDateTime(a.lastImprovement.timestamp)} ${a.lastImprovement.parameterChange}`
        : "",
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.map(csvEscape).join(","), ...rows].join("\n");
}
