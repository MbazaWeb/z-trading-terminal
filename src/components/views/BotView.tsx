"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  Clock,
  DollarSign,
  Loader2,
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
} from "@/lib/format";
import {
  useBotStore,
  useBot,
  type BotPosition,
  type BotLogEntry,
  type BotConfig,
} from "@/lib/botStore";
import { useTrades } from "@/lib/tradeStore";
import { useLastConsensus } from "@/lib/agents/agentStore";
import { useAuthStore } from "@/lib/authStore";

const TAG_COLORS: Record<string, string> = {
  SIGNAL: "text-[#4f9cf9]",
  "RISK-CHECK": "text-[#22d3ee]",
  ORDER: "text-[var(--bull)]",
  "STOP-LOSS": "text-[var(--bear)]",
  "TAKE-PROFIT": "text-[var(--bull)]",
  INFO: "text-muted-foreground",
};

interface ServerBotConfig {
  running: boolean;
  active_symbol: string;
  max_position_size: number;
  max_daily_loss: number;
  max_concurrent_positions: number;
  default_stop_loss: number;
  default_take_profit: number;
  risk_per_trade: number;
}

interface BrokerPosition {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  volume: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  swap?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  openedAt: number;
  comment?: string | null;
}

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
  const tone = ratio < 0.5 ? "green" : ratio < 0.8 ? "yellow" : "red";
  const label =
    tone === "green" ? "Healthy" : tone === "yellow" ? "Caution" : "Critical";
  const color =
    tone === "green" ? "#16c784" : tone === "yellow" ? "#f0b90b" : "#ea3943";
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
  const consensus = useLastConsensus();
  const updateBotConfig = useBotStore((s) => s.updateBotConfig);
  const setBotRunning = useBotStore((s) => s.setBotRunning);
  const setPositions = useBotStore((s) => s.setPositions);
  const setLogs = useBotStore((s) => s.setLogs);
  const closeBotPosition = useBotStore((s) => s.closeBotPosition);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accountType = useAuthStore((s) => s.accountType);

  const [configLoading, setConfigLoading] = useState(true);
  const [serverRunning, setServerRunning] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [brokerPositions, setBrokerPositions] = useState<BrokerPosition[]>([]);

  const now = Date.now();

  // --- Load bot config from /api/bot/config on mount ----------------------
  const loadConfig = useCallback(async () => {
    if (!isAuthenticated) {
      setConfigLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/bot/config", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { ok?: boolean; config?: ServerBotConfig };
      if (data.config) {
        updateBotConfig({
          maxPositionSize: Number(data.config.max_position_size) || 500,
          maxDailyLoss: Number(data.config.max_daily_loss) || 200,
          maxConcurrentPositions:
            Math.max(1, Math.floor(Number(data.config.max_concurrent_positions) || 5)),
          defaultStopLoss: Number(data.config.default_stop_loss) || 1.5,
          defaultTakeProfit: Number(data.config.default_take_profit) || 3.0,
          riskPerTrade: Number(data.config.risk_per_trade) || 2,
        });
        setServerRunning(Boolean(data.config.running));
        setBotRunning(Boolean(data.config.running));
      }
    } catch (err) {
      console.warn("[BotView] loadConfig failed:", err);
    } finally {
      setConfigLoading(false);
    }
  }, [isAuthenticated, updateBotConfig, setBotRunning]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadConfig();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadConfig]);

  // --- Persist config changes back to /api/bot/config (debounced) ----------
  const configSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastConfigPush = useRef<string>("");
  useEffect(() => {
    if (configLoading) return;
    if (!isAuthenticated) return;
    const snapshot = JSON.stringify({
      maxPositionSize: bot.config.maxPositionSize,
      maxDailyLoss: bot.config.maxDailyLoss,
      maxConcurrentPositions: bot.config.maxConcurrentPositions,
      defaultStopLoss: bot.config.defaultStopLoss,
      defaultTakeProfit: bot.config.defaultTakeProfit,
      riskPerTrade: bot.config.riskPerTrade,
    });
    if (snapshot === lastConfigPush.current) return;
    if (configSaveTimer.current) clearTimeout(configSaveTimer.current);
    configSaveTimer.current = setTimeout(async () => {
      lastConfigPush.current = snapshot;
      try {
        await fetch("/api/bot/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maxPositionSize: bot.config.maxPositionSize,
            maxDailyLoss: bot.config.maxDailyLoss,
            maxConcurrentPositions: bot.config.maxConcurrentPositions,
            defaultStopLoss: bot.config.defaultStopLoss,
            defaultTakeProfit: bot.config.defaultTakeProfit,
            riskPerTrade: bot.config.riskPerTrade,
          }),
          cache: "no-store",
        });
      } catch (err) {
        console.warn("[BotView] config save failed:", err);
      }
    }, 800);
    return () => {
      if (configSaveTimer.current) clearTimeout(configSaveTimer.current);
    };
  }, [bot.config, isAuthenticated, configLoading]);

  // --- Fetch open positions every 10s from /api/mt5/positions (or /api/trades) --
  const loadPositions = useCallback(async () => {
    if (!isAuthenticated) return;
    setPositionsLoading(true);
    try {
      // Try MetaApi first; fall back to /api/trades?status=open when MetaApi
      // is not configured (paper / demo-only users).
      let positions: BrokerPosition[] = [];
      try {
        const res = await fetch("/api/mt5/positions", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as {
            configured?: boolean;
            positions?: BrokerPosition[];
          };
          if (data.configured !== false && Array.isArray(data.positions)) {
            positions = data.positions;
          }
        }
      } catch {
        // fall through to /api/trades
      }
      if (positions.length === 0) {
        // Fallback: derive "open positions" from local trades.
        positions = trades
          .filter((t) => t.status === "open")
          .map((t) => {
            const size = t.entryPrice > 0 ? t.amount / t.entryPrice : 0;
            return {
              id: t.brokerOrderId ?? t.id,
              symbol: t.market,
              side: t.side,
              volume: size,
              openPrice: t.entryPrice,
              currentPrice: t.entryPrice,
              profit: 0,
              openedAt: t.datetime,
              stopLoss: null,
              takeProfit: null,
            };
          });
      }
      setBrokerPositions(positions);
      // Mirror into the bot store so the rest of the UI (e.g. exposure
      // calc) keeps working without touching botStore internals.
      const mapped: BotPosition[] = positions.map((p) => ({
        id: p.id,
        tradeId: p.id,
        symbol: p.symbol,
        side: p.side,
        size: p.volume,
        entryPrice: p.openPrice,
        currentPrice: p.currentPrice,
        stopLoss: p.stopLoss ?? 0,
        takeProfit: p.takeProfit ?? 0,
        openedAt: p.openedAt,
        agentId: null,
      }));
      setPositions(mapped);
    } catch (err) {
      console.warn("[BotView] loadPositions failed:", err);
    } finally {
      setPositionsLoading(false);
    }
  }, [isAuthenticated, trades, setPositions]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const initial = setTimeout(() => {
      void loadPositions();
    }, 0);
    const id = setInterval(() => {
      void loadPositions();
    }, 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [isAuthenticated, loadPositions]);

  // --- Fetch bot activity logs every 10s from /api/bot/logs ----------------
  const loadLogs = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch("/api/bot/logs?limit=100", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        logs?: Array<{
          id: string;
          timestamp: string;
          tag: BotLogEntry["tag"];
          message: string;
        }>;
      };
      if (data.ok && Array.isArray(data.logs)) {
        const mapped: BotLogEntry[] = data.logs.map((l) => ({
          id: l.id,
          timestamp: new Date(l.timestamp).getTime(),
          tag: l.tag,
          message: l.message,
        }));
        setLogs(mapped);
      }
    } catch (err) {
      console.warn("[BotView] loadLogs failed:", err);
    }
  }, [isAuthenticated, setLogs]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadLogs();
    const id = setInterval(() => {
      void loadLogs();
    }, 10_000);
    return () => clearInterval(id);
  }, [isAuthenticated, loadLogs]);

  // --- Start/Stop handler: POST running state to /api/bot/config -----------
  const handleToggleRunning = useCallback(async () => {
    if (toggling) return;
    const next = !bot.running;
    setToggling(true);
    // Optimistically flip the local state so the button reflects immediately.
    setBotRunning(next);
    try {
      const res = await fetch("/api/bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ running: next }),
        cache: "no-store",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setServerRunning(next);
      toast.success(next ? "Bot started" : "Bot stopped", {
        description: next
          ? "Cron worker will pick up signals on the next cycle."
          : "No new orders will be placed. Open positions remain until SL/TP.",
      });
    } catch (err) {
      // Revert optimistic flip.
      setBotRunning(!next);
      toast.error("Failed to toggle bot", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setToggling(false);
    }
  }, [bot.running, toggling, setBotRunning]);

  // --- Manual close handler: POST to /api/mt5/close ------------------------
  const handleClose = useCallback(
    async (positionId: string) => {
      const pos = brokerPositions.find((p) => p.id === positionId);
      if (!pos) return;
      try {
        const res = await fetch("/api/mt5/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positionId }),
          cache: "no-store",
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        closeBotPosition(positionId, pos.currentPrice, "manual");
        toast("Position closed manually", {
          description: `${pos.symbol} @ ${formatPrice(pos.currentPrice)}`,
        });
        // Refresh positions immediately so the table reflects the close.
        void loadPositions();
      } catch (err) {
        // Paper / local-only trade — close locally.
        closeBotPosition(positionId, pos.currentPrice, "manual");
        toast("Position closed locally", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [brokerPositions, closeBotPosition, loadPositions],
  );

  function handleKill() {
    void handleToggleRunning();
  }

  // --- Derived metrics -----------------------------------------------------
  const todayLoss = useMemo(() => {
    const start = now - DAY_MS;
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
  }, [trades, now]);

  const todayPnl = useMemo(() => {
    const start = now - DAY_MS;
    return trades
      .filter(
        (t) =>
          t.status === "closed" &&
          t.source === "bot" &&
          t.datetime >= start,
      )
      .reduce((s, t) => s + t.pnl, 0);
  }, [trades, now]);

  const autoTradesToday = useMemo(() => {
    const start = now - DAY_MS;
    return trades.filter(
      (t) => t.source === "bot" && t.datetime >= start,
    );
  }, [trades, now]);

  const winRate = useMemo(() => {
    const closed = autoTradesToday.filter((t) => t.status === "closed");
    if (closed.length === 0) return 0;
    const wins = closed.filter((t) => t.result === "win").length;
    return (wins / closed.length) * 100;
  }, [autoTradesToday]);

  const avgDuration = useMemo(() => {
    const closed = autoTradesToday.filter(
      (t) => t.status === "closed" && typeof t.holdTimeMs === "number",
    );
    if (closed.length === 0) {
      // Fall back to broker_close_time - broker_open_time when holdTimeMs
      // isn't populated.
      const tsBased = autoTradesToday.filter(
        (t) =>
          t.status === "closed" &&
          typeof t.brokerOpenTime === "number" &&
          typeof t.brokerCloseTime === "number",
      );
      if (tsBased.length === 0) return 0;
      const sum = tsBased.reduce(
        (s, t) =>
          s + ((t.brokerCloseTime ?? 0) - (t.brokerOpenTime ?? 0)),
        0,
      );
      return Math.round(sum / tsBased.length);
    }
    const sum = closed.reduce((s, t) => s + (t.holdTimeMs ?? 0), 0);
    return Math.round(sum / closed.length);
  }, [autoTradesToday]);

  const exposure = bot.positions.reduce(
    (s, p) => s + p.size * p.currentPrice,
    0,
  );

  const uptime =
    bot.running && bot.startedAt != null ? now - bot.startedAt : 0;

  const lossRatio = bot.config.maxDailyLoss > 0 ? todayLoss / bot.config.maxDailyLoss : 0;

  const livePositions = brokerPositions.length > 0 ? brokerPositions : [];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Autonomous Trading Bot
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Server-driven cron worker. Risk-managed auto-execution on agent
              consensus. No browser intervals.
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
            {serverRunning === false && bot.running && (
              <span className="ml-1 text-[9px] opacity-70">(local only)</span>
            )}
          </span>
          <Button
            onClick={handleToggleRunning}
            disabled={toggling || configLoading}
            className={
              bot.running
                ? "bg-[var(--bear)] text-white hover:bg-[var(--bear)]/90"
                : "bg-[var(--bull)] text-[#0a0e17] hover:bg-[var(--bull)]/90"
            }
          >
            {toggling ? (
              <Loader2 className="size-4 animate-spin" />
            ) : bot.running ? (
              "Stop Bot"
            ) : (
              "Start Bot"
            )}
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
            <div className="text-[10px] text-muted-foreground">
              Cron schedule: <span className="font-mono">0 * * * *</span> (hourly on Vercel Hobby; <span className="font-mono">* * * * *</span> on Pro)
            </div>
          </div>

          {/* Center: metrics */}
          <div className="flex flex-col justify-center gap-2 border-y border-[var(--panel-border)] py-3 md:border-y-0 md:border-x md:py-0">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Trades placed today</span>
              <span className="font-mono font-bold text-foreground tabular-nums">
                {autoTradesToday.length}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Open positions</span>
              <span className="font-mono font-bold text-foreground tabular-nums">
                {livePositions.length} / {bot.config.maxConcurrentPositions}
                {positionsLoading && (
                  <Loader2 className="ml-1 inline size-3 animate-spin align-middle" />
                )}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current exposure</span>
              <span className="font-mono font-bold text-foreground tabular-nums">
                {formatMoney(exposure)}
              </span>
            </div>
          </div>

          {/* Right: consensus + kill */}
          <div className="flex flex-col items-start justify-center gap-2">
            {consensus ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
                  consensus.decision === "buy"
                    ? "border-[var(--bull)]/40 bg-[var(--bull)]/10 text-[var(--bull)]"
                    : consensus.decision === "sell"
                      ? "border-[var(--bear)]/40 bg-[var(--bear)]/10 text-[var(--bear)]"
                      : "border-[var(--panel-border)] bg-white/5 text-muted-foreground",
                )}
              >
                <Activity className="size-3.5" /> Consensus: {consensus.decision.toUpperCase()} ({consensus.totalConfidence}%)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--panel-border)] bg-white/5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Activity className="size-3.5" /> No consensus yet
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--bull)]">
              <Activity className="size-3.5" /> Auto-trade: {bot.running ? "ENABLED" : "DISABLED"}
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
            <span className="ml-auto text-[10px] text-muted-foreground">
              from /api/bot/logs (polls every 10s)
            </span>
          </div>
          <div className="relative max-h-[420px] min-h-[260px] flex-1 overflow-y-auto pr-1">
            {bot.log.length === 0 && (
              <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-muted-foreground">
                No activity yet. Start the bot to begin consensus-driven
                trading. The cron worker writes log entries on every cycle.
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
            {livePositions.length} live
            {positionsLoading && (
              <Loader2 className="ml-1 inline size-3 animate-spin align-middle" />
            )}
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
              {livePositions.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                    No open positions. The bot will open positions automatically
                    when consensus passes on the next cron cycle.
                  </td>
                </tr>
              )}
              {livePositions.map((p) => {
                const dir = p.side === "buy" ? 1 : -1;
                const pnl =
                  Math.round(
                    (p.currentPrice - p.openPrice) * dir * p.volume * 100,
                  ) / 100;
                const pnlPct =
                  Math.round(
                    ((p.currentPrice - p.openPrice) / p.openPrice) *
                      dir *
                      10000,
                  ) / 100;
                const decimals = priceDecimals(p.currentPrice || p.openPrice);
                const nearSl =
                  p.stopLoss != null
                    ? p.side === "buy"
                      ? p.currentPrice <= p.stopLoss * 1.005
                      : p.currentPrice >= p.stopLoss * 0.995
                    : false;
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
                      {p.volume.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatPrice(p.openPrice, decimals)}
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
                      {p.stopLoss != null ? formatPrice(p.stopLoss, decimals) : "--"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--bull)]">
                      {p.takeProfit != null ? formatPrice(p.takeProfit, decimals) : "--"}
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
          value={avgDuration > 0 ? formatDuration(avgDuration) : "--"}
          icon={Timer}
        />
        <PerfCard
          label="Total Auto-Trades"
          value={String(autoTradesToday.length)}
          icon={Target}
        />
      </div>

      {/* Account-type notice */}
      {accountType === "real" && (
        <div className="mt-4 rounded-lg border border-[var(--bear)]/40 bg-[var(--bear)]/[0.06] p-3 text-[11px] text-muted-foreground">
          Real-account mode: the cron worker will not place broker orders
          unless <span className="font-mono text-[var(--bear)]">REAL_TRADING_ENABLED=true</span> is
          set on the server. Existing positions are still monitored for SL/TP.
        </div>
      )}
    </div>
  );
});
