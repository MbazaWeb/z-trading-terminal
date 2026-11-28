"use client";

// Binance public REST API client.
//
// All endpoints below are public and CORS-enabled, so they can be called
// directly from the browser without an API key or proxy. We wrap every call in
// a tiny in-memory cache (3s default) so the same endpoint is never hit more
// than once per ~3 seconds — this keeps us well under Binance's rate limits
// even when multiple components (chart, ticker tape, order book, agents) poll
// concurrently.
//
// Docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api

import type {
  Candle,
  OrderBook,
  OrderBookRow,
  TickerStats,
  Trade,
} from "@/components/trading/types";

const BASE_URL = "https://api.binance.com";

// ---- Symbol catalogue -------------------------------------------------------

export interface BinanceSymbol {
  id: string;
  label: string;
  base: string;
  quote: string;
  kind: "crypto";
  name: string;
}

export const SYMBOLS: BinanceSymbol[] = [
  { id: "BTCUSDT", label: "BTC/USDT", base: "BTC", quote: "USDT", kind: "crypto", name: "Bitcoin" },
  { id: "ETHUSDT", label: "ETH/USDT", base: "ETH", quote: "USDT", kind: "crypto", name: "Ethereum" },
  { id: "SOLUSDT", label: "SOL/USDT", base: "SOL", quote: "USDT", kind: "crypto", name: "Solana" },
  { id: "BNBUSDT", label: "BNB/USDT", base: "BNB", quote: "USDT", kind: "crypto", name: "BNB" },
  { id: "XRPUSDT", label: "XRP/USDT", base: "XRP", quote: "USDT", kind: "crypto", name: "XRP" },
  { id: "ADAUSDT", label: "ADA/USDT", base: "ADA", quote: "USDT", kind: "crypto", name: "Cardano" },
  { id: "DOGEUSDT", label: "DOGE/USDT", base: "DOGE", quote: "USDT", kind: "crypto", name: "Dogecoin" },
  { id: "AVAXUSDT", label: "AVAX/USDT", base: "AVAX", quote: "USDT", kind: "crypto", name: "Avalanche" },
];

export function findSymbol(id: string): BinanceSymbol {
  return SYMBOLS.find((s) => s.id === id) ?? SYMBOLS[0];
}

// ---- Market status (open / closed) -----------------------------------------

export interface MarketStatus {
  open: boolean;
  label: string;
  nextChange: string;
}

/**
 * Crypto markets on Binance trade 24/7, so they are always OPEN. The signature
 * accepts a `kind` field so future stock integrations can plug in NYSE
 * session checks without changing call sites.
 */
export function getMarketStatus(symbol: { kind: string }): MarketStatus {
  if (symbol.kind === "crypto") {
    return { open: true, label: "24/7", nextChange: "Always open" };
  }
  // Stock market hours (future). NYSE: 09:30-16:00 ET, Mon-Fri.
  return { open: false, label: "NYSE", nextChange: "Market closed" };
}

// ---- Timeframe mapping ------------------------------------------------------

const INTERVAL_MAP: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
  "1W": "1w",
};

export function mapInterval(timeframe: string): string {
  return INTERVAL_MAP[timeframe] ?? "1m";
}

// ---- Tiny TTL cache ---------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 3000;

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function cacheSet<T>(key: string, value: T, ttl = DEFAULT_TTL_MS): void {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

// ---- Fetch helpers ----------------------------------------------------------

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Binance API ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ---- Public API -------------------------------------------------------------

type RawKline = [
  number, // open time
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // close time
  string, // quote asset volume
  number, // number of trades
  string, // taker buy base asset volume
  string, // taker buy quote asset volume
  string, // unused
];

export async function fetchCandles(
  symbol: string,
  timeframe: string,
  limit = 150,
): Promise<Candle[]> {
  const interval = mapInterval(timeframe);
  const key = `klines:${symbol}:${interval}:${limit}`;
  const cached = cacheGet<Candle[]>(key);
  if (cached) return cached;

  const raw = await getJSON<RawKline[]>(
    `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
  const candles: Candle[] = raw.map((k) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
  // Klines are short-lived — refresh every 5s so the latest candle updates.
  cacheSet(key, candles, 5000);
  return candles;
}

interface RawTicker24h {
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string; // base asset
  quoteVolume: string; // quote asset (USDT)
  priceChange: string;
  priceChangePercent: string;
  symbol: string;
}

function parseTicker(raw: RawTicker24h): TickerStats {
  const lastPrice = parseFloat(raw.lastPrice);
  const open24h = parseFloat(raw.openPrice);
  const changeAbs = parseFloat(raw.priceChange);
  const changePercent = parseFloat(raw.priceChangePercent);
  return {
    lastPrice,
    open24h,
    changeAbs,
    changePercent,
    high24h: parseFloat(raw.highPrice),
    low24h: parseFloat(raw.lowPrice),
    volume24h: parseFloat(raw.quoteVolume),
    volumeBase24h: parseFloat(raw.volume),
  };
}

export async function fetchTicker(symbol: string): Promise<TickerStats> {
  const key = `ticker:${symbol}`;
  const cached = cacheGet<TickerStats>(key);
  if (cached) return cached;

  const raw = await getJSON<RawTicker24h>(
    `/api/v3/ticker/24hr?symbol=${symbol}`,
  );
  const stats = parseTicker(raw);
  cacheSet(key, stats, 3000);
  return stats;
}

interface RawDepth {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export async function fetchOrderBook(
  symbol: string,
  limit = 20,
): Promise<OrderBook> {
  const key = `depth:${symbol}:${limit}`;
  const cached = cacheGet<OrderBook>(key);
  if (cached) return cached;

  const raw = await getJSON<RawDepth>(
    `/api/v3/depth?symbol=${symbol}&limit=${limit}`,
  );

  // Asks come in ascending price order; we keep them that way.
  const asks: OrderBookRow[] = [];
  let askTotal = 0;
  for (const [p, a] of raw.asks) {
    const price = parseFloat(p);
    const amount = parseFloat(a);
    if (!Number.isFinite(price) || !Number.isFinite(amount)) continue;
    askTotal += amount;
    asks.push({ price, amount, total: askTotal });
  }

  // Bids come in descending price order; we keep them that way.
  const bids: OrderBookRow[] = [];
  let bidTotal = 0;
  for (const [p, a] of raw.bids) {
    const price = parseFloat(p);
    const amount = parseFloat(a);
    if (!Number.isFinite(price) || !Number.isFinite(amount)) continue;
    bidTotal += amount;
    bids.push({ price, amount, total: bidTotal });
  }

  const bestAsk = asks.length ? asks[0].price : 0;
  const bestBid = bids.length ? bids[0].price : 0;
  const spread = bestAsk - bestBid;
  const midPrice = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

  const book: OrderBook = {
    asks,
    bids,
    spread,
    spreadPercent,
    midPrice,
  };
  cacheSet(key, book, 2000);
  return book;
}

interface RawTrade {
  id: number;
  price: string;
  qty: string;
  time: number;
  isBuyerMaker: boolean;
}

export async function fetchRecentTrades(
  symbol: string,
  limit = 30,
): Promise<Trade[]> {
  const key = `trades:${symbol}:${limit}`;
  const cached = cacheGet<Trade[]>(key);
  if (cached) return cached;

  const raw = await getJSON<RawTrade[]>(
    `/api/v3/trades?symbol=${symbol}&limit=${limit}`,
  );
  const trades: Trade[] = raw.map((t) => ({
    id: String(t.id),
    price: parseFloat(t.price),
    amount: parseFloat(t.qty),
    time: t.time,
    side: t.isBuyerMaker ? "sell" : "buy",
  }));
  cacheSet(key, trades, 2000);
  return trades;
}

export async function fetchAllTickers(): Promise<Map<string, TickerStats>> {
  const key = `ticker:all`;
  const cached = cacheGet<Map<string, TickerStats>>(key);
  if (cached) return cached;

  const raw = await getJSON<RawTicker24h[]>(`/api/v3/ticker/24hr`);
  const map = new Map<string, TickerStats>();
  for (const r of raw) {
    // Only keep the symbols we care about to avoid storing thousands of rows.
    if (SYMBOLS.some((s) => s.id === r.symbol)) {
      map.set(r.symbol, parseTicker(r));
    }
  }
  cacheSet(key, map, 5000);
  return map;
}
