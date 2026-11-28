// Server-side helper for instantiating the MetaApi.cloud SDK in Next.js API
// routes.
//
// The `metaapi.cloud-sdk` package ships two builds: a browser-targeted ESM
// bundle and a Node-targeted CommonJS bundle. The package's `exports` map
// points the default `import` condition at the ESM bundle, which expects a
// browser global environment and crashes on `fs.realpath.native` at module
// load time. Importing from the explicit `/node` subpath forces Node to use
// the CommonJS bundle, which is the only one that works in Vercel's
// serverless runtime.
//
// All four MT5 routes (`balance`, `positions`, `trade`, `connect`) share this
// factory so we centralize the token check + instantiation in one place.

import MetaApi from "metaapi.cloud-sdk/node";

// Minimal surface of the MetaApi SDK that we actually use. The SDK ships
// full TypeScript definitions alongside its source (in `metaApi/`), but
// because the package's `exports` map doesn't expose types for the
// `/node` subpath we declare the small subset we call here. This keeps
// the route handlers type-checked without resorting to `any` everywhere.
interface MetaApiAccount {
  deploy(): Promise<void>;
  waitDeployed(timeoutInSeconds?: number): Promise<void>;
  waitConnected(timeoutInSeconds?: number): Promise<void>;
  getRPCConnection(): RpcConnection;
}

interface MetaApiAccountApi {
  getAccount(accountId: string): Promise<MetaApiAccount>;
  createAccount(account: {
    name: string;
    login?: string;
    password?: string;
    server: string;
    platform?: "mt4" | "mt5";
    type?: "cloud" | "cloud-g2";
    magic?: number;
    reliability?: "regular" | "high";
    manualTrades?: boolean;
    baseCurrency?: string;
    metastatsApiEnabled?: boolean;
  }): Promise<{ id: string; state?: string }>;
}

interface MetaApiInstance {
  metatraderAccountApi: MetaApiAccountApi;
  close(): void;
}

// `typeof MetaApi` resolves to the SDK's actual class type, which we then
// cast to our minimal interface above. The runtime object is the same.
const MetaApiCtor = MetaApi as unknown as new (token: string) => MetaApiInstance;

// ---- Minimal types for the MetaApi responses we consume --------------------
// We inline these instead of importing the SDK's full schema types (which
// would require resolving the package's types map through the `/node`
// subpath, currently unsupported). The shapes below mirror the official
// MetaApi MetaTraderAccountInformation + MetatraderPosition + trade response
// types: https://metaapi.cloud/docs/client/

export interface MetaApiAccountInfo {
  platform?: string;
  broker?: string;
  currency: string;
  server?: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin?: number;
  leverage: number;
  marginLevel?: number;
  tradeAllowed?: boolean;
  name?: string;
  login?: number;
}

export interface MetaApiPosition {
  id: number;
  type: string; // POSITION_TYPE_BUY / POSITION_TYPE_SELL
  symbol: string;
  time: Date | string;
  openPrice: number;
  currentPrice: number;
  unrealizedProfit?: number;
  profit: number;
  volume: number;
  swap?: number;
  stopLoss?: number;
  takeProfit?: number;
  comment?: string;
}

export interface MetaApiTradeResponse {
  orderId?: number;
  positionId?: number;
  // The SDK's full response includes a numericCode / description / lots of
  // other fields; we only surface what the UI shows.
}

export interface MetaApiConfig {
  token: string;
  accountId: string;
  server?: string;
  login?: string;
}

/**
 * Reads the MetaApi env vars and returns the config, or null if MetaApi is
 * not configured. Callers should respond with HTTP 503 when this returns
 * null so the client UI can fall back to the locally cached balance.
 */
export function readMetaApiConfig(): MetaApiConfig | null {
  const token = process.env.METAAPI_TOKEN?.trim();
  const accountId = process.env.MT5_ACCOUNT_ID?.trim();
  if (!token || !accountId) return null;
  return {
    token,
    accountId,
    server: process.env.MT5_SERVER?.trim() || undefined,
    login: process.env.MT5_LOGIN?.trim() || undefined,
  };
}

// We keep the connection type loose (it's a MetaApi RPC connection instance)
// to avoid having to thread the full generic parameter chain through this
// helper. The route handlers only call a handful of typed methods that the
// SDK types correctly on its own.
export type RpcConnection = {
  connect(): Promise<void>;
  getAccountInformation(): Promise<MetaApiAccountInfo>;
  getPositions(): Promise<MetaApiPosition[]>;
  createMarketBuyOrder(
    symbol: string,
    volume: number,
    stopLoss?: number,
    takeProfit?: number,
  ): Promise<MetaApiTradeResponse>;
  createMarketSellOrder(
    symbol: string,
    volume: number,
    stopLoss?: number,
    takeProfit?: number,
  ): Promise<MetaApiTradeResponse>;
  closePosition(positionId: string): Promise<void>;
  close(): Promise<void>;
};

/**
 * Returns a connected RPC connection to the configured MetaApi account.
 *
 * The caller is responsible for invoking `connection.close()` (or, more
 * practically, letting the serverless function terminate — MetaApi's
 * websocket is closed automatically when the process exits).
 */
export async function getConnectedRpcConnection(): Promise<{
  api: MetaApiInstance;
  connection: RpcConnection;
}> {
  const config = readMetaApiConfig();
  if (!config) {
    throw new Error("MetaApi not configured. Set METAAPI_TOKEN and MT5_ACCOUNT_ID.");
  }
  const api = new MetaApiCtor(config.token);
  const account = await api.metatraderAccountApi.getAccount(config.accountId);
  // Best-effort: ensure the account is deployed before connecting. If the
  // account is already DEPLOYED this is a no-op.
  try {
    await account.deploy();
  } catch {
    /* ignore — already deployed or deploying */
  }
  // Wait for the broker connection to be ready (max ~30s). If this fails we
  // surface the error so the route handler can return 500 to the client.
  try {
    await account.waitConnected(30);
  } catch {
    /* ignore — connect() below will surface any real errors */
  }
  const connection = account.getRPCConnection();
  await connection.connect();
  return { api, connection };
}

/**
 * Provisions a new MetaApi account tied to the user's MT5 login/password/
 * server. Returns the MetaApi account id which the caller should persist
 * (we recommend setting it as the `MT5_ACCOUNT_ID` env var on Vercel).
 *
 * This is a one-time setup step — once provisioned, the same account id
 * works for all subsequent /api/mt5/balance, /positions, /trade calls.
 */
export async function provisionMetaApiAccount(input: {
  login: string;
  password: string;
  server: string;
  platform?: "mt4" | "mt5";
  name?: string;
}): Promise<{ id: string; state?: string }> {
  const token = process.env.METAAPI_TOKEN?.trim();
  if (!token) {
    throw new Error("MetaApi not configured. Set METAAPI_TOKEN to provision an account.");
  }
  const api = new MetaApiCtor(token);
  try {
    const account = await api.metatraderAccountApi.createAccount({
      name: input.name || `MT5 ${input.login}`,
      login: input.login,
      password: input.password,
      server: input.server,
      platform: input.platform ?? "mt5",
      type: "cloud-g2",
      magic: 0,
      reliability: "high",
      manualTrades: false,
      baseCurrency: "USD",
      metastatsApiEnabled: false,
    });
    return account;
  } finally {
    try {
      api.close();
    } catch {
      /* ignore */
    }
  }
}
