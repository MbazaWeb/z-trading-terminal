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
  path: "/verified-account" | "/account" | "/positions" | "/health" | "/market" | "/risk-specs" | "/account-risk" | "/order-check" | "/submit-demo",
  symbol?: string,
  order?: {symbol:string;side:"buy"|"sell";volume:number;stopLoss:number;takeProfit:number;requestId?:string}
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
    method: (path === "/order-check" || path === "/submit-demo") ? "POST" : "GET",
    body: (path === "/order-check" || path === "/submit-demo") ? JSON.stringify(order) : undefined,
    headers: {
      "X-Bridge-Key": key,
      "Accept": "application/json",
      "Content-Type": "application/json"
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

export async function getBridgeAccountRisk() {
 const {z}=await import("zod");
 const finite=z.number().finite();
 const r=z.object({login:z.string(),server:z.string(),currency:z.string().min(1),
 accountType:z.literal("demo"),equity:finite.positive(),freeMargin:finite.positive(),
 dailyRealizedPnl:finite,openRisk:finite.nonnegative(),openPositions:z.number().int().nonnegative(),
 pendingOrders:z.literal(0),dayStart:z.string(),observedAt:z.number().int(),executable:z.literal(false)
 }).parse(await bridgeRequest<unknown>("/account-risk"));
 const now=Date.now(), day=new Date(now); day.setUTCHours(0,0,0,0);
 if(r.login!==process.env.MT5_LOGIN?.trim()||r.server!==process.env.MT5_SERVER?.trim()||
 Date.parse(r.dayStart)!==day.getTime()||r.observedAt>now||now-r.observedAt>10000)
 throw new Error("Invalid account risk snapshot");
 return r;
}

export async function checkBridgeOrder(order: {symbol:string;side:"buy"|"sell";volume:number;stopLoss:number;takeProfit:number}) {
 const {z}=await import("zod"); const p=z.number().finite().positive();
 const r=z.object({symbol:z.literal(order.symbol),side:z.literal(order.side),volume:z.literal(order.volume),
 entry:p,margin:p,estimatedStopLoss:p,currency:z.string().min(1),observedAt:z.number().int(),
 accountType:z.literal("demo"),executable:z.literal(false),brokerCheckPassed:z.literal(true)
 }).parse(await bridgeRequest<unknown>("/order-check",undefined,order));
 const now=Date.now();if(r.observedAt>now||now-r.observedAt>10000)throw new Error("Expired broker check");
 return r;
}


export async function getVerifiedBridgeAccount() {
  const { z } = await import("zod");
  const finite = z.number().finite();
  const account = z.object({
    login: z.string().min(1), server: z.string().min(1),
    accountType: z.enum(["demo", "real"]), currency: z.string().min(1),
    balance: finite, equity: finite, freeMargin: finite,
    tradeAllowed: z.boolean(), executable: z.literal(false)
  }).parse(await bridgeRequest<unknown>("/verified-account"));
  if (account.login !== process.env.MT5_LOGIN?.trim() ||
      account.server !== process.env.MT5_SERVER?.trim()) {
    throw new Error("MT5 broker identity mismatch");
  }
  return account;
}


// Internal transport only; the bridge route must independently authorize submission.
export async function submitBridgeDemoOrder(order: {requestId:string;symbol:string;side:"buy"|"sell";volume:number;stopLoss:number;takeProfit:number}) {
  const {z}=await import("zod");
  if(process.env.MT5_DEMO_EXECUTION!=="true" || process.env.REAL_TRADING_ENABLED!=="false")
    throw new Error("Demo execution disabled");
  z.uuid().parse(order.requestId);
  const account=await getBridgeAccount();
  if(!account.tradeAllowed) throw new Error("Broker trading unavailable");
  return z.discriminatedUnion("status",[
    z.object({status:z.literal("confirmed"),brokerOrderId:z.string().regex(/^[1-9][0-9]*$/)}),
    z.object({status:z.literal("unknown")})
  ]).parse(await bridgeRequest<unknown>("/submit-demo",undefined,order));
}
