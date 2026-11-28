"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Brain,
  BrainCircuit,
  Clock,
  Crosshair,
  FlaskConical,
  Layers,
  Loader2,
  MessageSquare,
  Newspaper,
  Plus,
  Radar,
  Radio,
  RefreshCw,
  Ruler,
  ScanSearch,
  Shield,
  ShieldAlert,
  Shuffle,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  formatTime,
} from "@/lib/format";
import {
  useAgentStore,
  useAgents,
  useAgentSignals,
  useLastConsensus,
  useDiscussion,
} from "@/lib/agents/agentStore";
import { formatProfitFactor } from "@/lib/agents/performance";
import type { AgentPerformance } from "@/lib/agents/types";
import { useTrades } from "@/lib/tradeStore";
import type { AgentCore, AgentSignal } from "@/lib/agents/types";
import type { LucideIcon } from "lucide-react";

// Specialist agent ids — these never vote on direction; they supply SL / TP /
// risk / pip / alert metrics instead. The AgentsView groups them separately
// and surfaces their aggregated recommendations in the Specialist
// Recommendations panel.
const SPECIALIST_AGENT_IDS = new Set<string>([
  "stopLoss",
  "stopWin",
  "risk",
  "pip",
  "alert",
]);

function isSpecialist(agent: AgentCore): boolean {
  return SPECIALIST_AGENT_IDS.has(agent.id);
}

// ---- Strategy version badge ---------------------------------------------

function StrategyVersionBadge({ version }: { version: string }) {
  // Extract the short tag after the leading prefix (e.g. "momentum-v1.2" -> "v1.2").
  const shortTag = version.includes("-") ? version.split("-").pop() ?? version : version;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-white/5 text-muted-foreground"
      title={`Strategy version: ${version}`}
    >
      {shortTag}
    </span>
  );
}

// ---- Backtest modal ------------------------------------------------------

interface BacktestResultData {
  agentId: string;
  symbol: string;
  interval: string;
  trades: Array<{
    id: string;
    side: "buy" | "sell";
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    result: "win" | "loss" | null;
    holdTimeMs: number | null;
    datetime: number;
  }>;
  performance: AgentPerformance;
  equity: number[];
  candlesAnalyzed: number;
  notional: number;
}

function BacktestModal({
  open,
  onOpenChange,
  agent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agent: AgentCore | null;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("15m");

  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setResult(null);
        setError(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  async function runBacktest() {
    if (!agent) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const url = `/api/agents/backtest?agentId=${encodeURIComponent(agent.id)}&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { ok?: boolean; result?: BacktestResultData };
      if (!data.result) throw new Error("Backtest returned no result");
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[var(--panel-border)] bg-[#0d1117] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="size-4 text-[#4f9cf9]" />
            Backtest: {agent?.name ?? "Agent"}
            {agent && <StrategyVersionBadge version={agent.strategyVersion} />}
          </DialogTitle>
          <DialogDescription>
            Run the agent's strategy on historical Binance candles. The
            backtest is read-only — no orders are placed.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Symbol
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="h-8 rounded-md border border-[var(--panel-border)] bg-[#0a0e17] px-2 font-mono text-xs text-foreground"
              >
                <option value="BTCUSDT">BTCUSDT</option>
                <option value="ETHUSDT">ETHUSDT</option>
                <option value="SOLUSDT">SOLUSDT</option>
                <option value="BNBUSDT">BNBUSDT</option>
                <option value="XRPUSDT">XRPUSDT</option>
                <option value="ADAUSDT">ADAUSDT</option>
                <option value="DOGEUSDT">DOGEUSDT</option>
                <option value="AVAXUSDT">AVAXUSDT</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Interval
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="h-8 rounded-md border border-[var(--panel-border)] bg-[#0a0e17] px-2 font-mono text-xs text-foreground"
              >
                <option value="1m">1m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1H">1H</option>
                <option value="4H">4H</option>
                <option value="1D">1D</option>
                <option value="1W">1W</option>
              </select>
            </label>
            <Button
              onClick={runBacktest}
              disabled={loading}
              size="sm"
              className="bg-[var(--bull)] text-[#0a0e17] hover:bg-[var(--bull)]/90"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FlaskConical className="size-3.5" />
              )}
              Run Backtest
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-2 text-[11px] text-[var(--bear)]">
              {error}
            </div>
          )}

          {result && (
            <BacktestResults result={result} />
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:bg-[#11161f] hover:text-foreground"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BacktestResults({ result }: { result: BacktestResultData }) {
  const p = result.performance;
  const sparkPositive =
    result.equity.length > 1
      ? result.equity[result.equity.length - 1] >= result.equity[0]
      : true;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <BacktestMetric label="Trades" value={String(p.totalTrades)} />
        <BacktestMetric label="Win Rate" value={`${p.winRate.toFixed(1)}%`} tone="bull" />
        <BacktestMetric
          label="Profit Factor"
          value={formatProfitFactor(p.profitFactor)}
        />
        <BacktestMetric
          label="Net P&L"
          value={formatMoney(p.totalPnl)}
          tone={p.totalPnl >= 0 ? "bull" : "bear"}
        />
        <BacktestMetric
          label="Max Drawdown"
          value={formatMoney(p.maxDrawdown)}
          tone="bear"
        />
        <BacktestMetric
          label="Sharpe"
          value={Number.isFinite(p.sharpeRatio) ? p.sharpeRatio.toFixed(2) : "--"}
        />
        <BacktestMetric
          label="Avg Hold"
          value={p.avgHoldTimeMs > 0 ? formatDuration(p.avgHoldTimeMs) : "--"}
        />
        <BacktestMetric
          label="Candles"
          value={String(result.candlesAnalyzed)}
        />
      </div>
      <div className="rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Equity Curve
        </div>
        {result.equity.length > 1 ? (
          <Sparkline
            values={result.equity}
            positive={sparkPositive}
            width={460}
            height={80}
          />
        ) : (
          <div className="flex h-20 items-center justify-center text-[11px] text-muted-foreground">
            No trades were closed during the backtest window.
          </div>
        )}
      </div>
      <div className="rounded-lg border border-[var(--panel-border)] bg-[#0a0e17]">
        <div className="border-b border-[var(--panel-border)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Simulated Trades ({result.trades.length})
        </div>
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[var(--panel-border)] text-[9px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Side</th>
                <th className="px-2 py-1.5 text-right font-medium">Entry</th>
                <th className="px-2 py-1.5 text-right font-medium">Exit</th>
                <th className="px-2 py-1.5 text-right font-medium">P&L</th>
                <th className="px-2 py-1.5 text-right font-medium">Hold</th>
                <th className="px-2 py-1.5 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {result.trades.map((t) => (
                <tr key={t.id} className="border-b border-[var(--panel-border)]/40">
                  <td className={cn("px-2 py-1.5 font-medium", t.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]")}>
                    {t.side === "buy" ? "Buy" : "Sell"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {t.entryPrice.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {t.exitPrice.toFixed(2)}
                  </td>
                  <td className={cn("px-2 py-1.5 text-right font-mono tabular-nums", t.pnl >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]")}>
                    {formatMoney(t.pnl)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                    {t.holdTimeMs != null ? formatDuration(t.holdTimeMs) : "--"}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {t.result === "win" ? (
                      <span className="text-[var(--bull)]">Win</span>
                    ) : (
                      <span className="text-[var(--bear)]">Loss</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BacktestMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear" | "neutral";
}) {
  const cls =
    tone === "bull"
      ? "text-[var(--bull)]"
      : tone === "bear"
        ? "text-[var(--bear)]"
        : "text-foreground";
  return (
    <div className="rounded-md border border-[var(--panel-border)] bg-[#0a0e17] p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono text-sm font-bold tabular-nums", cls)}>
        {value}
      </div>
    </div>
  );
}

// ---- Sparkline -----------------------------------------------------------

function Sparkline({
  values,
  positive,
  color,
  width = 120,
  height = 32,
}: {
  values: number[];
  positive: boolean;
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <div style={{ width, height }} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const path = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = color ?? (positive ? "#16c784" : "#ea3943");
  const fillId = `spark-${positive ? "up" : "down"}-${Math.round(width)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.3" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L${width},${height} L0,${height} Z`} fill={`url(#${fillId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---- Status badge --------------------------------------------------------

function StatusBadge({ status }: { status: AgentCore["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[var(--bull)]/15 text-[var(--bull)]">
        <span className="size-1.5 rounded-full bg-[var(--bull)]" /> Active
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[#f0b90b]/15 text-[#f0b90b]">
        <span className="size-1.5 rounded-full bg-[#f0b90b]" /> Paused
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[#4f9cf9]/15 text-[#4f9cf9]">
      <span className="size-1.5 animate-pulse rounded-full bg-[#4f9cf9]" /> Training
    </span>
  );
}

function MiniBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ---- Agent card ----------------------------------------------------------

function AgentCard({
  agent,
  onView,
  onBacktest,
}: {
  agent: AgentCore;
  onView: (id: string) => void;
  onBacktest: (agent: AgentCore) => void;
}) {
  const Icon: LucideIcon = agent.icon;
  const toggleStatus = useAgentStore((s) => s.toggleAgent);
  const resetAgent = useAgentStore((s) => s.resetAgent);
  const sparkPositive =
    agent.sparkline.length > 1
      ? agent.sparkline[agent.sparkline.length - 1] >= (agent.sparkline[0] ?? 0)
      : true;
  const lastSignal = agent.lastSignal;
  const signalColor =
    lastSignal?.action === "buy"
      ? "#16c784"
      : lastSignal?.action === "sell"
        ? "#ea3943"
        : "#8b949e";

  return (
    <div className="flex flex-col rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div
            className="flex size-10 items-center justify-center rounded-full"
            style={{ backgroundColor: `${agent.iconColor}1a`, color: agent.iconColor }}
          >
            <Icon className="size-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-foreground">
              {agent.name}
            </h3>
            <div className="mt-0.5 flex items-center gap-1.5">
              <p className="text-[11px] text-muted-foreground">
                {agent.strategy}
              </p>
              <StrategyVersionBadge version={agent.strategyVersion} />
            </div>
          </div>
        </div>
        <StatusBadge status={agent.status} />
      </div>

      {/* Current signal */}
      {lastSignal && (
        <div className="mt-3 rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isSpecialist(agent) ? "Specialist Read" : "Current Signal"}
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: `${signalColor}22`,
                color: signalColor,
              }}
            >
              {lastSignal.action.toUpperCase()} {lastSignal.confidence}%
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/85">
            {lastSignal.reasoning}
          </p>
          {lastSignal.indicators.length > 0 && (
            <div className="mt-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto pr-1">
              {lastSignal.indicators.map((ind) => (
                <span
                  key={ind.name}
                  className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-muted-foreground"
                  title={`${ind.name}: ${ind.value}`}
                >
                  {ind.name}: {ind.value}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Win Rate
          </div>
          <div className="mt-0.5 font-mono text-sm font-bold text-[var(--bull)] tabular-nums">
            {agent.winRate.toFixed(1)}%
          </div>
          <div className="mt-1">
            <MiniBar value={agent.winRate} color="#16c784" />
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Trades
          </div>
          <div className="mt-0.5 font-mono text-sm font-bold text-foreground tabular-nums">
            {agent.totalTrades}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            P&amp;L
          </div>
          <div
            className={cn(
              "mt-0.5 font-mono text-sm font-bold tabular-nums",
              agent.pnl >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]",
            )}
          >
            {formatMoney(agent.pnl)}
          </div>
        </div>
      </div>

      {/* Performance metrics */}
      <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-2.5">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            Win Rate
          </div>
          <div className="mt-0.5 font-mono text-xs font-bold text-[var(--bull)] tabular-nums">
            {agent.performance.winRate.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            Profit Factor
          </div>
          <div className="mt-0.5 font-mono text-xs font-bold text-foreground tabular-nums">
            {formatProfitFactor(agent.performance.profitFactor)}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            Max DD
          </div>
          <div className="mt-0.5 font-mono text-xs font-bold text-[var(--bear)] tabular-nums">
            {formatMoney(agent.performance.maxDrawdown)}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            Sharpe
          </div>
          <div className="mt-0.5 font-mono text-xs font-bold text-foreground tabular-nums">
            {Number.isFinite(agent.performance.sharpeRatio)
              ? agent.performance.sharpeRatio.toFixed(2)
              : "--"}
          </div>
        </div>
      </div>

      {/* Self-improvement block */}
      <div className="mt-3 rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-[#4f9cf9]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
              Self-Improvement
            </span>
          </div>
          {agent.isLearning ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-[#4f9cf9]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#4f9cf9] animate-learning-pulse">
              <span className="size-1.5 rounded-full bg-[#4f9cf9]" /> Learning
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              {agent.selfImprovements} iterations
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Confidence</span>
          <span className="font-mono font-semibold text-foreground tabular-nums">
            {agent.confidence}%
          </span>
        </div>
        <div className="mt-1">
          <MiniBar value={agent.confidence} color="#4f9cf9" />
        </div>
        {agent.lastImprovement && (
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            <span className="font-mono text-foreground/70">
              {formatDateTime(agent.lastImprovement.timestamp)}
            </span>{" "}
            -- {agent.lastImprovement.parameterChange}
            <span
              className={cn(
                "ml-1 font-mono",
                agent.lastImprovement.confidenceDelta >= 0
                  ? "text-[var(--bull)]"
                  : "text-[var(--bear)]",
              )}
            >
              ({agent.lastImprovement.confidenceDelta >= 0 ? "+" : ""}
              {agent.lastImprovement.confidenceDelta}%)
            </span>
          </p>
        )}
      </div>

      {/* Sparkline */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Recent trades P&amp;L
          </span>
        </div>
        <Sparkline
          values={agent.sparkline.length > 1 ? agent.sparkline : [0, 0]}
          positive={sparkPositive}
          width={280}
          height={36}
        />
      </div>

      {/* Footer controls */}
      <div className="mt-3 flex items-center justify-between border-t border-[var(--panel-border)] pt-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={agent.status === "active"}
            onCheckedChange={() => toggleStatus(agent.id)}
            aria-label="Toggle agent active"
          />
          <span className="text-[11px] text-muted-foreground">
            {agent.status === "active" ? "Running" : "Paused"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => resetAgent(agent.id)}
            title="Reset agent to defaults"
            className="h-7 px-2 text-[10px] font-semibold text-muted-foreground hover:bg-[#11161f] hover:text-foreground"
          >
            <RefreshCw className="size-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBacktest(agent)}
            title="Run historical backtest"
            className="h-7 border-[var(--panel-border)] bg-[#0a0e17] px-3 text-[11px] font-semibold hover:bg-[#11161f]"
          >
            <FlaskConical className="size-3" /> Backtest
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onView(agent.id)}
            className="h-7 border-[var(--panel-border)] bg-[#0a0e17] px-3 text-[11px] font-semibold hover:bg-[#11161f]"
          >
            View Details
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Details drawer ------------------------------------------------------

function AgentDetailsDrawer({
  agentId,
  onClose,
}: {
  agentId: string | null;
  onClose: () => void;
}) {
  const agents = useAgents();
  const trades = useTrades();
  const agent = useMemo(
    () => agents.find((a) => a.id === agentId) ?? null,
    [agents, agentId],
  );
  const agentTrades = useMemo(
    () =>
      agent
        ? trades
            .filter((t) => t.agentId === agent.id)
            .sort((a, b) => b.datetime - a.datetime)
        : [],
    [trades, agent],
  );

  return (
    <Sheet open={agentId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full border-l border-[var(--panel-border)] bg-[#0a0e17] p-0 sm:max-w-xl"
      >
        <SheetTitle className="sr-only">Agent details</SheetTitle>
        {agent && (
          <div className="flex h-full flex-col">
            {/* Drawer header */}
            <div className="flex items-start justify-between gap-3 border-b border-[var(--panel-border)] p-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex size-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${agent.iconColor}1a`, color: agent.iconColor }}
                >
                  <agent.icon className="size-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">
                    {agent.name}
                  </h2>
                  <p className="text-[11px] text-muted-foreground">
                    {agent.strategy}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                onClick={onClose}
                aria-label="Close details"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Metrics grid */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Win Rate
                  </div>
                  <div className="mt-1 font-mono text-base font-bold text-[var(--bull)] tabular-nums">
                    {agent.winRate.toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Trades
                  </div>
                  <div className="mt-1 font-mono text-base font-bold text-foreground tabular-nums">
                    {agent.totalTrades}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    P&amp;L
                  </div>
                  <div
                    className={cn(
                      "mt-1 font-mono text-base font-bold tabular-nums",
                      agent.pnl >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]",
                    )}
                  >
                    {formatMoney(agent.pnl)}
                  </div>
                </div>
              </div>

              {/* Performance sparkline */}
              <div className="mt-3 rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Cumulative performance
                </div>
                <Sparkline
                  values={agent.sparkline.length > 1 ? agent.sparkline : [0, 0]}
                  positive={
                    agent.sparkline.length > 1
                      ? agent.sparkline[agent.sparkline.length - 1] >=
                        (agent.sparkline[0] ?? 0)
                      : true
                  }
                  width={460}
                  height={60}
                />
              </div>

              {/* Self-improvement log */}
              <div className="mt-3 rounded-lg border border-[var(--panel-border)] bg-[#0d1117]">
                <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Self-Improvement Log
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {agent.improvementLog.length} entries
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto p-2">
                  {agent.improvementLog.length === 0 && (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                      No improvements logged yet. Agents self-correct after
                      losing trades.
                    </div>
                  )}
                  {agent.improvementLog.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-md px-2 py-2 transition-colors hover:bg-[#11161f]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                          {formatDateTime(entry.timestamp)}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            entry.confidenceDelta >= 0
                              ? "bg-[var(--bull)]/15 text-[var(--bull)]"
                              : "bg-[var(--bear)]/15 text-[var(--bear)]",
                          )}
                        >
                          {entry.confidenceDelta >= 0 ? "+" : ""}
                          {entry.confidenceDelta}% conf
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-foreground/90">
                        <span className="text-muted-foreground">Trigger: </span>
                        {entry.trigger}
                      </p>
                      <p className="mt-0.5 text-[11px] text-foreground/90">
                        <span className="text-muted-foreground">Change: </span>
                        {entry.parameterChange}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        New confidence: {entry.newConfidence}%
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trade history */}
              <div className="mt-3 rounded-lg border border-[var(--panel-border)] bg-[#0d1117]">
                <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Trade History
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {agentTrades.length} trades
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-[var(--panel-border)] text-[9px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">Time</th>
                        <th className="px-2 py-1.5 font-medium">Market</th>
                        <th className="px-2 py-1.5 font-medium">Side</th>
                        <th className="px-2 py-1.5 text-right font-medium">P&amp;L</th>
                        <th className="px-2 py-1.5 text-right font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentTrades.slice(0, 40).map((t) => (
                        <tr
                          key={t.id}
                          className="border-b border-[var(--panel-border)]/40 hover:bg-[#11161f]"
                        >
                          <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                            {formatDateTime(t.datetime)}
                          </td>
                          <td className="px-2 py-1.5 font-mono font-medium">
                            {t.market}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1.5 font-medium",
                              t.side === "buy"
                                ? "text-[var(--bull)]"
                                : "text-[var(--bear)]",
                            )}
                          >
                            {t.side === "buy" ? "Buy" : "Sell"}
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
                            {t.status === "open" ? (
                              <span className="text-muted-foreground">Open</span>
                            ) : t.result === "win" ? (
                              <span className="text-[var(--bull)]">Win</span>
                            ) : (
                              <span className="text-[var(--bear)]">Loss</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---- Deploy modal --------------------------------------------------------

function DeployAgentModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[var(--panel-border)] bg-[#0d1117] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deploy New Agent</DialogTitle>
          <DialogDescription>
            The terminal ships with 5 pre-configured agents. Custom agent
            deployment is coming soon.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Agent Name
            </span>
            <Input
              placeholder="e.g. Volatility Surfer"
              className="border-[var(--panel-border)] bg-[#0a0e17] font-mono text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Strategy
            </span>
            <Input
              placeholder="e.g. Volatility Breakout"
              className="border-[var(--panel-border)] bg-[#0a0e17] font-mono text-sm"
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:bg-[#11161f] hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              toast.success("Agent deployment queued", {
                description: "Custom agents are coming in a future release.",
              });
            }}
            className="bg-[var(--bull)] text-[#0a0e17] hover:bg-[var(--bull)]/90"
          >
            Deploy Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Discussion + consensus panel ----------------------------------------

function ConsensusPanel() {
  const signals = useAgentSignals();
  const consensus = useLastConsensus();
  const discussion = useDiscussion();

  const buyVotes = consensus?.votes.filter((v) => v.action === "buy") ?? [];
  const sellVotes = consensus?.votes.filter((v) => v.action === "sell") ?? [];
  const buyWeight = buyVotes.reduce((s, v) => s + v.weight, 0);
  const sellWeight = sellVotes.reduce((s, v) => s + v.weight, 0);
  const totalWeight = buyWeight + sellWeight || 1;
  const buyPct = Math.round((buyWeight / totalWeight) * 100);
  const sellPct = 100 - buyPct;
  const decision = consensus?.decision ?? "hold";

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
      {/* Signals grid */}
      <div className="rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Current Signals
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {signals.length} agents reporting
          </span>
        </div>
        {signals.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            Open the Trading view to run agent analysis on live market data.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {signals.map((sig) => {
              const color =
                sig.action === "buy"
                  ? "#16c784"
                  : sig.action === "sell"
                    ? "#ea3943"
                    : "#8b949e";
              return (
                <div
                  key={sig.agentId}
                  className="rounded-md border border-[var(--panel-border)] bg-[#0a0e17] p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold text-foreground">
                      {sig.agentName}
                    </span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                      style={{ backgroundColor: `${color}22`, color }}
                    >
                      {sig.action.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, sig.confidence)}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {sig.confidence}%
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    {sig.reasoning}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Consensus + discussion */}
      <div className="flex flex-col gap-3">
        {/* Consensus verdict */}
        <div className="rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground">
            Consensus Result
          </h2>
          {!consensus ? (
            <p className="text-xs text-muted-foreground">
              No consensus yet — run analysis from the Trading view.
            </p>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "rounded px-2 py-1 text-xs font-bold uppercase tracking-wider",
                    decision === "buy"
                      ? "bg-[rgba(22,199,132,0.18)] text-[var(--bull)]"
                      : decision === "sell"
                        ? "bg-[rgba(234,57,67,0.18)] text-[var(--bear)]"
                        : "bg-white/5 text-muted-foreground",
                  )}
                >
                  {decision.toUpperCase()}
                </span>
                <span
                  className={cn(
                    "rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider",
                    consensus.passed
                      ? "bg-[var(--bull)]/15 text-[var(--bull)]"
                      : "bg-white/5 text-muted-foreground",
                  )}
                >
                  {consensus.passed ? "PASSED" : "WAITING"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Confidence</span>
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {consensus.totalConfidence}% / {consensus.threshold}%
                </span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full bg-[var(--bull)]"
                  style={{ width: `${buyPct}%` }}
                />
                <div
                  className="h-full bg-[var(--bear)]"
                  style={{ width: `${sellPct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px]">
                <span className="text-[var(--bull)]">BUY {buyPct}%</span>
                <span className="text-[var(--bear)]">SELL {sellPct}%</span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                {consensus.reason}
              </p>
            </div>
          )}
        </div>

        {/* Discussion thread */}
        <div className="rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="size-3.5 text-[#4f9cf9]" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Agent Discussion
            </h2>
          </div>
          <div className="max-h-72 overflow-y-auto pr-1">
            {discussion.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No messages yet — agents discuss after each analysis round.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {discussion.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-md border border-[var(--panel-border)] bg-[#0a0e17] px-2.5 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-foreground">
                        {m.fromAgentName}{" "}
                        <span className="text-muted-foreground">
                          {"-> "}
                          {m.toAgentName === "All" ? "All" : m.toAgentName}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                          m.agreement
                            ? "bg-[var(--bull)]/15 text-[var(--bull)]"
                            : "bg-[var(--bear)]/15 text-[var(--bear)]",
                        )}
                      >
                        {m.agreement ? "Agree" : "Disagree"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">
                      {m.message}
                    </p>
                    <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground tabular-nums">
                      {formatTime(m.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Main view -----------------------------------------------------------

const STRATEGY_ICON_MAP: Record<string, LucideIcon> = {
  Momentum: Radar,
  Reversion: RefreshCw,
  Sentiment: BrainCircuit,
  Breakout: Crosshair,
  Arbitrage: Shuffle,
  Signal: Radio,
  Strategy: Brain,
  Chart: ScanSearch,
  Composite: Layers,
  Time: Clock,
  Media: Newspaper,
  Risk: Shield,
  StopLoss: ShieldAlert,
  TakeProfit: Target,
  PIP: Ruler,
  Alert: Bell,
};

interface StrategyRow {
  id: string;
  name: string;
  type: string;
  risk: "Low" | "Med" | "High";
  agent: string;
  pnl24h: number;
  winRate: number;
  status: "Active" | "Archived";
}

function RiskBadge({ risk }: { risk: StrategyRow["risk"] }) {
  const cls =
    risk === "Low"
      ? "bg-[var(--bull)]/15 text-[var(--bull)]"
      : risk === "Med"
        ? "bg-[#f0b90b]/15 text-[#f0b90b]"
        : "bg-[var(--bear)]/15 text-[var(--bear)]";
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", cls)}>
      {risk}
    </span>
  );
}

// ---- Specialist Recommendations panel ------------------------------------

function SpecialistRecommendationsPanel({
  signals,
  consensus,
}: {
  signals: AgentSignal[];
  consensus: ReturnType<typeof useLastConsensus>;
}) {
  // Pull the SL / TP / risk score from the consensus execution params
  // (already pre-selected for the consensus direction).
  const sl = consensus?.executionParams?.stopLoss;
  const tp = consensus?.executionParams?.takeProfit;
  const riskScore = consensus?.executionParams?.riskScore;
  const decision = consensus?.decision ?? "hold";

  // Pull the latest signal from each specialist agent so we can show the
  // raw recommendation alongside the aggregated values.
  const stopLossSig = signals.find((s) => s.agentId === "stopLoss");
  const stopWinSig = signals.find((s) => s.agentId === "stopWin");
  const pipSig = signals.find((s) => s.agentId === "pip");
  const alertSig = signals.find((s) => s.agentId === "alert");

  const findInd = (sig: AgentSignal | undefined, name: string) =>
    sig?.indicators.find((i) => i.name === name)?.value;

  const slPct = findInd(stopLossSig, "SLPct");
  const tpPct = findInd(stopWinSig, "TPPct");
  const riskReward = findInd(stopWinSig, "RiskReward");
  const sessionPips = findInd(pipSig, "SessionPips");
  const atrPips = findInd(pipSig, "ATRPips");
  const buyAlerts = findInd(alertSig, "BuyAlerts");
  const sellAlerts = findInd(alertSig, "SellAlerts");
  const totalAlerts = findInd(alertSig, "TotalAlerts");

  const riskLevel =
    riskScore === undefined
      ? "--"
      : riskScore > 60
        ? "High"
        : riskScore > 30
          ? "Medium"
          : "Low";

  return (
    <div className="rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-[#ef4444]" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Specialist Recommendations
          </h2>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {decision !== "hold" ? `For ${decision.toUpperCase()} entry` : "Awaiting directional consensus"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SpecialistMetric
          label="Recommended Stop Loss"
          value={sl !== undefined ? `$${sl.toFixed(2)}` : "--"}
          sub={slPct !== undefined ? `${slPct.toFixed(2)}% risk` : undefined}
          tone="bear"
          icon={ShieldAlert}
        />
        <SpecialistMetric
          label="Recommended Take Profit"
          value={tp !== undefined ? `$${tp.toFixed(2)}` : "--"}
          sub={tpPct !== undefined ? `${tpPct.toFixed(2)}% target` : undefined}
          tone="bull"
          icon={Target}
        />
        <SpecialistMetric
          label="Market Risk Score"
          value={riskScore !== undefined ? `${riskScore}/100` : "--"}
          sub={riskLevel}
          tone={riskLevel === "High" ? "bear" : riskLevel === "Medium" ? "warn" : "bull"}
          icon={Shield}
        />
        <SpecialistMetric
          label="Risk : Reward"
          value={riskReward !== undefined ? `1 : ${riskReward.toFixed(2)}` : "--"}
          sub={riskReward !== undefined ? (riskReward >= 1.5 ? "favorable" : "tight") : undefined}
          tone="neutral"
          icon={Target}
        />
        <SpecialistMetric
          label="Session Pips"
          value={sessionPips !== undefined ? `${sessionPips.toFixed(0)}` : "--"}
          sub={sessionPips !== undefined ? (sessionPips > 0 ? "up" : "down") : undefined}
          tone={sessionPips === undefined ? "neutral" : sessionPips >= 0 ? "bull" : "bear"}
          icon={Ruler}
        />
        <SpecialistMetric
          label="ATR Pips"
          value={atrPips !== undefined ? atrPips.toFixed(1) : "--"}
          sub={atrPips !== undefined ? "per candle" : undefined}
          tone="neutral"
          icon={Ruler}
        />
        <SpecialistMetric
          label="Buy / Sell Alerts"
          value={buyAlerts !== undefined && sellAlerts !== undefined ? `${buyAlerts} / ${sellAlerts}` : "--"}
          sub={totalAlerts !== undefined ? `${totalAlerts} active` : undefined}
          tone={buyAlerts === undefined || sellAlerts === undefined ? "neutral" : buyAlerts > sellAlerts ? "bull" : "bear"}
          icon={Bell}
        />
        <SpecialistMetric
          label="Consensus Direction"
          value={decision.toUpperCase()}
          sub={consensus ? `${consensus.totalConfidence}% / ${consensus.threshold}%` : undefined}
          tone={decision === "buy" ? "bull" : decision === "sell" ? "bear" : "neutral"}
          icon={Radio}
        />
      </div>
    </div>
  );
}

function SpecialistMetric({
  label,
  value,
  sub,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bull" | "bear" | "warn" | "neutral";
  icon?: LucideIcon;
}) {
  const valueColor =
    tone === "bull"
      ? "text-[var(--bull)]"
      : tone === "bear"
        ? "text-[var(--bear)]"
        : tone === "warn"
          ? "text-[#f0b90b]"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-2.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono text-base font-bold tabular-nums", valueColor)}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}

export const AgentsView = memo(function AgentsView() {
  const agents = useAgents();
  const trades = useTrades();
  const signals = useAgentSignals();
  const consensus = useLastConsensus();
  const [selected, setSelected] = useState<string | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [backtestAgent, setBacktestAgent] = useState<AgentCore | null>(null);

  const directionalAgents = useMemo(
    () => agents.filter((a) => !SPECIALIST_AGENT_IDS.has(a.id)),
    [agents],
  );
  const specialistAgents = useMemo(
    () => agents.filter((a) => SPECIALIST_AGENT_IDS.has(a.id)),
    [agents],
  );

  // Build the strategies table from live agents (mirrors the historical
  // strategy list with real numbers).
  const strategies: StrategyRow[] = useMemo(() => {
    const now = Date.now();
    const dayStart = now - (now % 86_400_000);
    return agents.map((a) => {
      const agentTrades = trades.filter(
        (t) =>
          t.agentId === a.id &&
          t.status === "closed" &&
          t.datetime >= dayStart,
      );
      const pnl24h = agentTrades.reduce((s, t) => s + t.pnl, 0);
      const wins = agentTrades.filter((t) => t.result === "win").length;
      const winRate =
        agentTrades.length > 0 ? (wins / agentTrades.length) * 100 : 0;
      const risk: StrategyRow["risk"] =
        a.strategyType === "Arbitrage" ||
        a.strategyType === "Reversion" ||
        a.strategyType === "StopLoss" ||
        a.strategyType === "TakeProfit"
          ? "Low"
          : a.strategyType === "Sentiment" ||
              a.strategyType === "Breakout" ||
              a.strategyType === "Chart" ||
              a.strategyType === "Media"
            ? "High"
            : "Med";
      return {
        id: a.id,
        name: a.strategy,
        type: a.strategyType,
        risk,
        agent: a.name,
        pnl24h: Math.round(pnl24h * 100) / 100,
        winRate: Math.round(winRate * 10) / 10,
        status: a.status === "active" ? "Active" : "Archived",
      };
    });
  }, [agents, trades]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Agents &amp; Strategies
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Self-improving trading agents voting on live Binance market data.
          </p>
        </div>
        <Button
          onClick={() => setDeployOpen(true)}
          className="bg-[var(--bull)] text-[#0a0e17] hover:bg-[var(--bull)]/90"
        >
          <Plus className="size-4" /> Deploy New Agent
        </Button>
      </header>

      {/* Consensus + signals + discussion */}
      <ConsensusPanel />

      {/* Specialist recommendations (SL / TP / risk / pip / alert) */}
      <div className="mt-6">
        <SpecialistRecommendationsPanel signals={signals} consensus={consensus} />
      </div>

      {/* Directional agent roster */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            Directional Agents
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {directionalAgents.length} agents voting on buy / sell
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {directionalAgents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              onView={setSelected}
              onBacktest={setBacktestAgent}
            />
          ))}
        </div>
      </div>

      {/* Specialist agent roster */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            Specialist Agents
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {specialistAgents.length} agents supplying SL / TP / risk / pip / alerts
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {specialistAgents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              onView={setSelected}
              onBacktest={setBacktestAgent}
            />
          ))}
        </div>
      </div>

      {/* Strategies table */}
      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-foreground">
          Strategies
        </h2>
        <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] animate-fade-in-up">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--panel-border)] text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Risk</th>
                  <th className="px-3 py-2 font-medium">Assigned Agent</th>
                  <th className="px-3 py-2 text-right font-medium">24h P&amp;L</th>
                  <th className="px-3 py-2 text-right font-medium">Win Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((s) => {
                  const Icon = STRATEGY_ICON_MAP[s.type] ?? Radar;
                  return (
                    <tr
                      key={s.id}
                      className="border-b border-[var(--panel-border)]/50 hover:bg-[#11161f]"
                    >
                      <td className="px-3 py-2 font-medium text-foreground">
                        <span className="inline-flex items-center gap-2">
                          <Icon className="size-3.5 text-muted-foreground" />
                          {s.name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{s.type}</td>
                      <td className="px-3 py-2">
                        <RiskBadge risk={s.risk} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {s.agent}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-mono tabular-nums",
                          s.pnl24h >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]",
                        )}
                      >
                        {formatMoney(s.pnl24h)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground">
                        {s.winRate.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                            s.status === "Active"
                              ? "bg-[var(--bull)]/15 text-[var(--bull)]"
                              : "bg-white/5 text-muted-foreground",
                          )}
                        >
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AgentDetailsDrawer agentId={selected} onClose={() => setSelected(null)} />
      <DeployAgentModal open={deployOpen} onOpenChange={setDeployOpen} />
      <BacktestModal
        open={backtestAgent != null}
        onOpenChange={(o) => !o && setBacktestAgent(null)}
        agent={backtestAgent}
      />
    </div>
  );
});
