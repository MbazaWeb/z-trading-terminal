import { NextRequest, NextResponse } from "next/server";

const COINBASE_API = "https://api.exchange.coinbase.com";
const PRODUCTS = [
  { id: "BTC-USD", name: "Bitcoin", base: "BTC", quote: "USD" },
  { id: "ETH-USD", name: "Ethereum", base: "ETH", quote: "USD" },
  { id: "SOL-USD", name: "Solana", base: "SOL", quote: "USD" },
  { id: "XRP-USD", name: "XRP", base: "XRP", quote: "USD" },
] as const;
const GRANULARITY: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 21600,
  "1D": 86400,
  "1W": 86400,
};

type CoinbaseTicker = { bid: string; ask: string; price: string; time: string };
type CoinbaseStats = {
  open: string;
  high: string;
  low: string;
  last: string;
  volume: string;
};
type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
};

async function fetchCoinbase<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, COINBASE_API), {
    headers: { Accept: "application/json" },
    next: { revalidate: 5 },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`Coinbase request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function parseNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error("Coinbase returned invalid numeric data");
  return number;
}

function parseCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) throw new Error("Coinbase returned invalid candles");
  return rows.flatMap((row): Candle[] => {
    if (!Array.isArray(row) || row.length < 6) return [];
    const [seconds, low, high, open, close, tickVolume] = row;
    const values = [seconds, low, high, open, close, tickVolume].map(parseNumber);
    if (values[0] <= 0 || values.slice(1).some((value) => value < 0)) return [];
    return [{
      time: values[0] * 1000,
      low: values[1],
      high: values[2],
      open: values[3],
      close: values[4],
      tickVolume: values[5],
    }];
  }).sort((a, b) => a.time - b.time);
}

function toWeeklyCandles(candles: Candle[]): Candle[] {
  const weeks = new Map<number, Candle>();
  for (const candle of candles) {
    const date = new Date(candle.time);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    const weekStart = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - daysSinceMonday,
    );
    const current = weeks.get(weekStart);
    if (current) {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.tickVolume += candle.tickVolume;
    } else {
      weeks.set(weekStart, { ...candle, time: weekStart });
    }
  }
  return [...weeks.values()];
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || PRODUCTS[0].id;
  const timeframe = request.nextUrl.searchParams.get("timeframe") || "15m";
  const product = PRODUCTS.find((item) => item.id === symbol);
  if (!product || !(timeframe in GRANULARITY)) {
    return NextResponse.json({ error: "Invalid market request" }, { status: 400 });
  }

  try {
    const [ticker, stats, candles, productStats] = await Promise.all([
      fetchCoinbase<CoinbaseTicker>(`/products/${product.id}/ticker`),
      fetchCoinbase<CoinbaseStats>(`/products/${product.id}/stats`),
      fetchCoinbase<unknown>(
        `/products/${product.id}/candles?granularity=${GRANULARITY[timeframe]}`,
      ),
      Promise.all(PRODUCTS.map(async (item) => ({
        product: item,
        stats: await fetchCoinbase<CoinbaseStats>(`/products/${item.id}/stats`),
      }))),
    ]);

    const bid = parseNumber(ticker.bid);
    const ask = parseNumber(ticker.ask);
    const lastPrice = parseNumber(ticker.price);
    const open24h = parseNumber(stats.open);
    const high24h = parseNumber(stats.high);
    const low24h = parseNumber(stats.low);
    const volumeBase24h = parseNumber(stats.volume);
    const quoteTime = Date.parse(ticker.time);
    if (bid <= 0 || ask < bid || lastPrice <= 0 || open24h <= 0 ||
        high24h <= 0 || low24h <= 0 || quoteTime <= 0) {
      throw new Error("Coinbase returned an invalid quote");
    }

    let parsedCandles = parseCandles(candles);
    if (timeframe === "1W") parsedCandles = toWeeklyCandles(parsedCandles);
    parsedCandles = parsedCandles.slice(-150);
    if (!parsedCandles.length) throw new Error("Coinbase returned no candles");

    const symbols = productStats.map(({ product: item, stats: itemStats }) => {
      const last = parseNumber(itemStats.last);
      const open = parseNumber(itemStats.open);
      return {
        ...item,
        digits: last >= 1 ? 2 : 6,
        lastPrice: last,
        changePercent: open > 0 ? ((last - open) / open) * 100 : 0,
      };
    });

    return NextResponse.json({
      source: "COINBASE",
      symbols,
      symbol: product.id,
      timeframe,
      quote: { bid, ask, time: quoteTime },
      stats: {
        lastPrice,
        open24h,
        changeAbs: lastPrice - open24h,
        changePercent: ((lastPrice - open24h) / open24h) * 100,
        high24h,
        low24h,
        volume24h: volumeBase24h * lastPrice,
        volumeBase24h,
      },
      candles: parsedCandles,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Public crypto market feed request failed", error);
    return NextResponse.json({ error: "Public crypto market feed unavailable" }, { status: 503 });
  }
}
