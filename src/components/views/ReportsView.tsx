"use client";

import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  CalendarRange,
  Download,
  FileText,
  Table,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DAY_MS,
  DEMO_NOW,
  INITIAL_REPORTS,
  agentsToCsv,
  formatDate,
  formatDateTime,
  formatMoney,
  tradesToCsv,
  useAgents,
  useTrades,
  type ReportFile,
  type Trade,
} from "@/lib/mockData";

type ReportType = "daily" | "weekly" | "trade-history" | "agent-performance";

interface ReportTypeDef {
  id: ReportType;
  title: string;
  description: string;
  ext: "PDF" | "CSV";
  icon: LucideIcon;
}

const REPORT_TYPES: ReportTypeDef[] = [
  {
    id: "daily",
    title: "Daily Report",
    description: "Today's trades, P&L summary, win/loss breakdown.",
    ext: "PDF",
    icon: FileText,
  },
  {
    id: "weekly",
    title: "Weekly Summary",
    description: "7-day performance with charts and stats.",
    ext: "PDF",
    icon: CalendarRange,
  },
  {
    id: "trade-history",
    title: "Trade History",
    description: "All trades exportable as spreadsheet.",
    ext: "CSV",
    icon: Table,
  },
  {
    id: "agent-performance",
    title: "Agent Performance",
    description: "Per-agent stats and improvement logs.",
    ext: "CSV",
    icon: Bot,
  },
];

function toDateInput(ms: number): string {
  return formatDate(ms);
}

function parseDateInput(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

function filterTradesByRange(trades: Trade[], fromMs: number, toMs: number): Trade[] {
  const endOfDay = toMs + DAY_MS - 1;
  return trades.filter((t) => t.datetime >= fromMs && t.datetime <= endOfDay);
}

export const ReportsView = memo(function ReportsView() {
  const trades = useTrades();
  const agents = useAgents();

  const defaultTo = DEMO_NOW;
  const defaultFrom = DEMO_NOW - 6 * DAY_MS;
  const [from, setFrom] = useState(toDateInput(defaultFrom));
  const [to, setTo] = useState(toDateInput(defaultTo));
  const [selected, setSelected] = useState<ReportType>("daily");
  const [recent, setRecent] = useState<ReportFile[]>(INITIAL_REPORTS);
  const [printContent, setPrintContent] = useState<React.ReactNode>(null);

  const fromMs = parseDateInput(from);
  const toMs = parseDateInput(to);

  const rangeTrades = useMemo(
    () => filterTradesByRange(trades, fromMs, toMs),
    [trades, fromMs, toMs],
  );

  const summary = useMemo(() => {
    const closed = rangeTrades.filter((t) => t.status === "closed");
    const wins = closed.filter((t) => t.result === "win");
    const losses = closed.filter((t) => t.result === "loss");
    const pnl = closed.reduce((s, t) => s + t.pnl, 0);
    return {
      totalTrades: rangeTrades.length,
      closed: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
      pnl,
      amountWin: wins.reduce((s, t) => s + t.pnl, 0),
      amountLoss: losses.reduce((s, t) => s + Math.abs(t.pnl), 0),
    };
  }, [rangeTrades]);

  const agentStats = useMemo(
    () =>
      agents.map((a) => {
        const agentTrades = rangeTrades.filter(
          (t) => t.agentId === a.id && t.status === "closed",
        );
        const wins = agentTrades.filter((t) => t.result === "win").length;
        const pnl = agentTrades.reduce((s, t) => s + t.pnl, 0);
        return {
          name: a.name,
          strategy: a.strategy,
          totalTrades: agentTrades.length,
          winRate:
            agentTrades.length > 0
              ? (wins / agentTrades.length) * 100
              : 0,
          pnl,
          improvements: a.selfImprovements,
          confidence: a.confidence,
        };
      }),
    [agents, rangeTrades],
  );

  function buildFilename(type: ReportType): string {
    const f = formatDate(fromMs);
    const t = formatDate(toMs);
    switch (type) {
      case "daily":
        return `daily-report-${t}.pdf`;
      case "weekly":
        return `weekly-summary-${f}_to_${t}.pdf`;
      case "trade-history":
        return `trade-history-${f}_to_${t}.csv`;
      case "agent-performance":
        return `agent-performance-${f}_to_${t}.csv`;
    }
  }

  function downloadCsv(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function recordReport(type: ReportType, filename: string) {
    const ext = REPORT_TYPES.find((r) => r.id === type)?.ext ?? "PDF";
    const entry: ReportFile = {
      id: `r-${Date.now()}`,
      name: filename,
      type: ext,
      generatedAt: DEMO_NOW,
      size: ext === "PDF" ? `${120 + Math.floor(Math.random() * 300)} KB` : `${8 + Math.floor(Math.random() * 40)} KB`,
    };
    setRecent((prev) => [entry, ...prev].slice(0, 12));
  }

  function generate() {
    const def = REPORT_TYPES.find((r) => r.id === selected);
    if (!def) return;
    const filename = buildFilename(selected);
    if (def.ext === "CSV") {
      const csv =
        selected === "trade-history"
          ? tradesToCsv(rangeTrades)
          : agentsToCsv(
              agentStats.map((a) => ({
                name: a.name,
                strategy: a.strategy,
                status: "active",
                winRate: a.winRate,
                totalTrades: a.totalTrades,
                pnl: a.pnl,
                selfImprovements: a.improvements,
                confidence: a.confidence,
                lastImprovement: null,
              })),
            );
      downloadCsv(filename, csv);
      toast.success(`${def.title} downloaded`, {
        description: filename,
      });
    } else {
      // PDF: populate the hidden print area and trigger window.print().
      const title =
        selected === "daily" ? "Daily Trading Report" : "Weekly Summary Report";
      setPrintContent(
        <PrintReport
          title={title}
          fromLabel={formatDate(fromMs)}
          toLabel={formatDate(toMs)}
          summary={summary}
          trades={rangeTrades.slice(0, selected === "daily" ? 40 : 80)}
          agents={agentStats}
        />,
      );
      // Defer print so React can flush the print-area into the DOM.
      setTimeout(() => {
        window.print();
        toast.success("Print dialog opened", {
          description: "Choose 'Save as PDF' to download the report.",
        });
      }, 80);
    }
    recordReport(selected, filename);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Reports
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Generate and download PDF / CSV reports from your trading data.
          </p>
        </div>
        <Button
          onClick={generate}
          className="bg-[var(--bull)] text-[#0a0e17] hover:bg-[var(--bull)]/90"
        >
          <Download className="size-4" /> Generate Report
        </Button>
      </header>

      {/* Report type cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {REPORT_TYPES.map((r) => {
          const Icon = r.icon;
          const isActive = selected === r.id;
          const accent =
            r.ext === "PDF" ? "text-[#4f9cf9]" : "text-[var(--bull)]";
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all animate-fade-in-up",
                isActive
                  ? "border-[var(--bull)]/60 bg-[#11161f] shadow-[0_0_0_1px_rgba(22,199,132,0.3)]"
                  : "border-[var(--panel-border)] bg-[#0d1117] hover:border-[var(--panel-border)] hover:bg-[#11161f]",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md",
                    r.ext === "PDF"
                      ? "bg-[#4f9cf9]/10"
                      : "bg-[var(--bull)]/10",
                  )}
                >
                  <Icon className={cn("size-5", accent)} />
                </div>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    r.ext === "PDF"
                      ? "bg-[#4f9cf9]/15 text-[#4f9cf9]"
                      : "bg-[var(--bull)]/15 text-[var(--bull)]",
                  )}
                >
                  {r.ext}
                </span>
              </div>
              <h3 className="text-sm font-bold text-foreground">{r.title}</h3>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {r.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Date range */}
      <div className="mt-4 rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground">
          Date Range
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">From</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-full border-[var(--panel-border)] bg-[#0a0e17] font-mono text-sm text-foreground sm:w-44"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">To</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-full border-[var(--panel-border)] bg-[#0a0e17] font-mono text-sm text-foreground sm:w-44"
            />
          </label>
          <span className="mt-5 hidden text-xs text-muted-foreground sm:inline">
            {rangeTrades.length} trades in range
          </span>
        </div>
      </div>

      {/* Preview */}
      <div className="mt-4 rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Preview
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {REPORT_TYPES.find((r) => r.id === selected)?.title}
          </span>
        </div>
        {selected === "trade-history" || selected === "agent-performance" ? (
          <CsvPreview
            type={selected}
            trades={rangeTrades}
            agents={agentStats}
          />
        ) : (
          <PdfPreview summary={summary} agents={agentStats} trades={rangeTrades} />
        )}
      </div>

      {/* Recent reports */}
      <div className="mt-4 rounded-xl border border-[var(--panel-border)] bg-[#0d1117] animate-fade-in-up">
        <div className="border-b border-[var(--panel-border)] px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Recent Reports
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--panel-border)] text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Filename</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Generated</th>
                <th className="px-3 py-2 text-right font-medium">Size</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--panel-border)]/50 hover:bg-[#11161f]"
                >
                  <td className="px-3 py-2 font-mono text-foreground">
                    {r.name}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        r.type === "PDF"
                          ? "bg-[#4f9cf9]/15 text-[#4f9cf9]"
                          : "bg-[var(--bull)]/15 text-[var(--bull)]",
                      )}
                    >
                      {r.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground tabular-nums">
                    {formatDateTime(r.generatedAt)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground tabular-nums">
                    {r.size}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        toast("Report re-download started", {
                          description: r.name,
                        })
                      }
                      className="h-6 border-[var(--panel-border)] bg-[#0a0e17] px-2 text-[10px] font-semibold hover:bg-[#11161f]"
                    >
                      <Download className="size-3" /> Download
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hidden printable area (only visible during window.print()) */}
      <div className="print-only" aria-hidden="true">
        {printContent}
      </div>
    </div>
  );
});

// ---- Previews --------------------------------------------------------------

function CsvPreview({
  type,
  trades,
  agents,
}: {
  type: ReportType;
  trades: Trade[];
  agents: Array<{
    name: string;
    strategy: string;
    totalTrades: number;
    winRate: number;
    pnl: number;
    improvements: number;
    confidence: number;
  }>;
}) {
  if (type === "trade-history") {
    const rows = trades.slice(0, 8);
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-[var(--panel-border)] text-[9px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Datetime</th>
              <th className="px-2 py-1.5 font-medium">Market</th>
              <th className="px-2 py-1.5 font-medium">Side</th>
              <th className="px-2 py-1.5 text-right font-medium">Amount</th>
              <th className="px-2 py-1.5 text-right font-medium">P&amp;L</th>
              <th className="px-2 py-1.5 text-right font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-[var(--panel-border)]/40">
                <td className="px-2 py-1.5 font-mono text-muted-foreground tabular-nums">
                  {formatDateTime(t.datetime)}
                </td>
                <td className="px-2 py-1.5 font-mono font-medium">{t.market}</td>
                <td
                  className={cn(
                    "px-2 py-1.5 font-medium",
                    t.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]",
                  )}
                >
                  {t.side === "buy" ? "Buy" : "Sell"}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  ${t.amount.toFixed(2)}
                </td>
                <td
                  className={cn(
                    "px-2 py-1.5 text-right font-mono tabular-nums",
                    t.status === "open"
                      ? "text-muted-foreground"
                      : t.pnl >= 0
                        ? "text-[var(--bull)]"
                        : "text-[var(--bear)]",
                  )}
                >
                  {t.status === "open" ? "--" : formatMoney(t.pnl)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {t.status === "open"
                    ? "Open"
                    : t.result === "win"
                      ? "Win"
                      : "Loss"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Showing {rows.length} of {trades.length} rows. Full CSV will contain
          all columns (ID, status, entry/exit price, P&L %, agent, source).
        </p>
      </div>
    );
  }
  // agent-performance
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[11px]">
        <thead>
          <tr className="border-b border-[var(--panel-border)] text-[9px] uppercase tracking-wider text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Agent</th>
            <th className="px-2 py-1.5 font-medium">Strategy</th>
            <th className="px-2 py-1.5 text-right font-medium">Trades</th>
            <th className="px-2 py-1.5 text-right font-medium">Win Rate</th>
            <th className="px-2 py-1.5 text-right font-medium">P&amp;L</th>
            <th className="px-2 py-1.5 text-right font-medium">Improv.</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.name} className="border-b border-[var(--panel-border)]/40">
              <td className="px-2 py-1.5 font-medium">{a.name}</td>
              <td className="px-2 py-1.5 text-muted-foreground">{a.strategy}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                {a.totalTrades}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[var(--bull)]">
                {a.winRate.toFixed(1)}%
              </td>
              <td
                className={cn(
                  "px-2 py-1.5 text-right font-mono tabular-nums",
                  a.pnl >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]",
                )}
              >
                {formatMoney(a.pnl)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                {a.improvements}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PdfPreview({
  summary,
  agents,
}: {
  summary: {
    totalTrades: number;
    closed: number;
    wins: number;
    losses: number;
    winRate: number;
    pnl: number;
    amountWin: number;
    amountLoss: number;
  };
  agents: Array<{
    name: string;
    pnl: number;
    winRate: number;
    totalTrades: number;
  }>;
  trades: Trade[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Total Trades
        </div>
        <div className="mt-1 font-mono text-xl font-bold text-foreground tabular-nums">
          {summary.totalTrades}
        </div>
      </div>
      <div className="rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Win Rate
        </div>
        <div className="mt-1 font-mono text-xl font-bold text-[var(--bull)] tabular-nums">
          {summary.winRate.toFixed(1)}%
        </div>
      </div>
      <div className="rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Net P&amp;L
        </div>
        <div
          className={cn(
            "mt-1 font-mono text-xl font-bold tabular-nums",
            summary.pnl >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]",
          )}
        >
          {formatMoney(summary.pnl)}
        </div>
      </div>
      <div className="rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Wins / Losses
        </div>
        <div className="mt-1 font-mono text-xl font-bold tabular-nums">
          <span className="text-[var(--bull)]">{summary.wins}</span>
          <span className="text-muted-foreground"> / </span>
          <span className="text-[var(--bear)]">{summary.losses}</span>
        </div>
      </div>
      <div className="col-span-2 rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-3 sm:col-span-4">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Top Agents
        </div>
        <div className="flex flex-wrap gap-3">
          {agents
            .slice()
            .sort((a, b) => b.pnl - a.pnl)
            .slice(0, 3)
            .map((a) => (
              <div key={a.name} className="text-[11px]">
                <span className="font-semibold text-foreground">{a.name}</span>
                <span className="ml-2 font-mono text-muted-foreground tabular-nums">
                  {a.winRate.toFixed(0)}% / {formatMoney(a.pnl)}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ---- Printable PDF report --------------------------------------------------

function PrintReport({
  title,
  fromLabel,
  toLabel,
  summary,
  trades,
  agents,
}: {
  title: string;
  fromLabel: string;
  toLabel: string;
  summary: {
    totalTrades: number;
    closed: number;
    wins: number;
    losses: number;
    winRate: number;
    pnl: number;
    amountWin: number;
    amountLoss: number;
  };
  trades: Trade[];
  agents: Array<{
    name: string;
    strategy: string;
    totalTrades: number;
    winRate: number;
    pnl: number;
    improvements: number;
    confidence: number;
  }>;
}) {
  return (
    <div className="print-root">
      <div className="print-header">
        <h1>{title}</h1>
        <p className="print-sub">
          Z TERMINAL | {fromLabel} to {toLabel}
        </p>
      </div>
      <table className="print-stats">
        <tbody>
          <tr>
            <th>Total Trades</th>
            <td>{summary.totalTrades}</td>
            <th>Closed</th>
            <td>{summary.closed}</td>
          </tr>
          <tr>
            <th>Wins</th>
            <td>{summary.wins}</td>
            <th>Losses</th>
            <td>{summary.losses}</td>
          </tr>
          <tr>
            <th>Win Rate</th>
            <td>{summary.winRate.toFixed(1)}%</td>
            <th>Net P&amp;L</th>
            <td>{formatMoney(summary.pnl)}</td>
          </tr>
          <tr>
            <th>Amount Won</th>
            <td>{formatMoney(summary.amountWin)}</td>
            <th>Amount Lost</th>
            <td>{formatMoney(summary.amountLoss)}</td>
          </tr>
        </tbody>
      </table>
      <h2 className="print-section">Trade History</h2>
      <table className="print-table">
        <thead>
          <tr>
            <th>Datetime</th>
            <th>Market</th>
            <th>Side</th>
            <th className="right">Amount</th>
            <th className="right">Entry</th>
            <th className="right">Exit</th>
            <th className="right">P&amp;L</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td>{formatDateTime(t.datetime)}</td>
              <td>{t.market}</td>
              <td>{t.side === "buy" ? "Buy" : "Sell"}</td>
              <td className="right">${t.amount.toFixed(2)}</td>
              <td className="right">{t.entryPrice.toFixed(2)}</td>
              <td className="right">
                {t.exitPrice != null ? t.exitPrice.toFixed(2) : "--"}
              </td>
              <td className="right">
                {t.status === "open" ? "--" : formatMoney(t.pnl)}
              </td>
              <td>
                {t.status === "open"
                  ? "Open"
                  : t.result === "win"
                    ? "Win"
                    : "Loss"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="print-section">Agent Performance</h2>
      <table className="print-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Strategy</th>
            <th className="right">Trades</th>
            <th className="right">Win Rate</th>
            <th className="right">P&amp;L</th>
            <th className="right">Improvements</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.name}>
              <td>{a.name}</td>
              <td>{a.strategy}</td>
              <td className="right">{a.totalTrades}</td>
              <td className="right">{a.winRate.toFixed(1)}%</td>
              <td className="right">{formatMoney(a.pnl)}</td>
              <td className="right">{a.improvements}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="print-footer">
        Generated by Z Terminal v1.0.0 | All data is simulated for demonstration.
      </p>
    </div>
  );
}
