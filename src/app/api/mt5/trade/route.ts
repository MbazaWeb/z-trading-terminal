import { NextResponse } from "next/server";
import {
  getConnectedRpcConnection,
  readMetaApiConfig,
} from "@/lib/metaApiServer";

/**
 * POST /api/mt5/trade
 *
 * Places a market order on the configured MT5 account via MetaApi.
 *
 * Request body:
 *   {
 *     symbol: string,         // e.g. "BTCUSD" (broker symbol)
 *     side:   "buy" | "sell",
 *     volume: number,         // in lots
 *     sl?:    number,         // absolute stop-loss price
 *     tp?:    number,         // absolute take-profit price
 *   }
 *
 * Returns HTTP 503 when MetaApi is not configured, HTTP 400 on invalid
 * input, HTTP 500 on broker errors.
 */
interface TradeRequestBody {
  symbol?: string;
  side?: "buy" | "sell";
  volume?: number;
  sl?: number;
  tp?: number;
}

export async function POST(request: Request) {
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

  let body: TradeRequestBody;
  try {
    body = (await request.json()) as TradeRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const symbol = body.symbol?.trim();
  const side = body.side;
  const volume = Number(body.volume);
  const sl = body.sl != null ? Number(body.sl) : undefined;
  const tp = body.tp != null ? Number(body.tp) : undefined;

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol is required" },
      { status: 400 },
    );
  }
  if (side !== "buy" && side !== "sell") {
    return NextResponse.json(
      { error: "side must be 'buy' or 'sell'" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(volume) || volume <= 0) {
    return NextResponse.json(
      { error: "volume must be a positive number" },
      { status: 400 },
    );
  }
  if (sl != null && !Number.isFinite(sl)) {
    return NextResponse.json(
      { error: "sl must be a finite number when provided" },
      { status: 400 },
    );
  }
  if (tp != null && !Number.isFinite(tp)) {
    return NextResponse.json(
      { error: "tp must be a finite number when provided" },
      { status: 400 },
    );
  }

  let connection:
    | Awaited<ReturnType<typeof getConnectedRpcConnection>>["connection"]
    | null = null;
  try {
    const result = await getConnectedRpcConnection();
    connection = result.connection;
    const response =
      side === "buy"
        ? await result.connection.createMarketBuyOrder(
            symbol,
            volume,
            sl,
            tp,
          )
        : await result.connection.createMarketSellOrder(
            symbol,
            volume,
            sl,
            tp,
          );
    return NextResponse.json({
      configured: true,
      ok: true,
      side,
      symbol,
      volume,
      sl: sl ?? null,
      tp: tp ?? null,
      orderId: response?.orderId ?? null,
      positionId: response?.positionId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { configured: true, ok: false, error: message },
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
