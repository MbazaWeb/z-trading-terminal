"use client";

import { useMemo } from "react";
import { create } from "zustand";
import {
  BrainCircuit,
  Crosshair,
  Radar,
  RefreshCw,
  Shuffle,
  type LucideIcon,
} from "lucide-react";

// Fixed demo "now" so SSR + client hydration produce identical initial data.
// All seeded trade / log timestamps are computed relative to this anchor.
export const DEMO_NOW = new Date("2024-11-27T16:30:00Z").getTime();
export const DAY_MS = 86_400_000;

// ---- Market catalogue (kept consistent with the trading view) ---------------

export interface MarketInfo {
  label: string;
  basePrice: number;
}

export const MARKETS: MarketInfo[] = [
  { label: "BTC/USDT", basePrice: 68420 },
  { label: "ETH/USDT", basePrice: 3528 },
  { label: "SOL/USDT", basePrice: 165.4 },
  { label: "BNB/USDT", basePrice: 588.2 },
  { label: "XRP/USDT", basePrice: 0.6125 },
  { label: "AAPL", basePrice: 225.8 },
  { label: "TSLA", basePrice: 341.6 },
  { label: "NVDA", basePrice: 884.3 },
];

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

// ---- Shared types -----------------------------------------------------------

export type TradeStatus = "open" | "closed";
export type TradeSide = "buy" | "sell";
export type TradeResult = "win" | "loss" | null;

export interface Trade {
  id: string;
  status: TradeStatus;
  datetime: number; // ms timestamp
  market: string;
  side: TradeSide;
  amount: number; // $ notional
  entryPrice: number;
  exitPrice: number | null;
  pnl: number;
  pnlPct: number;
  result: TradeResult;
  agentId: string | null;
  source: "seed" | "agent" | "bot" | "manual";
}

export interface ImprovementLogEntry {
  id: string;
  timestamp: number;
  trigger: string;
  parameterChange: string;
  confidenceDelta: number;
  newConfidence: number;
}

export type AgentStatus = "active" | "paused" | "training";

export interface AgentCore {
  id: string;
  name: string;
  strategy: string;
  strategyType: string;
  icon: LucideIcon;
  iconColor: string;
  status: AgentStatus;
  baseWinRate: number; // seed bias
  selfImprovements: number;
  confidence: number;
  lastImprovement: ImprovementLogEntry | null;
  improvementLog: ImprovementLogEntry[];
  isLearning: boolean;
  learningUntil: number | null;
  sparkline: number[];
}

export interface BotPosition {
  id: string;
  tradeId: string;
  symbol: string;
  side: TradeSide;
  size: number; // base amount
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  agentId: string | null;
}

export type BotLogTag =
  | "SIGNAL"
  | "RISK-CHECK"
  | "ORDER"
  | "STOP-LOSS"
  | "TAKE-PROFIT"
  | "INFO";

export interface BotLogEntry {
  id: string;
  timestamp: number;
  tag: BotLogTag;
  message: string;
}

export interface BotConfig {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxConcurrentPositions: number;
  defaultStopLoss: number; // %
  defaultTakeProfit: number; // %
  riskPerTrade: number; // %
}

export interface BotState {
  running: boolean;
  startedAt: number | null;
  positions: BotPosition[];
  log: BotLogEntry[];
  config: BotConfig;
  tradesPlacedToday: number;
}

// ---- Seeded PRNG (mulberry32) for deterministic initial data ----------------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Trade generation -------------------------------------------------------

const AGENT_IDS = [
  "momentum",
  "reverter",
  "sentiment",
  "breakout",
  "arbitrage",
] as const;

let tradeCounter = 0;
function nextTradeId(prefix: string): string {
  tradeCounter += 1;
  return `${prefix}-${tradeCounter.toString(36)}-${Math.floor(DEMO_NOW / 1000).toString(36)}`;
}

function buildClosedTrade(
  rng: () => number,
  datetime: number,
  isWin: boolean,
  agentId: string | null,
  source: Trade["source"],
): Trade {
  const market = MARKETS[Math.floor(rng() * MARKETS.length)];
  const side: TradeSide = rng() > 0.5 ? "buy" : "sell";
  const amount = Math.round(50 + rng() * 450);
  const entryPrice = market.basePrice * (0.95 + rng() * 0.1);
  const movePct = (0.4 + rng() * 2.8) / 100;
  const winSign = isWin ? 1 : -1;
  const directional = side === "buy" ? 1 : -1;
  const exitPrice = entryPrice * (1 + winSign * movePct * directional);
  const pnl = Math.round(amount * movePct * winSign * 100) / 100;
  const pnlPct = Math.round((pnl / amount) * 10000) / 100;
  const decimals = priceDecimals(entryPrice);
  return {
    id: nextTradeId("seed"),
    status: "closed",
    datetime,
    market: market.label,
    side,
    amount,
    entryPrice: parseFloat(entryPrice.toFixed(decimals)),
    exitPrice: parseFloat(exitPrice.toFixed(decimals)),
    pnl,
    pnlPct,
    result: isWin ? "win" : "loss",
    agentId,
    source,
  };
}

function generateInitialTrades(): Trade[] {
  const rng = mulberry32(hashString("z-terminal-trades-v3"));
  const trades: Trade[] = [];
  const startOfDay = DEMO_NOW - (DEMO_NOW % DAY_MS);

  // ~88 closed trades spread over the previous 29 days.
  for (let i = 0; i < 88; i++) {
    const daysAgo = 1 + Math.floor(rng() * 29);
    const secondsIntoDay = Math.floor(rng() * 64800); // 00:00 - 18:00
    const datetime =
      startOfDay - daysAgo * DAY_MS + secondsIntoDay * 1000;
    const isWin = rng() < 0.62;
    const agentId =
      rng() > 0.18
        ? AGENT_IDS[Math.floor(rng() * AGENT_IDS.length)]
        : null;
    const source: Trade["source"] =
      agentId != null ? "agent" : rng() > 0.4 ? "bot" : "seed";
    trades.push(buildClosedTrade(rng, datetime, isWin, agentId, source));
  }

  // Today: 17 trades, mix of closed + a few open.
  for (let i = 0; i < 17; i++) {
    const secondsIntoDay = Math.floor(rng() * 54000); // earlier in the day
    const datetime = startOfDay + secondsIntoDay * 1000;
    const isOpen = i < 3;
    if (isOpen) {
      const market = MARKETS[Math.floor(rng() * MARKETS.length)];
      const side: TradeSide = rng() > 0.5 ? "buy" : "sell";
      const amount = Math.round(80 + rng() * 380);
      const entryPrice = market.basePrice * (0.98 + rng() * 0.04);
      const decimals = priceDecimals(entryPrice);
      const agentId = AGENT_IDS[Math.floor(rng() * AGENT_IDS.length)];
      trades.push({
        id: nextTradeId("seed"),
        status: "open",
        datetime,
        market: market.label,
        side,
        amount,
        entryPrice: parseFloat(entryPrice.toFixed(decimals)),
        exitPrice: null,
        pnl: 0,
        pnlPct: 0,
        result: null,
        agentId,
        source: "bot",
      });
    } else {
      const isWin = rng() < 0.6;
      const agentId = AGENT_IDS[Math.floor(rng() * AGENT_IDS.length)];
      trades.push(buildClosedTrade(rng, datetime, isWin, agentId, "agent"));
    }
  }

  // Newest first.
  return trades.sort((a, b) => b.datetime - a.datetime);
}

// ---- Agents -----------------------------------------------------------------

function generateAgentImprovements(
  agentId: string,
  baseConfidence: number,
): { log: ImprovementLogEntry[]; confidence: number; count: number } {
  const rng = mulberry32(hashString(agentId + "improvements"));
  const triggers: Record<string, string[]> = {
    momentum: [
      "2 consecutive losses on BTC/USDT",
      "Drawdown exceeded 3% over 24h",
      "Win rate dropped below threshold on SOL/USDT",
      "Slow trend detection on ETH/USDT",
    ],
    reverter: [
      "3 consecutive losses on TSLA",
      "Mean reversion band too wide on BTC/USDT",
      "Overfitting detected on NVDA session",
      "Volatility spike misclassified on BNB/USDT",
    ],
    sentiment: [
      "False positive signal on BTC/USDT news",
      "Sentiment lag caused loss on ETH/USDT",
      "Negative sentiment threshold too loose",
      "Low confidence cluster on XRP/USDT",
    ],
    breakout: [
      "False breakout on SOL/USDT",
      "Volume filter missed on TSLA",
      "Stop placed too tight on BTC/USDT",
      "Breakout confirmation too slow on NVDA",
    ],
    arbitrage: [
      "Spread capture slippage on BTC/USDT",
      "Correlation drift on ETH/SOL pair",
      "Latency spike caused missed fill",
      "Threshold mis-set on BNB/XRP pair",
    ],
  };
  const changes = [
    "Tightened stop-loss 2.0% -> 1.5%",
    "Widened entry band by 0.4%",
    "Raised confidence threshold 60% -> 68%",
    "Shortened holding window 30m -> 18m",
    "Adjusted risk-per-trade 2.5% -> 2.0%",
    "Added volume confirmation gate",
    "Lowered max position size $600 -> $450",
  ];
  const agentTriggers = triggers[agentId] ?? triggers.momentum;
  const count = 3 + Math.floor(rng() * 3); // 3-5 entries
  const log: ImprovementLogEntry[] = [];
  let confidence = baseConfidence;
  let t = DEMO_NOW - 6 * DAY_MS;
  for (let i = 0; i < count; i++) {
    const trigger = agentTriggers[Math.floor(rng() * agentTriggers.length)];
    const change = changes[Math.floor(rng() * changes.length)];
    const delta = 2 + Math.floor(rng() * 5);
    confidence = Math.min(98, confidence + delta);
    t += (6 + Math.floor(rng() * 30)) * 3600 * 1000;
    log.push({
      id: `imp-${agentId}-${i}`,
      timestamp: t,
      trigger,
      parameterChange: change,
      confidenceDelta: delta,
      newConfidence: confidence,
    });
  }
  log.sort((a, b) => b.timestamp - a.timestamp);
  return { log, confidence, count };
}

function generateSparkline(rng: () => number, winRate: number): number[] {
  const out: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < 20; i++) {
    const win = rng() < winRate;
    const magnitude = 5 + rng() * 25;
    cumulative += win ? magnitude : -magnitude * 0.7;
    out.push(Math.round(cumulative * 100) / 100);
  }
  return out;
}

function generateInitialAgents(): AgentCore[] {
  const defs: Array<{
    id: string;
    name: string;
    strategy: string;
    strategyType: string;
    icon: LucideIcon;
    iconColor: string;
    baseWinRate: number;
    baseConfidence: number;
  }> = [
    {
      id: "momentum",
      name: "Momentum Hunter",
      strategy: "Trend Following",
      strategyType: "Momentum",
      icon: Radar,
      iconColor: "#16c784",
      baseWinRate: 0.64,
      baseConfidence: 72,
    },
    {
      id: "reverter",
      name: "Mean Reverter",
      strategy: "Mean Reversion",
      strategyType: "Reversion",
      icon: RefreshCw,
      iconColor: "#f0b90b",
      baseWinRate: 0.58,
      baseConfidence: 68,
    },
    {
      id: "sentiment",
      name: "Sentiment Scalper",
      strategy: "Sentiment Analysis",
      strategyType: "Sentiment",
      icon: BrainCircuit,
      iconColor: "#4f9cf9",
      baseWinRate: 0.71,
      baseConfidence: 81,
    },
    {
      id: "breakout",
      name: "Breakout Sniper",
      strategy: "Breakout Detection",
      strategyType: "Breakout",
      icon: Crosshair,
      iconColor: "#ea3943",
      baseWinRate: 0.62,
      baseConfidence: 74,
    },
    {
      id: "arbitrage",
      name: "Arbitrage Detector",
      strategy: "Statistical Arbitrage",
      strategyType: "Arbitrage",
      icon: Shuffle,
      iconColor: "#a855f7",
      baseWinRate: 0.77,
      baseConfidence: 86,
    },
  ];

  return defs.map((d) => {
    const rng = mulberry32(hashString(d.id + "agent"));
    const { log, confidence, count } = generateAgentImprovements(
      d.id,
      d.baseConfidence,
    );
    return {
      id: d.id,
      name: d.name,
      strategy: d.strategy,
      strategyType: d.strategyType,
      icon: d.icon,
      iconColor: d.iconColor,
      status: "active",
      baseWinRate: d.baseWinRate,
      selfImprovements: count,
      confidence,
      lastImprovement: log[0] ?? null,
      improvementLog: log,
      isLearning: false,
      learningUntil: null,
      sparkline: generateSparkline(rng, d.baseWinRate),
    };
  });
}

// ---- Bot --------------------------------------------------------------------

function generateInitialBotLog(simNow: number): BotLogEntry[] {
  const seed = mulberry32(hashString("bot-log-seed"));
  const entries: BotLogEntry[] = [];
  let t = simNow - 8 * 60 * 1000;
  const agents = ["Momentum Hunter", "Sentiment Scalper", "Breakout Sniper"];
  const seq: Array<[BotLogTag, string]> = [
    ["SIGNAL", `${agents[0]}: BUY BTC/USDT @ 68,420`],
    ["RISK-CHECK", `Position $450, SL 1.5%, risk $6.75 -- APPROVED`],
    ["ORDER", `Placed BUY 0.0066 BTC @ 68,420 (SL @ 67,394)`],
    ["INFO", `Bot heartbeat -- 2 open positions, exposure $720`],
    ["SIGNAL", `${agents[1]}: SELL ETH/USDT @ 3,528`],
    ["RISK-CHECK", `Position $320, SL 1.5%, risk $4.80 -- APPROVED`],
    ["ORDER", `Placed SELL 0.0908 ETH @ 3,528 (SL @ 3,581)`],
    ["INFO", `Risk health green -- daily loss $12 / $200 limit`],
  ];
  for (let i = 0; i < seq.length; i++) {
    t += 30 + Math.floor(seed() * 45) * 1000;
    entries.push({
      id: `blog-seed-${i}`,
      timestamp: t,
      tag: seq[i][0],
      message: seq[i][1],
    });
  }
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

function generateInitialPositions(simNow: number): BotPosition[] {
  const seed = mulberry32(hashString("bot-positions"));
  const defs = [
    { symbol: "BTC/USDT", basePrice: 68420, side: "buy" as const },
    { symbol: "ETH/USDT", basePrice: 3528, side: "sell" as const },
  ];
  return defs.map((d, i) => {
    const entryPrice = d.basePrice * (0.995 + seed() * 0.01);
    const decimals = priceDecimals(entryPrice);
    const size = parseFloat((0.004 + seed() * 0.01).toFixed(4));
    const slPct = 0.015;
    const tpPct = 0.03;
    const sl =
      d.side === "buy"
        ? entryPrice * (1 - slPct)
        : entryPrice * (1 + slPct);
    const tp =
      d.side === "buy"
        ? entryPrice * (1 + tpPct)
        : entryPrice * (1 - tpPct);
    return {
      id: `pos-seed-${i}`,
      tradeId: `botpos-seed-${i}`,
      symbol: d.symbol,
      side: d.side,
      size,
      entryPrice: parseFloat(entryPrice.toFixed(decimals)),
      currentPrice: parseFloat(entryPrice.toFixed(decimals)),
      stopLoss: parseFloat(sl.toFixed(decimals)),
      takeProfit: parseFloat(tp.toFixed(decimals)),
      openedAt: simNow - (4 - i) * 60 * 1000,
      agentId: AGENT_IDS[i % AGENT_IDS.length],
    };
  });
}

// ---- Zustand store ----------------------------------------------------------

interface StoreState {
  simNow: number;
  tickClock: () => void;

  trades: Trade[];
  addTrade: (trade: Trade) => void;
  closeTrade: (
    id: string,
    exitPrice: number,
    pnl: number,
    pnlPct: number,
    result: "win" | "loss",
  ) => void;

  agents: AgentCore[];
  setAgentLearning: (agentId: string, learning: boolean, until: number | null) => void;
  addAgentImprovement: (
    agentId: string,
    trigger: string,
    parameterChange: string,
  ) => void;
  toggleAgentStatus: (agentId: string) => void;
  pushAgentSparkline: (agentId: string, value: number) => void;
  clearExpiredLearning: () => void;

  bot: BotState;
  setBotRunning: (running: boolean) => void;
  updateBotConfig: (patch: Partial<BotConfig>) => void;
  addBotLog: (tag: BotLogEntry["tag"], message: string) => void;
  openBotPosition: (pos: BotPosition, trade: Trade) => void;
  closeBotPosition: (
    posId: string,
    exitPrice: number,
    reason: "SL" | "TP" | "manual",
  ) => void;
  driftBotPositions: () => void;
  bumpTradesPlacedToday: () => void;

  // Simulation actions (called from the shell on intervals).
  simulateAgentTick: () => void;
  simulateBotTick: () => void;
}

const initialTrades = generateInitialTrades();
const initialAgents = generateInitialAgents();
const initialBotLog = generateInitialBotLog(DEMO_NOW);
const initialPositions = generateInitialPositions(DEMO_NOW);

// Improvement trigger phrases for live agent self-improvement.
const IMPROVEMENT_TRIGGERS = [
  "Recent loss on BTC/USDT",
  "Win rate dip on SOL/USDT",
  "Drawdown threshold breached",
  "Consecutive losses on ETH/USDT",
  "Volatility misread on NVDA",
  "Slow signal on TSLA",
  "Slippage on BNB/USDT",
];
const IMPROVEMENT_CHANGES = [
  "Tightened stop-loss by 0.4%",
  "Raised confidence threshold +4%",
  "Shortened holding window by 6m",
  "Lowered risk-per-trade by 0.3%",
  "Added volume confirmation gate",
  "Narrowed entry band by 0.2%",
];

let liveCounter = 0;
function liveId(prefix: string): string {
  liveCounter += 1;
  return `${prefix}-live-${liveCounter}`;
}

export const useStore = create<StoreState>((set, get) => ({
  simNow: DEMO_NOW,
  tickClock: () => set((s) => ({ simNow: s.simNow + 1000 })),

  trades: initialTrades,
  addTrade: (trade) =>
    set((s) => ({ trades: [trade, ...s.trades].slice(0, 600) })),
  closeTrade: (id, exitPrice, pnl, pnlPct, result) =>
    set((s) => ({
      trades: s.trades.map((t) =>
        t.id === id
          ? {
              ...t,
              status: "closed",
              exitPrice,
              pnl,
              pnlPct,
              result,
            }
          : t,
      ),
    })),

  agents: initialAgents,
  setAgentLearning: (agentId, learning, until) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId
          ? { ...a, isLearning: learning, learningUntil: until }
          : a,
      ),
    })),
  addAgentImprovement: (agentId, trigger, parameterChange) =>
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== agentId) return a;
        const delta = 2 + Math.floor(Math.random() * 5);
        const newConfidence = Math.min(98, a.confidence + delta);
        const entry: ImprovementLogEntry = {
          id: liveId(`imp-${agentId}`),
          timestamp: get().simNow,
          trigger,
          parameterChange,
          confidenceDelta: delta,
          newConfidence,
        };
        return {
          ...a,
          confidence: newConfidence,
          selfImprovements: a.selfImprovements + 1,
          lastImprovement: entry,
          improvementLog: [entry, ...a.improvementLog].slice(0, 40),
          isLearning: true,
          learningUntil: get().simNow + 4000,
        };
      }),
    })),
  toggleAgentStatus: (agentId) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId
          ? {
              ...a,
              status:
                a.status === "active"
                  ? "paused"
                  : (a.status === "paused" ? "active" : a.status),
            }
          : a,
      ),
    })),
  pushAgentSparkline: (agentId, value) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId
          ? { ...a, sparkline: [...a.sparkline.slice(-19), value] }
          : a,
      ),
    })),
  clearExpiredLearning: () =>
    set((s) => {
      const now = s.simNow;
      let changed = false;
      const agents = s.agents.map((a) => {
        if (a.isLearning && (a.learningUntil ?? 0) <= now) {
          changed = true;
          return { ...a, isLearning: false, learningUntil: null };
        }
        return a;
      });
      return changed ? { agents } : s;
    }),

  bot: {
    running: true,
    startedAt: DEMO_NOW - 8 * 60 * 1000,
    positions: initialPositions,
    log: initialBotLog,
    config: {
      maxPositionSize: 500,
      maxDailyLoss: 200,
      maxConcurrentPositions: 5,
      defaultStopLoss: 1.5,
      defaultTakeProfit: 3.0,
      riskPerTrade: 2,
    },
    tradesPlacedToday: 14,
  },
  setBotRunning: (running) =>
    set((s) => ({
      bot: {
        ...s.bot,
        running,
        startedAt: running ? s.simNow : s.bot.startedAt,
        log: running
          ? s.bot.log
          : [
              {
                id: liveId("blog"),
                timestamp: s.simNow,
                tag: "INFO",
                message: "Bot stopped -- press Start to resume",
              },
              ...s.bot.log,
            ].slice(0, 100),
      },
    })),
  updateBotConfig: (patch) =>
    set((s) => ({ bot: { ...s.bot, config: { ...s.bot.config, ...patch } } })),
  addBotLog: (tag, message) =>
    set((s) => ({
      bot: {
        ...s.bot,
        log: [
          { id: liveId("blog"), timestamp: s.simNow, tag, message },
          ...s.bot.log,
        ].slice(0, 100),
      },
    })),
  openBotPosition: (pos, trade) =>
    set((s) => ({
      trades: [trade, ...s.trades],
      bot: {
        ...s.bot,
        positions: [...s.bot.positions, pos],
        tradesPlacedToday: s.bot.tradesPlacedToday + 1,
      },
    })),
  closeBotPosition: (posId, exitPrice, reason) =>
    set((s) => {
      const pos = s.bot.positions.find((p) => p.id === posId);
      if (!pos) return s;
      const dir = pos.side === "buy" ? 1 : -1;
      const pnl =
        Math.round(
          (exitPrice - pos.entryPrice) * dir * pos.size * 100,
        ) / 100;
      const pnlPct =
        Math.round(
          ((exitPrice - pos.entryPrice) / pos.entryPrice) * dir * 10000,
        ) / 100;
      const result: "win" | "loss" = pnl >= 0 ? "win" : "loss";
      const tag: BotLogTag = reason === "SL" ? "STOP-LOSS" : "TAKE-PROFIT";
      const message =
        reason === "SL"
          ? `Triggered SELL ${pos.size} ${pos.symbol.split("/")[0]} @ ${formatPrice(
              exitPrice,
            )} (loss -$${Math.abs(pnl).toFixed(2)})`
          : reason === "TP"
            ? `Take-profit hit SELL ${pos.size} ${pos.symbol.split("/")[0]} @ ${formatPrice(
                exitPrice,
              )} (profit +$${pnl.toFixed(2)})`
            : `Manually closed ${pos.symbol} @ ${formatPrice(exitPrice)} (${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)})`;
      return {
        trades: s.trades.map((t) =>
          t.id === pos.tradeId
            ? {
                ...t,
                status: "closed",
                exitPrice,
                pnl,
                pnlPct,
                result,
              }
            : t,
        ),
        bot: {
          ...s.bot,
          positions: s.bot.positions.filter((p) => p.id !== posId),
          log: [
            { id: liveId("blog"), timestamp: s.simNow, tag, message },
            ...s.bot.log,
          ].slice(0, 100),
        },
      };
    }),
  driftBotPositions: () =>
    set((s) => {
      if (s.bot.positions.length === 0) return s;
      const updated = s.bot.positions.map((p) => {
        const drift = p.currentPrice * (Math.random() * 0.0012 - 0.0006);
        const next = Math.max(p.currentPrice + drift, p.entryPrice * 0.5);
        const decimals = priceDecimals(next);
        return { ...p, currentPrice: parseFloat(next.toFixed(decimals)) };
      });
      return { bot: { ...s.bot, positions: updated } };
    }),
  bumpTradesPlacedToday: () =>
    set((s) => ({
      bot: { ...s.bot, tradesPlacedToday: s.bot.tradesPlacedToday + 1 },
    })),

  // --- Agent simulation: every call picks a random active agent and either
  // executes a new (closed) trade or, if it just lost, self-improves. ---
  simulateAgentTick: () => {
    const state = get();
    const activeAgents = state.agents.filter((a) => a.status !== "paused");
    if (activeAgents.length === 0) return;
    const agent =
      activeAgents[Math.floor(Math.random() * activeAgents.length)];
    const market = MARKETS[Math.floor(Math.random() * MARKETS.length)];
    const side: TradeSide = Math.random() > 0.5 ? "buy" : "sell";
    const amount = Math.round(50 + Math.random() * 350);
    const entryPrice = market.basePrice * (0.98 + Math.random() * 0.04);
    const decimals = priceDecimals(entryPrice);
    const isWin = Math.random() < agent.baseWinRate;
    const movePct = (0.3 + Math.random() * 1.8) / 100;
    const dir = side === "buy" ? 1 : -1;
    const exitPrice = entryPrice * (1 + (isWin ? 1 : -1) * movePct * dir);
    const pnl = Math.round(amount * movePct * (isWin ? 1 : -1) * 100) / 100;
    const pnlPct = Math.round((pnl / amount) * 10000) / 100;
    const trade: Trade = {
      id: liveId("agent-trade"),
      status: "closed",
      datetime: state.simNow,
      market: market.label,
      side,
      amount,
      entryPrice: parseFloat(entryPrice.toFixed(decimals)),
      exitPrice: parseFloat(exitPrice.toFixed(decimals)),
      pnl,
      pnlPct,
      result: isWin ? "win" : "loss",
      agentId: agent.id,
      source: "agent",
    };
    state.addTrade(trade);
    state.pushAgentSparkline(agent.id, pnl);
    if (!isWin) {
      // Self-improvement triggered by the loss.
      const trigger =
        IMPROVEMENT_TRIGGERS[
          Math.floor(Math.random() * IMPROVEMENT_TRIGGERS.length)
        ];
      const change =
        IMPROVEMENT_CHANGES[
          Math.floor(Math.random() * IMPROVEMENT_CHANGES.length)
        ];
      state.addAgentImprovement(agent.id, trigger, change);
    }
  },

  // --- Bot simulation: SIGNAL -> RISK-CHECK -> ORDER cycle when running. ---
  simulateBotTick: () => {
    const state = get();
    if (!state.bot.running) return;
    const { bot } = state;
    const todayLoss = Math.abs(
      state.trades
        .filter(
          (t) =>
            t.status === "closed" &&
            t.source === "bot" &&
            t.datetime >= state.simNow - DAY_MS &&
            t.pnl < 0,
        )
        .reduce((sum, t) => sum + t.pnl, 0),
    );
    const agent =
      state.agents[Math.floor(Math.random() * state.agents.length)];
    const market = MARKETS[Math.floor(Math.random() * MARKETS.length)];
    const side: TradeSide = Math.random() > 0.5 ? "buy" : "sell";
    const price = market.basePrice * (0.995 + Math.random() * 0.01);
    const decimals = priceDecimals(price);

    // SIGNAL
    const agentName = agent ? agent.name : "Bot Core";
    state.addBotLog(
      "SIGNAL",
      `${agentName}: ${side.toUpperCase()} ${market.label} @ ${formatPrice(price)}`,
    );

    // RISK-CHECK
    const canOpen =
      bot.positions.length < bot.config.maxConcurrentPositions &&
      bot.config.maxPositionSize > 0 &&
      todayLoss < bot.config.maxDailyLoss;

    if (!canOpen) {
      const reason =
        bot.positions.length >= bot.config.maxConcurrentPositions
          ? `Max concurrent (${bot.config.maxConcurrentPositions}) reached`
          : `Daily loss limit $${bot.config.maxDailyLoss} approached`;
      state.addBotLog("RISK-CHECK", `${reason} -- REJECTED`);
      return;
    }
    const positionSize = Math.min(
      bot.config.maxPositionSize,
      Math.round(80 + Math.random() * 420),
    );
    const slPct = bot.config.defaultStopLoss / 100;
    const tpPct = bot.config.defaultTakeProfit / 100;
    const riskAmt = Math.round(positionSize * slPct * 100) / 100;
    state.addBotLog(
      "RISK-CHECK",
      `Position $${positionSize}, SL ${bot.config.defaultStopLoss}%, risk $${riskAmt.toFixed(
        2,
      )} -- APPROVED`,
    );

    // ORDER
    const size =
      Math.round((positionSize / price) * 10000) / 10000;
    const sl =
      side === "buy" ? price * (1 - slPct) : price * (1 + slPct);
    const tp =
      side === "buy" ? price * (1 + tpPct) : price * (1 - tpPct);
    const posId = liveId("pos");
    const tradeId = liveId("bot-trade");
    const trade: Trade = {
      id: tradeId,
      status: "open",
      datetime: state.simNow,
      market: market.label,
      side,
      amount: positionSize,
      entryPrice: parseFloat(price.toFixed(decimals)),
      exitPrice: null,
      pnl: 0,
      pnlPct: 0,
      result: null,
      agentId: agent ? agent.id : null,
      source: "bot",
    };
    const pos: BotPosition = {
      id: posId,
      tradeId,
      symbol: market.label,
      side,
      size,
      entryPrice: parseFloat(price.toFixed(decimals)),
      currentPrice: parseFloat(price.toFixed(decimals)),
      stopLoss: parseFloat(sl.toFixed(decimals)),
      takeProfit: parseFloat(tp.toFixed(decimals)),
      openedAt: state.simNow,
      agentId: agent ? agent.id : null,
    };
    state.openBotPosition(pos, trade);
    state.addBotLog(
      "ORDER",
      `Placed ${side.toUpperCase()} ${size} ${market.label.split("/")[0]} @ ${formatPrice(
        price,
      )} (SL @ ${formatPrice(sl)}, TP @ ${formatPrice(tp)})`,
    );
  },
}));

// ---- Public hooks (the views consume these) ---------------------------------

export function useTrades(): Trade[] {
  return useStore((s) => s.trades);
}

export interface AgentView extends AgentCore {
  totalTrades: number;
  winRate: number;
  pnl: number;
}

export function useAgents(): AgentView[] {
  const agents = useStore((s) => s.agents);
  const trades = useStore((s) => s.trades);
  return useMemo(
    () =>
      agents.map((a) => {
        const agentTrades = trades.filter(
          (t) => t.agentId === a.id && t.status === "closed",
        );
        const wins = agentTrades.filter((t) => t.result === "win").length;
        const pnl = agentTrades.reduce((sum, t) => sum + t.pnl, 0);
        const totalTrades = agentTrades.length;
        return {
          ...a,
          totalTrades,
          winRate:
            totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0,
          pnl: Math.round(pnl * 100) / 100,
        };
      }),
    [agents, trades],
  );
}

export function useBot(): BotState {
  return useStore((s) => s.bot);
}

export function useSimNow(): number {
  return useStore((s) => s.simNow);
}

// ---- Formatting helpers shared across views ---------------------------------

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

export function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---- Report helpers (CSV + printable structure) -----------------------------

export interface ReportFile {
  id: string;
  name: string;
  type: "PDF" | "CSV";
  generatedAt: number;
  size: string;
}

export const INITIAL_REPORTS: ReportFile[] = [
  {
    id: "r1",
    name: "daily-report-2024-11-26.pdf",
    type: "PDF",
    generatedAt: DEMO_NOW - DAY_MS,
    size: "184 KB",
  },
  {
    id: "r2",
    name: "weekly-summary-2024-11-20_to_2024-11-26.pdf",
    type: "PDF",
    generatedAt: DEMO_NOW - DAY_MS - 3600_000,
    size: "412 KB",
  },
  {
    id: "r3",
    name: "trade-history-2024-11-01_to_2024-11-26.csv",
    type: "CSV",
    generatedAt: DEMO_NOW - 2 * DAY_MS,
    size: "28 KB",
  },
  {
    id: "r4",
    name: "agent-performance-2024-11-01_to_2024-11-26.csv",
    type: "CSV",
    generatedAt: DEMO_NOW - 3 * DAY_MS,
    size: "9 KB",
  },
  {
    id: "r5",
    name: "daily-report-2024-11-25.pdf",
    type: "PDF",
    generatedAt: DEMO_NOW - 2 * DAY_MS - 7200_000,
    size: "171 KB",
  },
];

export function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function tradesToCsv(trades: Trade[]): string {
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
  lastImprovement: ImprovementLogEntry | null;
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
