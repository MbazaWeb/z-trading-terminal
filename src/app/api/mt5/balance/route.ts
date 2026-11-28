import { NextResponse } from "next/server";
import {
  getConnectedRpcConnection,
  readMetaApiConfig,
} from "@/lib/metaApiServer";

/**
 * GET /api/mt5/balance
 *
 * Fetches the real-time account balance, equity, margin, and leverage from
 * the configured MetaApi MT5 account. Returns HTTP 503 when MetaApi is not
 * configured (the caller should fall back to the env-default balance);
 * returns HTTP 500 on any other error.
 *
 * The response shape is intentionally compatible with the authStore's
 * AccountInfo so the sidebar can drop it straight in.
 */
export async function GET() {
  const config = readMetaApiConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "MetaApi not configured. Set METAAPI_TOKEN and MT5_ACCOUNT_ID env vars.",
        configured: false,
      },
      { status: 503 },
    );
  }

  let connection:
    | Awaited<ReturnType<typeof getConnectedRpcConnection>>["connection"]
    | null = null;
  try {
    const result = await getConnectedRpcConnection();
    connection = result.connection;
    const info = await result.connection.getAccountInformation();
    return NextResponse.json({
      configured: true,
      balance: Number.isFinite(info.balance) ? info.balance : 0,
      currency: info.currency || "USD",
      equity: Number.isFinite(info.equity) ? info.equity : info.balance,
      margin: Number.isFinite(info.margin) ? info.margin : 0,
      leverage: Number.isFinite(info.leverage) ? info.leverage : 0,
      server: config.server,
      login: config.login,
      platform: info.platform,
      broker: info.broker,
      accountCurrency: info.currency,
      freeMargin: info.freeMargin,
      marginLevel: info.marginLevel,
      tradeAllowed: info.tradeAllowed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { configured: true, error: message },
      { status: 500 },
    );
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch {
        /* ignore */
      }
    }
  }
}
