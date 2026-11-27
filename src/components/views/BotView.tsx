"use client";

import { memo, useMemo } from "react";
import { toast } from "sonner";
import {
  Activity,
  Clock,
  DollarSign,
  Radio,
  Shield,
  Target,
  Timer,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  DAY_MS,
  formatDuration,
  formatMoney,
  formatPrice,
  formatTime,
  priceDecimals,
  useBot,
  useSimNow,
  useStore,
  useTrades,
} from "@/lib/mockData";

const TAG_COLORS: Record<string, string> = {
  SIGNAL: "text-[#4f9cf9]",
  "RISK-CHECK": "text-[#22d3ee]",
  ORDER: "text-[var(--bull)]",
  "STOP-LOSS": "text-[var(--bear)]",
  "TAKE-PROFIT": "text-[var(--bull)]",
  INFO: "text-muted-foreground",
};

function PerfCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  tone?: "bull" | "bear" | "neutral";
}) {
  const toneClass =
    tone === "bull"
      ? "text-[var(--bull)]"
      : tone === "bear"
        ? "text-[var(--bear)]"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-3 animate-fade-in-up">
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md bg-white/5 text-muted-foreground">
          <Icon className="size-3.5" />
        </div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn("mt-1.5 font-mono text-lg font-bold tabular-nums", toneClass)}>
        {value}
      </div>
    </div>
  );
}

function RiskHealth({ ratio }: { ratio: number }) {
  const tone =
    ratio < 0.5 ? "green" : ratio < 0.8 ? "yellow" : "red";
  const label =
    tone === "green" ? "Healthy" : tone === "yellow" ? "Caution" : "Critical";
  const color =
    tone === "green"
      ? "#16c784"
      : tone === "yellow"
        ? "#f0b90b"
        : "#ea3943";
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--panel-border)] bg-[#0a0e17] px-3 py-2">
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
        Risk Health: {label}
      </span>
    </div>
  );
}

export const BotView = memo(function BotView() {
  const bot = useBot();
  const trades = useTrades();
  const simNow = useSimNow();
  const setBotRunning = useStore((s) => s.setBotRunning);
  const updateBotConfig = useStore((s) => s.updateBotConfig);
  const closeBotPosition = useStore((s) => s.closeBotPosition);

  const todayLoss = useMemo(() => {
    const start = simNow - DAY_MS;
    return Math.abs(
      trades
        .filter(
          (t) =>
            t.status === "closed" &&
            t.source === "bot" &&
            t.datetime >= start &&
            t.pnl < 0,
        )
        .reduce((s, t) => s + t.pnl, 0),
    );
  }, [trades, simNow]);

  const todayPnl = useMemo(() => {
    const start = simNow - DAY_MS;
    return trades
      .filter(
        (t) =>
          t.status === "closed" &&
          t.source === "bot" &&
          t.datetime >= start,
      )
      .reduce((s, t) => s + t.pnl, 0);
  }, [trades, simNow]);

  const autoTradesToday = useMemo(() => {
    const start = simNow - DAY_MS;
    return trades.filter(
      (t) => t.source === "bot" && t.datetime >= start,
    );
  }, [trades, simNow]);

  const winRate = useMemo(() => {
    const closed = autoTradesToday.filter((t) => t.status === "closed");
    if (closed.length === 0) return 0;
    const wins = closed.filter((t) => t.result === "win").length;
    return (wins / closed.length) * 100;
  }, [autoTradesToday]);

  const avgDuration = useMemo(() => {
    // Approximate: positions opened in the last day that are now closed.
    const closed = autoTradesToday.filter((t) => t.status === "closed");
    if (closed.length === 0) return 0;
    // Synthetic: ~3-9 minutes per trade.
    return 4 * 60 * 1000 + (closed.length % 5) * 60 * 1000;
  }, [autoTradesToday]);

  const exposure = bot.positions.reduce(
    (s, p) => s + p.size * p.currentPrice,
    0,
  );

  const uptime =
    bot.running && bot.startedAt != null ? simNow - bot.startedAt : 0;

  const lossRatio = todayLoss / bot.config.maxDailyLoss;

  function handleClose(posId: string) {
    const pos = bot.positions.find((p) => p.id === posId);
    if (!pos) return;
    closeBotPosition(posId, pos.currentPrice, "manual");
    toast("Position closed manually", {
      description: `${pos.symbol} @ ${formatPrice(pos.currentPrice)}`,
    });
  }

  function handleKill() {
    setBotRunning(false);
    toast.error("Kill switch activated", {
      description: "Bot stopped immediately. All automation halted.",
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Autonomous Trading Bot
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Risk-managed auto-execution with stop-loss automation.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider",
              bot.running
                ? "border-[var(--bull)]/40 bg-[var(--bull)]/10 text-[var(--bull)]"
                : "border-[var(--bear)]/40 bg-[var(--bear)]/10 text-[var(--bear)]",
            )}
          >
            <span className="relative flex size-2">
              {bot.running && (
                <span
                  className={cn(
                    "absolute inline-flex size-full rounded-full",
                    bot.running ? "bg-[var(--bull)] animate-live" : "bg-[var(--bear)]",
                  )}
                />
              )}
              <span
                className={cn(
                  "relative inline-flex size-2 rounded-full",
                  bot.running ? "bg-[var(--bull)]" : "bg-[var(--bear)]",
                )}
              />
            </span>
            {bot.running ? "Running" : "Stopped"}
          </span>
          <Button
            onClick={() => setBotRunning(!bot.running)}
            className={
              bot.running
                ? "bg-[var(--bear)] text-white hover:bg-[var(--bear)]/90"
                : "bg-[var(--bull)] text-[#0a0e17] hover:bg-[var(--bull)]/90"
            }
          >
            {bot.running ? "Stop Bot" : "Start Bot"}
          </Button>
        </div>
      </header>

      {/* Status hero */}
      <div className="rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up sm:p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Left: status */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Bot Status
            </div>
            <div
              className={cn(
                "flex items-center gap-2 font-mono text-3xl font-bold sm:text-4xl",
                bot.running ? "text-[var(--bull)] text-glow-bull" : "text-[var(--bear)] text-glow-bear",
              )}
            >
              {bot.running ? "RUNNING" : "STOPPED"}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="size-3.5" />
              <span className="font-mono tabular-nums">
                Uptime {formatDuration(uptime)}
              </span>
            </div>
          </div>

          {/* Center: metrics */}
          <div className="flex flex-col justify-center gap-2 border-y border-[var(--panel-border)] py-3 md:border-y-0 md:border-x md:py-0">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Trades placed today</span>
              <span className="font-mono font-bold text-foreground tabular-nums">
                {bot.tradesPlacedToday}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Open positions</span>
              <span className="font-mono font-bold text-foreground tabular-nums">
                {bot.positions.length} / {bot.config.maxConcurrentPositions}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current exposure</span>
              <span className="font-mono font-bold text-foreground tabular-nums">
                {formatMoney(exposure)}
              </span>
            </div>
          </div>

          {/* Right: auto-trade + kill */}
          <div className="flex flex-col items-start justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--bull)]">
              <Activity className="size-3.5" /> Auto-trade: ENABLED
            </span>
            <button
              type="button"
              onClick={handleKill}
              className="mt-1 inline-flex items-center gap-2 rounded-md border border-[var(--bear)] bg-[var(--bear)]/15 px-4 py-2 text-sm font-bold uppercase tracking-wider text-[var(--bear)] transition-all hover:bg-[var(--bear)]/25 hover:shadow-[0_0_12px_rgba(234,57,67,0.3)]"
            >
              <XCircle className="size-4" /> Kill Switch
            </button>
          </div>
        </div>
      </div>

      {/* Risk + Activity */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
        {/* Risk management */}
        <div className="rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="size-4 text-[#4f9cf9]" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Risk Management
            </h2>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Max position size</span>
                <span className="font-mono text-foreground tabular-nums">
                  ${bot.config.maxPositionSize}
                </span>
              </label>
              <Input
                type="number"
                value={bot.config.maxPositionSize}
                onChange={(e) =>
                  updateBotConfig({
                    maxPositionSize: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="h-8 border-[var(--panel-border)] bg-[#0a0e17] font-mono text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Max daily loss</span>
                <span className="font-mono text-foreground tabular-nums">
                  ${bot.config.maxDailyLoss}
                </span>
              </label>
              <Input
                type="number"
                value={bot.config.maxDailyLoss}
                onChange={(e) =>
                  updateBotConfig({
                    maxDailyLoss: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="h-8 border-[var(--panel-border)] bg-[#0a0e17] font-mono text-sm tabular-nums"
              />
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      lossRatio < 0.5
                        ? "bg-[var(--bull)]"
                        : lossRatio < 0.8
                          ? "bg-[#f0b90b]"
                          : "bg-[var(--bear)]",
                    )}
                    style={{ width: `${Math.min(100, lossRatio * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  ${todayLoss.toFixed(0)} / ${bot.config.maxDailyLoss}
                </span>
              </div>
              <div className="mt-2">
                <RiskHealth ratio={lossRatio} />
              </div>
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Max concurrent positions</span>
                <span className="font-mono text-foreground tabular-nums">
                  {bot.config.maxConcurrentPositions}
                </span>
              </label>
              <Input
                type="number"
                value={bot.config.maxConcurrentPositions}
                onChange={(e) =>
                  updateBotConfig({
                    maxConcurrentPositions: Math.max(
                      1,
                      Math.floor(Number(e.target.value) || 1),
                    ),
                  })
                }
                className="h-8 border-[var(--panel-border)] bg-[#0a0e17] font-mono text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Default stop loss</span>
                <span className="font-mono text-[var(--bear)] tabular-nums">
                  {bot.config.defaultStopLoss.toFixed(1)}%
                </span>
              </label>
              <Slider
                value={[bot.config.defaultStopLoss]}
                min={0.5}
                max={5}
                step={0.1}
                onValueChange={(v) =>
                  updateBotConfig({ defaultStopLoss: v[0] })
                }
              />
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Default take profit</span>
                <span className="font-mono text-[var(--bull)] tabular-nums">
                  {bot.config.defaultTakeProfit.toFixed(1)}%
                </span>
              </label>
              <Slider
                value={[bot.config.defaultTakeProfit]}
                min={1}
                max={10}
                step={0.1}
                onValueChange={(v) =>
                  updateBotConfig({ defaultTakeProfit: v[0] })
                }
              />
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Risk per trade</span>
                <span className="font-mono text-foreground tabular-nums">
                  {bot.config.riskPerTrade.toFixed(1)}%
                </span>
              </label>
              <Slider
                value={[bot.config.riskPerTrade]}
                min={0.5}
                max={5}
                step={0.1}
                onValueChange={(v) =>
                  updateBotConfig({ riskPerTrade: v[0] })
                }
              />
            </div>
          </div>
        </div>

        {/* Live activity feed */}
        <div className="relative flex flex-col rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4 animate-fade-in-up">
          <div className="mb-3 flex items-center gap-2">
            <Radio
              className={cn(
                "size-4",
                bot.running ? "text-[var(--bull)] animate-live" : "text-muted-foreground",
              )}
            />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Live Activity
            </h2>
          </div>
          <div className="relative max-h-[420px] min-h-[260px] flex-1 overflow-y-auto pr-1">
            {bot.log.length === 0 && (
              <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-muted-foreground">
                No activity yet.
              </div>
            )}
            {bot.log.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-2 border-b border-[var(--panel-border)]/40 py-1.5 text-[11px] animate-fade-in-up"
              >
                <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                  [{formatTime(entry.timestamp)}]
                </span>
                <span
                  className={cn(
                    "shrink-0 font-semibold",
                    TAG_COLORS[entry.tag] ?? "text-muted-foreground",
                  )}
                >
                  {entry.tag}
                </span>
                <span className="text-foreground/80">{entry.message}</span>
              </div>
            ))}
            {!bot.running && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]/80 backdrop-blur-sm">
                <div className="text-center">
                  <XCircle className="mx-auto size-6 text-[var(--bear)]" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Bot stopped -- press Start to resume
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Open positions */}
      <div className="mt-4 rounded-xl border border-[var(--panel-border)] bg-[#0d1117] animate-fade-in-up">
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Open Positions
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {bot.positions.length} live
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--panel-border)] text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Symbol</th>
                <th className="px-3 py-2 font-medium">Side</th>
                <th className="px-3 py-2 text-right font-medium">Size</th>
                <th className="px-3 py-2 text-right font-medium">Entry</th>
                <th className="px-3 py-2 text-right font-medium">Current</th>
                <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                <th className="px-3 py-2 text-right font-medium">Stop Loss</th>
                <th className="px-3 py-2 text-right font-medium">Take Profit</th>
                <th className="px-3 py-2 text-right font-medium">Opened</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {bot.positions.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                    No open positions.
                  </td>
                </tr>
              )}
              {bot.positions.map((p) => {
                const dir = p.side === "buy" ? 1 : -1;
                const pnl =
                  Math.round(
                    (p.currentPrice - p.entryPrice) * dir * p.size * 100,
                  ) / 100;
                const pnlPct =
                  Math.round(
                    ((p.currentPrice - p.entryPrice) / p.entryPrice) *
                      dir *
                      10000,
                  ) / 100;
                const decimals = priceDecimals(p.currentPrice);
                const nearSl =
                  p.side === "buy"
                    ? p.currentPrice <= p.stopLoss * 1.005
                    : p.currentPrice >= p.stopLoss * 0.995;
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "border-b border-[var(--panel-border)]/50 hover:bg-[#11161f]",
                      nearSl && "bg-[var(--bear)]/[0.06]",
                    )}
                  >
                    <td className="px-3 py-2">
                      <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                        {p.symbol}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 font-semibold",
                        p.side === "buy" ? "text-[var(--bull)]" : "text-[var(--bear)]",
                      )}
                    >
                      {p.side === "buy" ? "Buy" : "Sell"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {p.size.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatPrice(p.entryPrice, decimals)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatPrice(p.currentPrice, decimals)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono tabular-nums",
                        pnl >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]",
                      )}
                    >
                      {formatMoney(pnl)}{" "}
                      <span className="text-[10px] opacity-70">
                        ({pnlPct >= 0 ? "+" : ""}
                        {pnlPct.toFixed(2)}%)
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--bear)]">
                      {formatPrice(p.stopLoss, decimals)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--bull)]">
                      {formatPrice(p.takeProfit, decimals)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                      {formatTime(p.openedAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleClose(p.id)}
                        className="h-6 border-[var(--panel-border)] bg-[#0a0e17] px-2 text-[10px] font-semibold hover:bg-[#11161f]"
                      >
                        Close
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Performance mini-cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <PerfCard
          label="Today's P&L"
          value={formatMoney(todayPnl)}
          icon={DollarSign}
          tone={todayPnl >= 0 ? "bull" : "bear"}
        />
        <PerfCard
          label="Win Rate (auto)"
          value={`${winRate.toFixed(1)}%`}
          icon={TrendingUp}
          tone="bull"
        />
        <PerfCard
          label="Avg Trade Duration"
          value={formatDuration(avgDuration)}
          icon={Timer}
        />
        <PerfCard
          label="Total Auto-Trades"
          value={String(bot.tradesPlacedToday)}
          icon={Target}
        />
      </div>
    </div>
  );
});
