"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatPrice, priceDecimals } from "@/lib/format";
import type { Candle, SymbolInfo, TickerStats } from "./types";
import { useTradeStore, newTradeId } from "@/lib/tradeStore";
import { useBotStore } from "@/lib/botStore";
import {
  useAgentStore,
  useLastConsensus,
  useAgentSignals,
} from "@/lib/agents/agentStore";
import { useAuthStore } from "@/lib/authStore";
import {
  STRATEGY_CONFIG,
  analyzeEntry,
  computePositionProfit,
  type StrategyAnalysis,
} from "@/lib/strategy";
import type { AgentSignal, ConsensusResult } from "@/lib/agents/types";

interface TradePanelProps {
  symbol: SymbolInfo;
  livePrice: number;
  candles: Candle[];
  stats: TickerStats;
}

const FAKE_BALANCE_QUOTE = 50_000;

// Reference risk config mirrors the bot config; the TradePanel uses the live
// bot config so strategy risk reflects whatever the user has configured.
function useRiskConfig(accountBalance: number) {
  const botConfig = useBotStore((s) => s.config);
  const trades = useTradeStore((s) => s.trades);
  const currentDailyLoss = useMemo(() => {
    const now = Date.now();
    const dayStart = now - (now % 86_400_000);
    return Math.abs(
      trades
        .filter(
          (t) =>
            t.status === "closed" &&
            (t.source === "manual" || t.source === "bot") &&
            t.datetime >= dayStart &&
            t.pnl < 0,
        )
        .reduce((sum, t) => sum + t.pnl, 0),
    );
  }, [trades]);
  return {
    maxPositionSize: botConfig.maxPositionSize,
    maxDailyLoss: botConfig.maxDailyLoss,
    currentDailyLoss,
    defaultStopLoss: botConfig.defaultStopLoss,
    defaultTakeProfit: botConfig.defaultTakeProfit,
    riskPerTrade: botConfig.riskPerTrade,
    accountBalance,
  };
}

export function TradePanel({ symbol, livePrice, candles, stats }: TradePanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [priceInput, setPriceInput] = useState(() =>
    livePrice.toFixed(priceDecimals(livePrice)),
  );
  const [amountInput, setAmountInput] = useState("");
  const [analysis, setAnalysis] = useState<StrategyAnalysis | null>(null);

  const decimals = priceDecimals(livePrice);

  // Stores
  const addTrade = useTradeStore((s) => s.addTrade);
  const addBotLog = useBotStore((s) => s.addBotLog);
  const agents = useAgentStore((s) => s.agents);
  const signals = useAgentSignals();
  const consensus = useLastConsensus();
  const runAnalysis = useAgentStore((s) => s.runAnalysis);

  // Account balance from auth store so strategy risk uses the real balance.
  const accountInfo = useAuthStore((s) => s.accountInfo);
  const accountBalance = accountInfo?.balance ?? FAKE_BALANCE_QUOTE;
  const riskConfig = useRiskConfig(accountBalance);

  // Reset the price field to the live price when the symbol changes, using
  // the React "adjust state during render" pattern (no effect needed).
  const [appliedSymbolId, setAppliedSymbolId] = useState(symbol.id);
  if (appliedSymbolId !== symbol.id) {
    setAppliedSymbolId(symbol.id);
    setPriceInput(livePrice.toFixed(decimals));
    setAmountInput("");
    setAnalysis(null);
  }

  // Run the agent analysis whenever fresh candles arrive (debounced by the
  // candle update cadence from useMarketData — typically every 5s on the
  // ticker poll).
  useEffect(() => {
    if (candles.length === 0 || stats.lastPrice === 0) return;
    runAnalysis(candles, stats);
  }, [candles, stats.lastPrice, runAnalysis]);

  const price = parseFloat(priceInput) || 0;
  const amount = parseFloat(amountInput) || 0;
  const total = useMemo(() => price * amount, [price, amount]);

  const isBuy = side === "buy";
  const sideColor = isBuy ? "var(--bull)" : "var(--bear)";

  function handlePercent(pct: number) {
    const quoteToSpend = accountBalance * pct;
    if (price <= 0) {
      toast.error("Enter a price first");
      return;
    }
    const amt = quoteToSpend / price;
    setAmountInput(amt.toFixed(symbol.kind === "crypto" ? 4 : 4));
  }

  function handleAnalyze() {
    const result = analyzeEntry(
      side,
      livePrice, // reference = current live price (drop catcher session open)
      livePrice,
      accountBalance,
      {
        maxPositionSize: riskConfig.maxPositionSize,
        maxDailyLoss: riskConfig.maxDailyLoss,
        currentDailyLoss: riskConfig.currentDailyLoss,
        defaultStopLoss: riskConfig.defaultStopLoss,
        defaultTakeProfit: riskConfig.defaultTakeProfit,
        riskPerTrade: riskConfig.riskPerTrade,
      },
    );
    setAnalysis(result);
    if (result.conditionsMet) {
      toast.success(`Strategy analysis: ${side.toUpperCase()} conditions MET`, {
        description: `${result.entrySignal}. Potential profit +$${result.potentialProfit.toFixed(
          2,
        )} (TP target).`,
      });
    } else {
      toast.info(`Strategy analysis: ${side.toUpperCase()} conditions NOT met`, {
        description: result.waitingFor,
      });
    }
  }

  function handleTradeNow() {
    if (!analysis || !analysis.conditionsMet || !analysis.riskCheck.passed) {
      toast.error("Conditions are not met yet");
      return;
    }
    if (amount <= 0 || price <= 0) {
      toast.error("Enter a valid price and amount");
      return;
    }
    const trade = {
      id: newTradeId("manual"),
      status: "open" as const,
      datetime: Date.now(),
      market: symbol.label,
      side,
      amount,
      entryPrice: price,
      exitPrice: null,
      pnl: 0,
      pnlPct: 0,
      result: null,
      agentId: null,
      source: "manual" as const,
    };
    addTrade(trade);
    addBotLog(
      "ORDER",
      `Manual ${side.toUpperCase()} ${symbol.label} @ ${formatPrice(
        price,
        decimals,
      )} (TP target +$${STRATEGY_CONFIG.takeProfitTarget.toFixed(2)})`,
    );
    toast.success(`Trade placed: ${side.toUpperCase()} ${symbol.label} @ ${formatPrice(
      price,
      decimals,
    )}`, {
      description: `TP target: +$${STRATEGY_CONFIG.takeProfitTarget.toFixed(2)}`,
    });
    setAnalysis(null);
  }

  function handleResetStrategy() {
    setAnalysis(null);
    toast.success("Strategy session reset", {
      description: `Reference price set to ${formatPrice(livePrice, decimals)}`,
    });
  }

  function handleRunAgentAnalysis() {
    if (candles.length === 0) {
      toast.error("No candles loaded yet");
      return;
    }
    const result = runAnalysis(candles, stats);
    if (!result) {
      toast.error("Agent analysis failed");
      return;
    }
    toast.success(`Consensus: ${result.decision.toUpperCase()} (${result.totalConfidence}%)`, {
      description: result.reason,
    });
  }

  return (
    <section className="flex flex-col rounded-xl border border-[var(--panel-border)] bg-[#0d1117] animate-fade-in-up">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Trade
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Drop Catcher + Consensus
        </span>
      </div>

      {/* Buy / Sell tab toggle */}
      <div className="grid grid-cols-2 gap-1 p-2">
        <button
          type="button"
          onClick={() => setSide("buy")}
          className={cn(
            "rounded-md py-1.5 text-sm font-bold uppercase tracking-wider transition-all",
            isBuy
              ? "bg-[var(--bull)] text-[#0a0e17] shadow-[0_0_10px_rgba(22,199,132,0.35)]"
              : "bg-[#11161f] text-muted-foreground hover:text-foreground",
          )}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          className={cn(
            "rounded-md py-1.5 text-sm font-bold uppercase tracking-wider transition-all",
            !isBuy
              ? "bg-[var(--bear)] text-white shadow-[0_0_10px_rgba(234,57,67,0.35)]"
              : "bg-[#11161f] text-muted-foreground hover:text-foreground",
          )}
        >
          Sell
        </button>
      </div>

      <div className="flex flex-col gap-2 px-2 pb-2">
        {/* Available balance */}
        <div className="flex items-center justify-between rounded-md bg-[#0a0e17] px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Available</span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {accountBalance.toLocaleString("en-US", {
              maximumFractionDigits: 2,
            })}{" "}
            {symbol.quote}
          </span>
        </div>

        {/* Price input */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Price
          </span>
          <div className="flex items-center rounded-md border border-[var(--panel-border)] bg-[#0a0e17] focus-within:border-[var(--bull)]/60">
            <Input
              type="number"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="h-9 border-0 bg-transparent px-2.5 font-mono text-sm tabular-nums shadow-none focus-visible:ring-0"
              placeholder={livePrice.toFixed(decimals)}
            />
            <span className="pr-2.5 text-[11px] font-medium text-muted-foreground">
              {symbol.quote}
            </span>
          </div>
        </label>

        {/* Amount input */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Amount
          </span>
          <div className="flex items-center rounded-md border border-[var(--panel-border)] bg-[#0a0e17] focus-within:border-[var(--bull)]/60">
            <Input
              type="number"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="h-9 border-0 bg-transparent px-2.5 font-mono text-sm tabular-nums shadow-none focus-visible:ring-0"
              placeholder="0.00"
            />
            <span className="pr-2.5 text-[11px] font-medium text-muted-foreground">
              {symbol.base}
            </span>
          </div>
        </label>

        {/* Percentage buttons */}
        <div className="grid grid-cols-4 gap-1">
          {[0.25, 0.5, 0.75, 1].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => handlePercent(pct)}
              className="rounded-md border border-[var(--panel-border)] bg-[#0a0e17] py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-[#11161f] hover:text-foreground"
            >
              {pct === 1 ? "Max" : `${pct * 100}%`}
            </button>
          ))}
        </div>

        {/* Total (auto) */}
        <div className="flex items-center justify-between rounded-md bg-[#0a0e17] px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {formatPrice(total, 2)} {symbol.quote}
          </span>
        </div>

        {/* Analyze button — replaces the old "place order" behavior */}
        <button
          type="button"
          onClick={handleAnalyze}
          className="mt-1 rounded-md py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all hover:brightness-110 active:scale-[0.99]"
          style={{
            backgroundColor: sideColor,
            boxShadow: `0 0 12px ${isBuy ? "rgba(22,199,132,0.4)" : "rgba(234,57,67,0.4)"}`,
          }}
        >
          Analyze {side === "buy" ? "Buy" : "Sell"} {symbol.base}
        </button>

        <p className="pt-0.5 text-center text-[10px] text-muted-foreground">
          Strategy analysis runs before any trade is placed
        </p>

        {/* Strategy analysis panel */}
        {analysis && (
          <AnalysisPanel
            analysis={analysis}
            symbolLabel={symbol.label}
            side={side}
            onTradeNow={handleTradeNow}
            onResetStrategy={handleResetStrategy}
          />
        )}

        {/* Agent consensus panel */}
        <AgentConsensusPanel
          signals={signals}
          consensus={consensus}
          agentCount={agents.length}
          onRunAnalysis={handleRunAgentAnalysis}
          onTradeNow={handleTradeNow}
          canTrade={!!analysis && analysis.conditionsMet && analysis.riskCheck.passed}
          side={side}
          symbolLabel={symbol.label}
        />
      </div>
    </section>
  );
}

// ---- Strategy analysis panel (unchanged from task 4) -----------------------

function AnalysisPanel({
  analysis,
  symbolLabel,
  side,
  onTradeNow,
  onResetStrategy,
}: {
  analysis: StrategyAnalysis;
  symbolLabel: string;
  side: "buy" | "sell";
  onTradeNow: () => void;
  onResetStrategy: () => void;
}) {
  const conditionsMet = analysis.conditionsMet;
  const riskPassed = analysis.riskCheck.passed;
  const canTrade = conditionsMet && riskPassed;
  const decimals = priceDecimals(analysis.currentPrice);

  return (
    <div className="mt-1 rounded-md border border-[var(--panel-border)] bg-[#0a0e17] p-2.5">
      {/* Status header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Strategy Status
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            conditionsMet
              ? "bg-[rgba(22,199,132,0.18)] text-[var(--bull)]"
              : "bg-[rgba(234,57,67,0.14)] text-muted-foreground",
          )}
        >
          {conditionsMet ? "Conditions MET" : "Conditions NOT met"}
        </span>
      </div>

      {/* Grid of analysis metrics */}
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px]">
        <MetricRow
          label="Reference"
          value={formatPrice(analysis.referencePrice, decimals)}
        />
        <MetricRow
          label="Current"
          value={formatPrice(analysis.currentPrice, decimals)}
        />
        <MetricRow
          label="Drop"
          value={`$${analysis.dropAmount.toFixed(2)}`}
          accent={
            analysis.dropAmount >= STRATEGY_CONFIG.entryDropThreshold
              ? "bull"
              : undefined
          }
        />
        <MetricRow
          label="Drop %"
          value={`${analysis.dropPercent.toFixed(2)}%`}
        />
        <MetricRow
          label="Position size"
          value={`$${analysis.riskCheck.positionSize.toFixed(2)}`}
        />
        <MetricRow
          label="Stop loss"
          value={formatPrice(analysis.riskCheck.stopLoss, decimals)}
        />
        <MetricRow
          label="Take profit"
          value={`+$${analysis.riskCheck.takeProfit.toFixed(2)}`}
          accent="bull"
        />
        <MetricRow
          label="Potential profit"
          value={`+$${analysis.potentialProfit.toFixed(2)}`}
          accent="bull"
        />
        <MetricRow
          label="Daily loss left"
          value={`$${analysis.riskCheck.maxDailyLossRemaining.toFixed(2)}`}
        />
      </dl>

      {/* Entry signal explanation */}
      <p className="mt-2 text-[11px] leading-relaxed text-foreground/80">
        <span className="font-semibold text-foreground">Entry signal:</span>{" "}
        {analysis.entrySignal}
      </p>

      {/* Risk check status */}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
        <span
          className={cn(
            "size-1.5 rounded-full",
            riskPassed ? "bg-[var(--bull)]" : "bg-[var(--bear)]",
          )}
          aria-hidden="true"
        />
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          Risk check:
        </span>
        <span
          className={cn(
            riskPassed ? "text-[var(--bull)]" : "text-[var(--bear)]",
          )}
        >
          {riskPassed ? "PASS" : "FAIL"}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
        {analysis.riskCheck.reason}
      </p>

      {/* Waiting-for / Trade Now row */}
      <div className="mt-2.5 flex items-center gap-2">
        {canTrade ? (
          <button
            type="button"
            onClick={onTradeNow}
            className="flex-1 rounded-md bg-[var(--bull)] py-2 text-sm font-bold uppercase tracking-wider text-[#0a0e17] shadow-[0_0_14px_rgba(22,199,132,0.45)] transition-all hover:brightness-110 active:scale-[0.99]"
          >
            Trade Now {side.toUpperCase()} {symbolLabel.split("/")[0]}
          </button>
        ) : (
          <div className="flex-1 rounded-md border border-[var(--panel-border)] bg-[#0d1117] px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {analysis.waitingFor}
          </div>
        )}
        <button
          type="button"
          onClick={onResetStrategy}
          title="Reset strategy session to current price"
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[var(--panel-border)] bg-[#0d1117] text-muted-foreground transition-colors hover:bg-[#11161f] hover:text-foreground"
          aria-label="Reset strategy session"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---- Agent consensus panel -------------------------------------------------

function AgentConsensusPanel({
  signals,
  consensus,
  agentCount,
  onRunAnalysis,
  onTradeNow,
  canTrade,
  side,
  symbolLabel,
}: {
  signals: AgentSignal[];
  consensus: ConsensusResult | null;
  agentCount: number;
  onRunAnalysis: () => void;
  onTradeNow: () => void;
  canTrade: boolean;
  side: "buy" | "sell";
  symbolLabel: string;
}) {
  const buyVotes = consensus?.votes.filter((v) => v.action === "buy") ?? [];
  const sellVotes = consensus?.votes.filter((v) => v.action === "sell") ?? [];
  const buyWeight = buyVotes.reduce((s, v) => s + v.weight, 0);
  const sellWeight = sellVotes.reduce((s, v) => s + v.weight, 0);
  const totalWeight = buyWeight + sellWeight || 1;
  const buyPct = Math.round((buyWeight / totalWeight) * 100);
  const sellPct = 100 - buyPct;

  const decision = consensus?.decision ?? "hold";
  const passed = consensus?.passed ?? false;

  return (
    <div className="mt-1 rounded-md border border-[var(--panel-border)] bg-[#0a0e17] p-2.5">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Consensus
        </span>
        <button
          type="button"
          onClick={onRunAnalysis}
          className="rounded border border-[var(--panel-border)] bg-[#0d1117] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-[#11161f] hover:text-foreground"
        >
          Run Analysis
        </button>
      </div>

      {/* Per-agent signals */}
      <div className="flex flex-col gap-1">
        {signals.length === 0 && (
          <p className="text-[10px] text-muted-foreground">
            No signals yet — click Run Analysis.
          </p>
        )}
        {signals.map((sig) => (
          <SignalRow key={sig.agentId} sig={sig} />
        ))}
      </div>

      {/* Consensus verdict */}
      {consensus && (
        <div className="mt-2 rounded border border-[var(--panel-border)] bg-[#0d1117] p-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                decision === "buy"
                  ? "bg-[rgba(22,199,132,0.18)] text-[var(--bull)]"
                  : decision === "sell"
                    ? "bg-[rgba(234,57,67,0.18)] text-[var(--bear)]"
                    : "bg-white/5 text-muted-foreground",
              )}
            >
              Consensus: {decision.toUpperCase()}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {consensus.totalConfidence}% / {consensus.threshold}% threshold
            </span>
          </div>

          {/* Vote breakdown bar */}
          <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full bg-[var(--bull)]"
              style={{ width: `${buyPct}%` }}
              aria-label={`Buy votes ${buyPct}%`}
            />
            <div
              className="h-full bg-[var(--bear)]"
              style={{ width: `${sellPct}%` }}
              aria-label={`Sell votes ${sellPct}%`}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <span className="text-[var(--bull)]">BUY {buyPct}%</span>
            <span className="text-[var(--bear)]">SELL {sellPct}%</span>
          </div>

          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            {consensus.reason}
          </p>

          {passed ? (
            <button
              type="button"
              onClick={onTradeNow}
              disabled={!canTrade}
              className={cn(
                "mt-2 w-full rounded-md py-2 text-[11px] font-bold uppercase tracking-wider transition-all",
                canTrade
                  ? side === "buy"
                    ? "bg-[var(--bull)] text-[#0a0e17] shadow-[0_0_12px_rgba(22,199,132,0.4)] hover:brightness-110"
                    : "bg-[var(--bear)] text-white shadow-[0_0_12px_rgba(234,57,67,0.4)] hover:brightness-110"
                  : "cursor-not-allowed bg-white/5 text-muted-foreground",
              )}
            >
              Trade Now via Consensus {side.toUpperCase()} {symbolLabel.split("/")[0]}
            </button>
          ) : (
            <p className="mt-2 rounded border border-[var(--panel-border)] bg-[#0a0e17] px-2 py-1.5 text-[10px] text-muted-foreground">
              Waiting for stronger consensus (threshold {consensus.threshold}%).
            </p>
          )}
        </div>
      )}

      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {agentCount} agents voting on live Binance data
      </p>
    </div>
  );
}

function SignalRow({ sig }: { sig: AgentSignal }) {
  const color =
    sig.action === "buy"
      ? "var(--bull)"
      : sig.action === "sell"
        ? "var(--bear)"
        : "var(--muted-foreground)";
  return (
    <div className="rounded border border-[var(--panel-border)] bg-[#0d1117] px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold text-foreground">
          {sig.agentName}
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor:
              sig.action === "buy"
                ? "rgba(22,199,132,0.18)"
                : sig.action === "sell"
                  ? "rgba(234,57,67,0.18)"
                  : "rgba(255,255,255,0.05)",
            color: color === "var(--muted-foreground)" ? "#8b949e" : undefined,
          }}
        >
          {sig.action === "buy"
            ? "BUY"
            : sig.action === "sell"
              ? "SELL"
              : "HOLD"}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, sig.confidence)}%`,
              backgroundColor:
                sig.action === "buy"
                  ? "#16c784"
                  : sig.action === "sell"
                    ? "#ea3943"
                    : "#8b949e",
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
      {sig.indicators.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {sig.indicators.slice(0, 4).map((ind) => (
            <span
              key={ind.name}
              className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-muted-foreground"
            >
              {ind.name}: {ind.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "bull" | "bear";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "font-mono font-medium tabular-nums",
          accent === "bull" && "text-[var(--bull)]",
          accent === "bear" && "text-[var(--bear)]",
          !accent && "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// Re-export computePositionProfit so the shell can import it from the trade
// panel module if needed (kept here for back-compat with task 4 imports).
export { computePositionProfit };
