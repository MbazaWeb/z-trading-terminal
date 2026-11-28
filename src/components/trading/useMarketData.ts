"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchCandles,
  fetchOrderBook,
  fetchRecentTrades,
  fetchTicker,
  findSymbol,
  SYMBOLS as BINANCE_SYMBOLS,
} from "@/lib/binance";
import {
  formatAmount,
  formatCompact,
  formatPrice,
  priceDecimals,
} from "@/lib/format";
import { smaSeries } from "@/lib/agents/indicators";
import type {
  Candle,
  OrderBook,
  SymbolInfo,
  TickerStats,
  Timeframe,
  Trade,
} from "./types";

// ---- Static symbol catalogue (re-exported for back-compat) -----------------

export const SYMBOLS: SymbolInfo[] = BINANCE_SYMBOLS.map((s) => ({
  id: s.id,
  label: s.label,
  base: s.base,
  quote: s.quote,
  kind: "crypto",
  name: s.name,
}));

export const TIMEFRAMES: Timeframe[] = [
  "1m",
  "5m",
  "15m",
  "1H",
  "4H",
  "1D",
  "1W",
];

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1H",
  "4H": "4H",
  "1D": "1D",
  "1W": "1W",
};

// ---- Format helpers (re-exported for downstream components) ----------------

export {
  formatAmount,
  formatCompact,
  formatPrice,
  priceDecimals,
  smaSeries as sma,
};

// ---- Hook return type -------------------------------------------------------

export interface MarketState {
  symbols: SymbolInfo[];
  activeSymbol: SymbolInfo;
  timeframe: Timeframe;
  candles: Candle[];
  stats: TickerStats;
  orderBook: OrderBook;
  trades: Trade[];
  lastPriceDirection: "up" | "down" | "flat";
  /** Live mid/last price for the active symbol. */
  livePrice: number;
  /** Switch the active symbol by id. */
  selectSymbol: (id: string) => void;
  /** Switch the chart timeframe. */
  setTimeframe: (tf: Timeframe) => void;
  /** True while the initial fetch is in flight. */
  loading: boolean;
  /** Last error message from the Binance API (null when healthy). */
  error: string | null;
}

// Empty defaults so consumers can render a skeleton before the first fetch
// resolves without crashing on undefined fields.
const EMPTY_STATS: TickerStats = {
  lastPrice: 0,
  open24h: 0,
  changeAbs: 0,
  changePercent: 0,
  high24h: 0,
  low24h: 0,
  volume24h: 0,
  volumeBase24h: 0,
};

const EMPTY_ORDER_BOOK: OrderBook = {
  asks: [],
  bids: [],
  spread: 0,
  spreadPercent: 0,
  midPrice: 0,
};

export function useMarketData(initialSymbolId = "BTCUSDT"): MarketState {
  const [activeSymbolId, setActiveSymbolId] = useState(initialSymbolId);
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");

  const activeSymbol = useMemo(
    () => {
      const found = SYMBOLS.find((s) => s.id === activeSymbolId);
      if (found) return found;
      const fallback = findSymbol(activeSymbolId);
      return {
        id: fallback.id,
        label: fallback.label,
        base: fallback.base,
        quote: fallback.quote,
        kind: "crypto" as const,
        name: fallback.name,
      };
    },
    [activeSymbolId],
  );

  const [candles, setCandles] = useState<Candle[]>([]);
  const [stats, setStats] = useState<TickerStats>(EMPTY_STATS);
  const [orderBook, setOrderBook] = useState<OrderBook>(EMPTY_ORDER_BOOK);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [livePrice, setLivePrice] = useState(0);
  const [lastPriceDirection, setLastPriceDirection] = useState<
    "up" | "down" | "flat"
  >("flat");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track the previous live price so we can derive a direction without an
  // extra render cycle.
  const prevPriceRef = useRef(0);

  // Initial + on-symbol/timeframe-change load: fetch candles, ticker, order
  // book, and recent trades in parallel.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        const [c, t, ob, rt] = await Promise.all([
          fetchCandles(activeSymbol.id, timeframe, 150),
          fetchTicker(activeSymbol.id),
          fetchOrderBook(activeSymbol.id, 20),
          fetchRecentTrades(activeSymbol.id, 30),
        ]);
        if (cancelled) return;
        setCandles(c);
        setStats(t);
        setOrderBook(ob);
        setTrades(rt);
        setLivePrice(t.lastPrice);
        prevPriceRef.current = t.lastPrice;
        setLastPriceDirection("flat");
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          setError(msg);
          toast.error("Failed to load market data from Binance", {
            description: msg,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeSymbol.id, timeframe]);

  // Poll ticker every 5s — keeps the live price + 24h stats fresh.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const t = await fetchTicker(activeSymbol.id);
        setStats(t);
        const prev = prevPriceRef.current;
        setLastPriceDirection(
          t.lastPrice > prev ? "up" : t.lastPrice < prev ? "down" : "flat",
        );
        prevPriceRef.current = t.lastPrice;
        setLivePrice(t.lastPrice);
        // Patch the last candle so the chart reflects the live price.
        setCandles((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              close: t.lastPrice,
              high: Math.max(last.high, t.lastPrice),
              low: Math.min(last.low, t.lastPrice),
            },
          ];
        });
      } catch {
        // Silently ignore polling errors — the previous values stay on screen.
      }
    }, 5000);
    return () => clearInterval(id);
  }, [activeSymbol.id]);

  // Poll order book every 3s.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const ob = await fetchOrderBook(activeSymbol.id, 20);
        setOrderBook(ob);
      } catch {
        /* keep last known */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [activeSymbol.id]);

  // Poll recent trades every 6s.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const rt = await fetchRecentTrades(activeSymbol.id, 30);
        setTrades(rt);
      } catch {
        /* keep last known */
      }
    }, 6000);
    return () => clearInterval(id);
  }, [activeSymbol.id]);

  const selectSymbol = useCallback((id: string) => {
    setActiveSymbolId(id);
  }, []);

  const setTimeframeSafe = useCallback((tf: Timeframe) => setTimeframe(tf), []);

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
    loading,
    error,
  };
}
