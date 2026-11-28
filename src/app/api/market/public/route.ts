import { NextRequest, NextResponse } from "next/server";
import type { AssetKind, Timeframe } from "@/components/trading/types";

const COINBASE_API = "https://api.exchange.coinbase.com";
const DERIV_WS = "wss://api.derivws.com/trading/v1/options/ws/public";
type MarketProduct = {
  id: string;
  label: string;
  name: string;
  base: string;
  quote: string;
  digits: number;
  kind: AssetKind;
  source: "COINBASE" | "DERIV";
};
const COINBASE_PRODUCTS: MarketProduct[] = [
  { id: "BTC-USD", label: "BTC/USD", name: "Bitcoin", base: "BTC", quote: "USD", digits: 2, kind: "crypto", source: "COINBASE" },
  { id: "ETH-USD", label: "ETH/USD", name: "Ethereum", base: "ETH", quote: "USD", digits: 2, kind: "crypto", source: "COINBASE" },
  { id: "SOL-USD", label: "SOL/USD", name: "Solana", base: "SOL", quote: "USD", digits: 2, kind: "crypto", source: "COINBASE" },
  { id: "XRP-USD", label: "XRP/USD", name: "XRP", base: "XRP", quote: "USD", digits: 6, kind: "crypto", source: "COINBASE" },
];
const DERIV_PRODUCTS: MarketProduct[] = [
  { id: "R_10", label: "Volatility 10", name: "Volatility 10 Index", base: "", quote: "", digits: 3, kind: "volatility", source: "DERIV" },
  { id: "R_25", label: "Volatility 25", name: "Volatility 25 Index", base: "", quote: "", digits: 3, kind: "volatility", source: "DERIV" },
  { id: "R_50", label: "Volatility 50", name: "Volatility 50 Index", base: "", quote: "", digits: 4, kind: "volatility", source: "DERIV" },
  { id: "R_75", label: "Volatility 75", name: "Volatility 75 Index", base: "", quote: "", digits: 4, kind: "volatility", source: "DERIV" },
  { id: "R_100", label: "Volatility 100", name: "Volatility 100 Index", base: "", quote: "", digits: 2, kind: "volatility", source: "DERIV" },
  { id: "1HZ10V", label: "Volatility 10 (1s)", name: "Volatility 10 (1s) Index", base: "", quote: "", digits: 2, kind: "volatility", source: "DERIV" },
  { id: "1HZ15V", label: "Volatility 15 (1s)", name: "Volatility 15 (1s) Index", base: "", quote: "", digits: 3, kind: "volatility", source: "DERIV" },
  { id: "1HZ25V", label: "Volatility 25 (1s)", name: "Volatility 25 (1s) Index", base: "", quote: "", digits: 2, kind: "volatility", source: "DERIV" },
  { id: "1HZ30V", label: "Volatility 30 (1s)", name: "Volatility 30 (1s) Index", base: "", quote: "", digits: 3, kind: "volatility", source: "DERIV" },
  { id: "1HZ50V", label: "Volatility 50 (1s)", name: "Volatility 50 (1s) Index", base: "", quote: "", digits: 2, kind: "volatility", source: "DERIV" },
  { id: "1HZ75V", label: "Volatility 75 (1s)", name: "Volatility 75 (1s) Index", base: "", quote: "", digits: 2, kind: "volatility", source: "DERIV" },
  { id: "1HZ90V", label: "Volatility 90 (1s)", name: "Volatility 90 (1s) Index", base: "", quote: "", digits: 3, kind: "volatility", source: "DERIV" },
  { id: "1HZ100V", label: "Volatility 100 (1s)", name: "Volatility 100 (1s) Index", base: "", quote: "", digits: 2, kind: "volatility", source: "DERIV" },
  { id: "frxXAUUSD", label: "GOLD/USD", name: "Gold vs US Dollar", base: "XAU", quote: "USD", digits: 2, kind: "commodity", source: "DERIV" },
  { id: "frxEURUSD", label: "EUR/USD", name: "Euro vs US Dollar", base: "EUR", quote: "USD", digits: 5, kind: "forex", source: "DERIV" },
  { id: "frxGBPUSD", label: "GBP/USD", name: "British Pound vs US Dollar", base: "GBP", quote: "USD", digits: 5, kind: "forex", source: "DERIV" },
  { id: "frxUSDJPY", label: "USD/JPY", name: "US Dollar vs Japanese Yen", base: "USD", quote: "JPY", digits: 3, kind: "forex", source: "DERIV" },
  { id: "frxUSDCHF", label: "USD/CHF", name: "US Dollar vs Swiss Franc", base: "USD", quote: "CHF", digits: 5, kind: "forex", source: "DERIV" },
  { id: "frxUSDCAD", label: "USD/CAD", name: "US Dollar vs Canadian Dollar", base: "USD", quote: "CAD", digits: 5, kind: "forex", source: "DERIV" },
  { id: "frxAUDUSD", label: "AUD/USD", name: "Australian Dollar vs US Dollar", base: "AUD", quote: "USD", digits: 5, kind: "forex", source: "DERIV" },
  { id: "frxNZDUSD", label: "NZD/USD", name: "New Zealand Dollar vs US Dollar", base: "NZD", quote: "USD", digits: 5, kind: "forex", source: "DERIV" },
];
const PRODUCTS = [...COINBASE_PRODUCTS, ...DERIV_PRODUCTS];
const GRANULARITY: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 21600,
  "1D": 86400,
  "1W": 86400,
};
const DERIV_GRANULARITY: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 14400,
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
type DerivCandle = { epoch: number; open: string; high: string; low: string; close: string };
type DerivMessage = {
  req_id?: number;
  echo_req?: { req_id?: number };
  error?: { message?: string };
  tick?: { quote: number; epoch: number };
  candles?: DerivCandle[];
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
  if (!Number.isFinite(number)) throw new Error("Market provider returned invalid numeric data");
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

function parseDerivCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): Candle[] => {
    if (!row || typeof row !== "object") return [];
    const candle = row as DerivCandle;
    const values = [candle.epoch, candle.open, candle.high, candle.low, candle.close].map(parseNumber);
    if (values[0] <= 0 || values.slice(1).some((value) => value < 0)) return [];
    return [{
      time: values[0] * 1000,
      open: values[1],
      high: values[2],
      low: values[3],
      close: values[4],
      tickVolume: 0,
    }];
  }).sort((a, b) => a.time - b.time);
}

async function fetchCoinbaseSymbols() {
  const cryptoSymbols = await Promise.all(COINBASE_PRODUCTS.map(async (product) => {
    const stats = await fetchCoinbase<CoinbaseStats>(`/products/${product.id}/stats`);
    const lastPrice = parseNumber(stats.last);
    const open = parseNumber(stats.open);
    return {
      ...product,
      lastPrice,
      changePercent: open > 0 ? ((lastPrice - open) / open) * 100 : null,
    };
  }));
  return [
    ...cryptoSymbols,
    ...DERIV_PRODUCTS.map((product) => ({ ...product, lastPrice: null, changePercent: null })),
  ];
}

async function fetchSymbolsForDeriv() {
  try {
    return await fetchCoinbaseSymbols();
  } catch (error) {
    console.error("Coinbase symbols unavailable alongside Deriv market data", error);
    return [
      ...COINBASE_PRODUCTS.map((product) => ({ ...product, lastPrice: null, changePercent: null })),
      ...DERIV_PRODUCTS.map((product) => ({ ...product, lastPrice: null, changePercent: null })),
    ];
  }
}

function fetchDerivMarket(product: MarketProduct, timeframe: Timeframe): Promise<{
  quote: { price: number; time: number };
  candles: Candle[];
  hourlyCandles: Candle[];
}> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(DERIV_WS);
    let settled = false;
    let tickDone = false;
    let chartDone = false;
    let hourlyDone = false;
    let tick: { price: number; time: number } | null = null;
    let chartCandles: Candle[] = [];
    let hourlyCandles: Candle[] = [];
    const timeout = setTimeout(() => fail(new Error("Deriv market feed timed out")), 10000);

    function finish() {
      if (settled || !tickDone || !chartDone || !hourlyDone) return;
      if (!chartCandles.length) {
        fail(new Error("Deriv returned no chart history"));
        return;
      }
      const lastCandle = chartCandles[chartCandles.length - 1];
      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve({
        quote: tick ?? { price: lastCandle.close, time: lastCandle.time },
        candles: chartCandles,
        hourlyCandles,
      });
    }

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      reject(error);
    }

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ ticks: product.id, req_id: 1 }));
      socket.send(JSON.stringify({
        ticks_history: product.id,
        count: timeframe === "1W" ? 350 : 150,
        end: "latest",
        style: "candles",
        granularity: DERIV_GRANULARITY[timeframe],
        req_id: 2,
      }));
      socket.send(JSON.stringify({
        ticks_history: product.id,
        count: 30,
        end: "latest",
        style: "candles",
        granularity: 3600,
        req_id: 3,
      }));
    });

    socket.addEventListener("message", (event) => {
      if (settled) return;
      let data: DerivMessage;
      try {
        data = JSON.parse(String(event.data)) as DerivMessage;
      } catch {
        fail(new Error("Deriv returned an invalid response"));
        return;
      }
      const requestId = data.req_id ?? data.echo_req?.req_id;
      if (requestId === 1) {
        tickDone = true;
        if (data.tick) {
          try {
            const price = parseNumber(data.tick.quote);
            const epoch = parseNumber(data.tick.epoch);
            if (price > 0 && epoch > 0) tick = { price, time: epoch * 1000 };
          } catch (error) {
            console.error("Deriv returned invalid tick data", error);
            tick = null;
          }
        }
      } else if (requestId === 2) {
        if (data.error) {
          fail(new Error(data.error.message ?? "Deriv chart history unavailable"));
          return;
        }
        try {
          chartCandles = parseDerivCandles(data.candles);
        } catch {
          fail(new Error("Deriv returned invalid chart history"));
          return;
        }
        chartDone = true;
      } else if (requestId === 3) {
        try {
          hourlyCandles = parseDerivCandles(data.candles);
        } catch (error) {
          console.error("Deriv hourly stats unavailable", error);
          hourlyCandles = [];
        }
        hourlyDone = true;
      }
      finish();
    });

    socket.addEventListener("error", () => fail(new Error("Unable to connect to Deriv market data")));
    socket.addEventListener("close", () => {
      if (!settled) fail(new Error("Deriv market data connection closed unexpectedly"));
    });
  });
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || PRODUCTS[0].id;
  const timeframe = request.nextUrl.searchParams.get("timeframe") || "15m";
  const product = PRODUCTS.find((item) => item.id === symbol);
  if (!product || !Object.prototype.hasOwnProperty.call(GRANULARITY, timeframe)) {
    return NextResponse.json({ error: "Invalid market request" }, { status: 400 });
  }

  try {
    if (product.source === "DERIV") {
      const tf = timeframe as Timeframe;
      const [{ quote, candles: rawCandles, hourlyCandles }, symbols] = await Promise.all([
        fetchDerivMarket(product, tf),
        fetchSymbolsForDeriv(),
      ]);
      let candles = rawCandles;
      if (tf === "1W") candles = toWeeklyCandles(candles);
      candles = candles.slice(-150);
      if (!candles.length) throw new Error("Deriv returned no chart candles");

      const recentHourlyCandles = hourlyCandles.filter(
        (candle) => candle.time >= Date.now() - 24 * 60 * 60 * 1000 && candle.time <= Date.now(),
      );
      const firstRecentCandle = recentHourlyCandles[0];
      const lastPrice = quote.price;
      const open24h = firstRecentCandle?.open ?? NaN;
      const high24h = recentHourlyCandles.length
        ? Math.max(...recentHourlyCandles.map((candle) => candle.high))
        : NaN;
      const low24h = recentHourlyCandles.length
        ? Math.min(...recentHourlyCandles.map((candle) => candle.low))
        : NaN;
      const changeAbs = Number.isFinite(open24h) ? lastPrice - open24h : NaN;
      const changePercent = Number.isFinite(open24h) && open24h > 0
        ? (changeAbs / open24h) * 100
        : null;
      const marketSymbols = symbols.map((item) => item.id === product.id
        ? { ...item, lastPrice, changePercent }
        : item);

      return NextResponse.json({
        source: "DERIV",
        symbols: marketSymbols,
        symbol: product.id,
        timeframe,
        quote: { bid: lastPrice, ask: lastPrice, time: quote.time, hasBidAsk: false },
        stats: {
          lastPrice,
          open24h,
          changeAbs,
          changePercent: changePercent ?? NaN,
          high24h,
          low24h,
          volume24h: NaN,
          volumeBase24h: NaN,
        },
        candles,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const [ticker, stats, candles, productStats] = await Promise.all([
      fetchCoinbase<CoinbaseTicker>(`/products/${product.id}/ticker`),
      fetchCoinbase<CoinbaseStats>(`/products/${product.id}/stats`),
      fetchCoinbase<unknown>(
        `/products/${product.id}/candles?granularity=${GRANULARITY[timeframe]}`,
      ),
      fetchCoinbaseSymbols(),
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

    return NextResponse.json({
      source: "COINBASE",
      symbols: productStats,
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
    console.error("Public market feed request failed", error);
    return NextResponse.json({ error: "Public market feed unavailable" }, { status: 503 });
  }
}
