import "server-only";

export interface BridgeAccount {
  login: string;
  server: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  tradeAllowed: boolean;
  accountType: "demo";
}

export interface BridgePosition {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  volume: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
}

export async function bridgeRequest<T>(
  path: "/account" | "/positions" | "/health" | "/market" | "/risk-specs",
  symbol?: string
): Promise<T> {
  const base = process.env.MT5_BRIDGE_URL?.trim();
  const key = process.env.MT5_BRIDGE_KEY?.trim();

  if (!base || !key || key.length < 32) {
    throw new Error("MT5 bridge not configured");
  }

  const url = new URL(base);

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname))
  ) {
    throw new Error("Insecure MT5 bridge URL");
  }

  const target = new URL(path, url);
  if (path === "/market" || path === "/risk-specs") {
    if (!symbol || !/^[A-Za-z0-9._-]{1,32}$/.test(symbol)) throw new Error("Invalid symbol");
    target.searchParams.set("symbol", symbol);
  }
  const response = await fetch(target, {
    method: "GET",
    headers: {
      "X-Bridge-Key": key,
      "Accept": "application/json"
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`MT5 bridge unavailable (${response.status})`);
  }

  return await response.json() as T;
}

export async function getBridgeAccount(): Promise<BridgeAccount> {
  const account = await bridgeRequest<BridgeAccount>("/account");

  if (
    account.accountType !== "demo" ||
    account.login !== process.env.MT5_LOGIN?.trim() ||
    account.server !== process.env.MT5_SERVER?.trim()
  ) {
    throw new Error("MT5 account verification failed");
  }

  if (
    ![account.balance, account.equity, account.margin,
      account.freeMargin, account.leverage].every(Number.isFinite)
  ) {
    throw new Error("Invalid broker account data");
  }

  return account;
}

export async function getBridgeMarket(symbol: string) {
  const { z } = await import("zod");
  const price = z.number().finite().positive();
  const schema = z.object({ symbol: z.string(), bid: price, ask: price,
    observedAt: z.number().int().positive(), provider: z.literal("mt5"),
    accountType: z.literal("demo"), volumeType: z.literal("tick_count"),
    candles: z.array(z.object({ time: z.number().int().positive(), open: price,
      high: price, low: price, close: price, volume: z.number().finite().nonnegative() })).min(50).max(150) });
  const data = schema.parse(await bridgeRequest<unknown>("/market", symbol));
  const now = Date.now();
  if (data.symbol !== symbol || data.ask < data.bid || data.observedAt > now ||
      now - data.observedAt > 60000 || data.candles.some((c,i) =>
      c.low > Math.min(c.open,c.close) || c.high < Math.max(c.open,c.close) ||
      c.time + 60000 > now || (i > 0 && c.time <= data.candles[i-1].time))) throw new Error("Invalid market snapshot");
  const last = data.candles[data.candles.length-1];
  if (now - last.time - 60000 > 120000) throw new Error("Stale candle history");
  return { ...data, spread: data.ask - data.bid };
}

export async function getBridgeRiskSpecs(symbol: string) {
  const { z } = await import("zod");
  const positive = z.number().finite().positive();
  const data = z.object({symbol:z.literal(symbol),currency:z.string().min(1),
    login:z.string(),server:z.string(),accountType:z.literal("demo"),
    tickSize:positive,lossTickValue:positive,minVolume:positive,maxVolume:positive,
    volumeStep:positive,point:positive,contractSize:positive,
    minStopDistance:z.number().finite().nonnegative(),observedAt:z.number().int().positive()
  }).parse(await bridgeRequest<unknown>("/risk-specs",symbol));
  const now=Date.now();
  if(data.login!==process.env.MT5_LOGIN?.trim() || data.server!==process.env.MT5_SERVER?.trim() ||
     data.maxVolume<data.minVolume || data.observedAt>now || now-data.observedAt>10000)
    throw new Error("Invalid or stale broker risk specifications");
  return data;
}
