import { NextResponse } from "next/server";
import {
  getConnectedRpcConnection,
  releaseRpcConnection,
  readMetaApiConfig,
  type MetaApiPosition,
} from "@/lib/metaApiServer";
import { requireAuth, authErrorResponse } from "@/lib/auth/session";

/**
 * GET /api/mt5/positions
 *
 * Returns the list of currently open MT5 positions on the configured
 * account. Each position is normalized to the shape the terminal's bot view
 * expects (symbol, side, volume, openPrice, currentPrice, profit, sl, tp).
 *
 * Requires an authenticated server-side session (HttpOnly cookie).
 *
 * Returns HTTP 401 when no session exists; HTTP 503 when MetaApi is not
 * configured; HTTP 500 on other errors.
 */
export async function GET() {
  // --- Auth guard -----------------------------------------------------------
  try {
    await requireAuth();
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }

  const config = readMetaApiConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "MetaApi not configured. Set METAAPI_TOKEN and MT5_ACCOUNT_ID env vars.",
        configured: false,
        positions: [],
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
    const raw = await result.connection.getPositions();
    const positions = (raw ?? [])
      .map((p: MetaApiPosition) => {
        const side: "buy" | "sell" =
          p.type === "POSITION_TYPE_BUY" ? "buy" : "sell";
        return {
          id: String(p.id),
          symbol: p.symbol,
          side,
          volume: Number.isFinite(p.volume) ? p.volume : 0,
          openPrice: Number.isFinite(p.openPrice) ? p.openPrice : 0,
          currentPrice: Number.isFinite(p.currentPrice) ? p.currentPrice : 0,
          profit: Number.isFinite(p.profit) ? p.profit : 0,
          unrealizedProfit: Number.isFinite(p.unrealizedProfit ?? NaN)
            ? (p.unrealizedProfit as number)
            : p.profit,
          swap: Number.isFinite(p.swap ?? NaN) ? (p.swap as number) : 0,
          stopLoss:
            p.stopLoss != null && Number.isFinite(p.stopLoss)
              ? p.stopLoss
              : null,
          takeProfit:
            p.takeProfit != null && Number.isFinite(p.takeProfit)
              ? p.takeProfit
              : null,
          openedAt:
            p.time instanceof Date ? p.time.getTime() : new Date(p.time).getTime(),
          comment: p.comment ?? null,
        };
      })
      .filter((p: { symbol: string }) => Boolean(p.symbol));
    return NextResponse.json({
      configured: true,
      positions,
      count: positions.length,
      server: config.server,
      login: config.login,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { configured: true, error: message, positions: [], count: 0 },
      { status: 500 },
    );
  } finally {
    if (connection) {
      await releaseRpcConnection(connection);
    }
  }
}
