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
  path: "/account" | "/positions" | "/health"
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

  const response = await fetch(new URL(path, url), {
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
