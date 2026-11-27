"use client";

import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, X } from "lucide-react";
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
  formatMoney,
  useAgents,
  useStore,
  useTrades,
  type AgentView,
} from "@/lib/mockData";

// ---- Sparkline -------------------------------------------------------------

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

// ---- Status badge ----------------------------------------------------------

function StatusBadge({ status }: { status: AgentView["status"] }) {
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

// ---- Confidence bar --------------------------------------------------------

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

// ---- Agent card ------------------------------------------------------------

function AgentCard({
  agent,
  onView,
}: {
  agent: AgentView;
  onView: (id: string) => void;
}) {
  const Icon = agent.icon;
  const toggleStatus = useStore((s) => s.toggleAgentStatus);
  const sparkPositive = agent.sparkline[agent.sparkline.length - 1] >= (agent.sparkline[0] ?? 0);
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
            <p className="text-[11px] text-muted-foreground">
              {agent.strategy}
            </p>
          </div>
        </div>
        <StatusBadge status={agent.status} />
      </div>

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
          </p>
        )}
      </div>

      {/* Sparkline */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Last 20 trades P&amp;L
          </span>
        </div>
        <Sparkline values={agent.sparkline} positive={sparkPositive} width={280} height={36} />
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
  );
}

// ---- Details drawer --------------------------------------------------------

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
                  Cumulative performance (last 20)
                </div>
                <Sparkline
                  values={agent.sparkline}
                  positive={
                    agent.sparkline[agent.sparkline.length - 1] >=
                    (agent.sparkline[0] ?? 0)
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
                      No improvements logged yet.
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
                        <span className="rounded bg-[#4f9cf9]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#4f9cf9]">
                          +{entry.confidenceDelta}% conf
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
                            {t.status === "open"
                              ? "--"
                              : formatMoney(t.pnl)}
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

// ---- Deploy modal ----------------------------------------------------------

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
            Configure a new self-improving trading agent. (Demo only -- no agent
            is actually deployed.)
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
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Risk Level
            </span>
            <select
              className="h-9 rounded-md border border-[var(--panel-border)] bg-[#0a0e17] px-2 text-sm text-foreground outline-none"
              defaultValue="med"
            >
              <option value="low">Low</option>
              <option value="med">Medium</option>
              <option value="high">High</option>
            </select>
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
              toast.success("Agent deployment queued (demo)", {
                description: "The new agent will appear once provisioning completes.",
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

// ---- Strategies table ------------------------------------------------------

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

const STRATEGIES: StrategyRow[] = [
  { id: "s1", name: "Trend Following v3", type: "Momentum", risk: "Med", agent: "Momentum Hunter", pnl24h: 84.2, winRate: 64, status: "Active" },
  { id: "s2", name: "Mean Reversion v2", type: "Reversion", risk: "Low", agent: "Mean Reverter", pnl24h: -22.5, winRate: 58, status: "Active" },
  { id: "s3", name: "Sentiment Pulse", type: "Sentiment", risk: "High", agent: "Sentiment Scalper", pnl24h: 142.8, winRate: 71, status: "Active" },
  { id: "s4", name: "Breakout Hunter", type: "Breakout", risk: "Med", agent: "Breakout Sniper", pnl24h: 38.6, winRate: 62, status: "Active" },
  { id: "s5", name: "Stat Arb Pairs", type: "Arbitrage", risk: "Low", agent: "Arbitrage Detector", pnl24h: 96.4, winRate: 77, status: "Active" },
  { id: "s6", name: "Grid Bot Legacy", type: "Grid", risk: "Low", agent: "--", pnl24h: 12.0, winRate: 55, status: "Archived" },
];

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

// ---- Main view -------------------------------------------------------------

export const AgentsView = memo(function AgentsView() {
  const agents = useAgents();
  const [selected, setSelected] = useState<string | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Agents &amp; Strategies
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Self-improving trading agents with live iteration logs.
          </p>
        </div>
        <Button
          onClick={() => setDeployOpen(true)}
          className="bg-[var(--bull)] text-[#0a0e17] hover:bg-[var(--bull)]/90"
        >
          <Plus className="size-4" /> Deploy New Agent
        </Button>
      </header>

      {/* Agent roster */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} onView={setSelected} />
        ))}
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
                {STRATEGIES.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-[var(--panel-border)]/50 hover:bg-[#11161f]"
                  >
                    <td className="px-3 py-2 font-medium text-foreground">
                      {s.name}
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
                      {s.winRate}%
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AgentDetailsDrawer agentId={selected} onClose={() => setSelected(null)} />
      <DeployAgentModal open={deployOpen} onOpenChange={setDeployOpen} />
    </div>
  );
});
