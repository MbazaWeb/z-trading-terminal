"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Candle,
  OrderBook,
  OrderBookRow,
  SymbolInfo,
  TickerStats,
  Timeframe,
  Trade,
} from "./types";

// ---- Static symbol catalogue -----------------------------------------------

export const SYMBOLS: SymbolInfo[] = [
  {
    id: "BTCUSDT",
    label: "BTC/USDT",
    base: "BTC",
    quote: "USDT",
    kind: "crypto",
    name: "Bitcoin",
    basePrice: 68420,
    marketCap: 1_348_000_000_000,
  },
  {
    id: "ETHUSDT",
    label: "ETH/USDT",
    base: "ETH",
    quote: "USDT",
    kind: "crypto",
    name: "Ethereum",
    basePrice: 3528,
    marketCap: 424_000_000_000,
  },
  {
    id: "SOLUSDT",
    label: "SOL/USDT",
    base: "SOL",
    quote: "USDT",
    kind: "crypto",
    name: "Solana",
    basePrice: 165.4,
    marketCap: 76_200_000_000,
  },
  {
    id: "BNBUSDT",
    label: "BNB/USDT",
    base: "BNB",
    quote: "USDT",
    kind: "crypto",
    name: "BNB",
    basePrice: 588.2,
    marketCap: 86_500_000_000,
  },
  {
    id: "XRPUSDT",
    label: "XRP/USDT",
    base: "XRP",
    quote: "USDT",
    kind: "crypto",
    name: "XRP",
    basePrice: 0.6125,
    marketCap: 33_100_000_000,
  },
  {
    id: "AAPL",
    label: "AAPL",
    base: "AAPL",
    quote: "USD",
    kind: "stock",
    name: "Apple Inc.",
    basePrice: 225.8,
    peRatio: 34.2,
  },
  {
    id: "TSLA",
    label: "TSLA",
    base: "TSLA",
    quote: "USD",
    kind: "stock",
    name: "Tesla Inc.",
    basePrice: 341.6,
    peRatio: 71.8,
  },
  {
    id: "NVDA",
    label: "NVDA",
    base: "NVDA",
    quote: "USD",
    kind: "stock",
    name: "NVIDIA Corp.",
    basePrice: 884.3,
    peRatio: 62.5,
  },
];

export const TIMEFRAMES: Timeframe[] = [
  "1m",
  "5m",
  "15m",
  "1H",
  "4H",
  "1D",
  "1W",
];

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 14400,
  "1D": 86400,
  "1W": 604800,
};

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1H",
  "4H": "4H",
  "1D": "1D",
  "1W": "1W",
};

// ---- Seeded PRNG (mulberry32) so data is stable per symbol+timeframe --------

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

// ---- Price formatting helpers ----------------------------------------------

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

// ---- Candle generation ------------------------------------------------------

function generateCandles(
  symbol: SymbolInfo,
  timeframe: Timeframe,
  count = 150,
): Candle[] {
  const seed = hashString(`${symbol.id}|${timeframe}`);
  const rng = mulberry32(seed);
  const tfSeconds = TIMEFRAME_SECONDS[timeframe];

  // Volatility scales with the square root of timeframe (in minutes),
  // so higher timeframes produce wider but proportional candles.
  const tfMinutes = tfSeconds / 60;
  const tfFactor = Math.sqrt(Math.max(tfMinutes, 1));
  const volatility = symbol.basePrice * 0.006 * tfFactor;
  const drift = (rng() - 0.5) * volatility * 0.08;

  const now = Date.now();
  // Align the last candle open to the timeframe boundary.
  const lastOpen = Math.floor(now / (tfSeconds * 1000)) * tfSeconds * 1000;
  const startTime = lastOpen - (count - 1) * tfSeconds * 1000;

  let price = symbol.basePrice * (0.96 + rng() * 0.08);
  const candles: Candle[] = [];

  for (let i = 0; i < count; i++) {
    const open = price;
    // Random-walk step with mild mean reversion toward base price.
    const meanRevert = (symbol.basePrice - open) / symbol.basePrice;
    const change =
      (rng() - 0.5) * 2 * volatility + drift + meanRevert * volatility * 0.15;
    const close = Math.max(open + change, symbol.basePrice * 0.2);
    const wickRange = volatility * (0.4 + rng() * 0.9);
    const high = Math.max(open, close) + rng() * wickRange;
    const low = Math.min(open, close) - rng() * wickRange;
    const bodySize = Math.abs(close - open);
    const baseVolume =
      (1_000_000 / symbol.basePrice) * (0.6 + rng() * 1.6) * tfFactor;
    const volume =
      baseVolume * (0.7 + (bodySize / volatility) * 0.8) * (0.5 + rng());
    candles.push({
      time: startTime + i * tfSeconds * 1000,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }
  return candles;
}

// ---- Order book generation --------------------------------------------------

function generateOrderBook(
  lastPrice: number,
  symbol: SymbolInfo,
  seedExtra: number,
): OrderBook {
  const rng = mulberry32(hashString(symbol.id) ^ (seedExtra | 0));
  const decimals = priceDecimals(lastPrice);
  const tick = lastPrice * 0.0001;
  const tickRounded = parseFloat(tick.toFixed(decimals));

  const rows = 10;
  const asks: OrderBookRow[] = [];
  const bids: OrderBookRow[] = [];
  let askTotal = 0;
  let bidTotal = 0;

  // Asks ascend from just above mid price.
  for (let i = 0; i < rows; i++) {
    const price = lastPrice + tickRounded * (i + 1) * (1 + rng() * 0.6);
    const amount = parseFloat((rng() * 12 + 0.2).toFixed(4));
    askTotal += amount;
    asks.push({
      price: parseFloat(price.toFixed(decimals)),
      amount,
      total: askTotal,
    });
  }
  // Bids descend from just below mid price.
  for (let i = 0; i < rows; i++) {
    const price = lastPrice - tickRounded * (i + 1) * (1 + rng() * 0.6);
    const amount = parseFloat((rng() * 12 + 0.2).toFixed(4));
    bidTotal += amount;
    bids.push({
      price: parseFloat(price.toFixed(decimals)),
      amount,
      total: bidTotal,
    });
  }

  const bestAsk = asks[0].price;
  const bestBid = bids[0].price;
  const spread = bestAsk - bestBid;
  const midPrice = (bestAsk + bestBid) / 2;

  return {
    asks,
    bids,
    spread,
    spreadPercent: (spread / midPrice) * 100,
    midPrice,
  };
}

// ---- Recent trades generation ----------------------------------------------

function generateTrades(
  lastPrice: number,
  symbol: SymbolInfo,
  count = 28,
): Trade[] {
  const rng = mulberry32(
    hashString(symbol.id + "trades") ^ Math.floor(Date.now() / 1000),
  );
  const now = Date.now();
  const trades: Trade[] = [];
  for (let i = 0; i < count; i++) {
    const side: Trade["side"] = rng() > 0.5 ? "buy" : "sell";
    const priceOffset = (rng() - 0.5) * lastPrice * 0.0008;
    const price = parseFloat(
      (lastPrice + priceOffset).toFixed(priceDecimals(lastPrice)),
    );
    const amount = parseFloat((rng() * 4 + 0.005).toFixed(4));
    trades.push({
      id: `seed-${i}-${Math.floor(now / 1000)}`,
      price,
      amount,
      time: now - i * (1500 + rng() * 2500),
      side,
    });
  }
  return trades;
}

function makeTrade(
  price: number,
  amount: number,
  side: Trade["side"],
): Trade {
  return {
    id: `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    price,
    amount,
    time: Date.now(),
    side,
  };
}

// ---- Ticker stats derivation -----------------------------------------------

function deriveStats(
  candles: Candle[],
  symbol: SymbolInfo,
  livePrice: number,
): TickerStats {
  // Treat the visible window as the "24h" sample for the ticker strip.
  const window = candles.slice(-96);
  const highs = window.map((c) => c.high);
  const lows = window.map((c) => c.low);
  const high24h = Math.max(...highs, livePrice);
  const low24h = Math.min(...lows, livePrice);
  const open24h = window.length > 0 ? window[0].open : livePrice;
  const changeAbs = livePrice - open24h;
  const changePercent = (changeAbs / open24h) * 100;
  const volumeBase24h = window.reduce((sum, c) => sum + c.volume, 0);
  const volume24h = volumeBase24h * livePrice;

  return {
    lastPrice: livePrice,
    open24h,
    changeAbs,
    changePercent,
    high24h,
    low24h,
    volume24h,
    volumeBase24h,
    marketCap: symbol.marketCap,
    peRatio: symbol.peRatio,
  };
}

// ---- Hook -------------------------------------------------------------------

export interface MarketState {
  symbols: SymbolInfo[];
  activeSymbol: SymbolInfo;
  timeframe: Timeframe;
  candles: Candle[];
  stats: TickerStats;
  orderBook: OrderBook;
  trades: Trade[];
  lastPriceDirection: "up" | "down" | "flat";
}

export function useMarketData(initialSymbolId = "BTCUSDT") {
  const [activeSymbolId, setActiveSymbolId] = useState(initialSymbolId);
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");

  const activeSymbol = useMemo(
    () => SYMBOLS.find((s) => s.id === activeSymbolId) ?? SYMBOLS[0],
    [activeSymbolId],
  );

  const baseCandles = useMemo(
    () => generateCandles(activeSymbol, timeframe),
    [activeSymbol, timeframe],
  );

  // Deterministic seed values derived from the base candle series.
  const seedPrice = useMemo(
    () =>
      baseCandles.length
        ? baseCandles[baseCandles.length - 1].close
        : activeSymbol.basePrice,
    [baseCandles, activeSymbol],
  );
  const initialOrderBook = useMemo(
    () => generateOrderBook(seedPrice, activeSymbol, 0),
    [seedPrice, activeSymbol],
  );
  const initialTrades = useMemo(
    () => generateTrades(seedPrice, activeSymbol),
    [seedPrice, activeSymbol],
  );

  const [livePrice, setLivePrice] = useState<number>(seedPrice);
  const [orderBook, setOrderBook] = useState<OrderBook>(initialOrderBook);
  const [trades, setTrades] = useState<Trade[]>(initialTrades);
  const [lastPriceDirection, setLastPriceDirection] = useState<
    "up" | "down" | "flat"
  >("flat");

  // Reset live state when the symbol or timeframe changes. This is the
  // React-recommended "adjust state during render" pattern, which avoids
  // setState-in-effect and keeps the live data consistent with the chart.
  const resetKey = `${activeSymbol.id}|${timeframe}`;
  const [appliedResetKey, setAppliedResetKey] = useState(resetKey);
  if (appliedResetKey !== resetKey) {
    setAppliedResetKey(resetKey);
    setLivePrice(seedPrice);
    setLastPriceDirection("flat");
    setOrderBook(initialOrderBook);
    setTrades(initialTrades);
  }

  // Live ticker loop: nudge the price, append trades, refresh the order book.
  // Subscribes on symbol change and re-subscribes on each price update so the
  // closure always sees the freshest price as its starting point. All setState
  // calls happen inside the interval callback (never in the effect body).
  useEffect(() => {
    let current = livePrice;
    const interval = setInterval(() => {
      const step = current * (Math.random() * 0.0016 - 0.0008);
      const nextPrice = Math.max(
        current + step,
        activeSymbol.basePrice * 0.2,
      );
      setLastPriceDirection(
        nextPrice > current ? "up" : nextPrice < current ? "down" : "flat",
      );
      current = nextPrice;
      setLivePrice(nextPrice);

      // Append a trade on most ticks.
      if (Math.random() > 0.35) {
        const side: Trade["side"] = Math.random() > 0.5 ? "buy" : "sell";
        const decimals = priceDecimals(nextPrice);
        const trade = makeTrade(
          parseFloat(
            (nextPrice * (1 + (Math.random() - 0.5) * 0.0006)).toFixed(decimals),
          ),
          parseFloat((Math.random() * 3 + 0.01).toFixed(4)),
          side,
        );
        setTrades((prev) => [trade, ...prev].slice(0, 40));
      }

      // Refresh order book around the new price.
      setOrderBook(
        generateOrderBook(nextPrice, activeSymbol, Date.now() & 0xffff),
      );
    }, 2000);
    return () => clearInterval(interval);
  }, [activeSymbol, livePrice]);

  // Live candles: clone base candles and apply the live price to the last one.
  const candles = useMemo<Candle[]>(() => {
    if (baseCandles.length === 0) return baseCandles;
    const next = baseCandles.slice();
    const lastIdx = next.length - 1;
    const last = next[lastIdx];
    next[lastIdx] = {
      ...last,
      close: livePrice,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
    };
    return next;
  }, [baseCandles, livePrice]);

  const stats = useMemo(
    () => deriveStats(baseCandles, activeSymbol, livePrice),
    [baseCandles, activeSymbol, livePrice],
  );

  const setTimeframeSafe = useCallback((tf: Timeframe) => setTimeframe(tf), []);
  const selectSymbol = useCallback((id: string) => setActiveSymbolId(id), []);

  return {
    symbols: SYMBOLS,
    activeSymbol,
    timeframe,
    candles,
    stats,
    orderBook,
    trades,
    lastPriceDirection,
    setTimeframe: setTimeframeSafe,
    selectSymbol,
    livePrice,
  };
}

// ---- Moving average helper (used by the chart) -----------------------------

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}
