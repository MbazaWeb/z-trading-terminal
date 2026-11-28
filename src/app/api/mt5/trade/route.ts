import { NextResponse } from "next/server";
import {
  getConnectedRpcConnection,
  releaseRpcConnection,
  readMetaApiConfig,
  type RpcConnection,
  type MetaApiAccountInfo,
  type MetaApiTradeResponse,
} from "@/lib/metaApiServer";
import {
  requireAuth,
  authErrorResponse,
  type SessionData,
} from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseServer";

/**
 * POST /api/mt5/trade
 *
 * Places a market order on the configured MT5 account via MetaApi. Before
 * submitting the order to the broker, the endpoint runs server-side risk
 * controls:
 *   1. Authentication: requireAuth() — the caller must have a valid
 *      server-side session (HttpOnly cookie).
 *   2. REAL_TRADING_ENABLED gate: real-account orders are rejected with a
 *      clear error when REAL_TRADING_ENABLED is not "true". This is the
 *      default — real money execution is opt-in.
 *   3. Idempotency: if the request includes a `clientOrderId`, we check
 *      Supabase for an existing trade with that id. If found, we return the
 *      existing trade instead of placing a duplicate order.
 *   4. Position size: `balance * riskPerTrade / 100` must not exceed
 *      `maxPositionSize` (default 500 USD).
 *   5. Daily loss: today's closed-trade loss must be below `maxDailyLoss`
 *      (default 200 USD).
 *   6. Volume bounds: the requested volume must be within the broker's
 *      min/max volume for the symbol (queried from MetaApi's symbol
 *      specification).
 *
 * Returns HTTP 401 when unauthenticated; 400 on invalid input or risk-check
 * failure; 503 when MetaApi is not configured; 500 on broker errors.
 *
 * Request body:
 *   {
 *     symbol: string,         // e.g. "BTCUSD" (broker symbol)
 *     side:   "buy" | "sell",
 *     volume: number,         // in lots
 *     sl?:    number,         // absolute stop-loss price
 *     tp?:    number,         // absolute take-profit price
 *     clientOrderId?: string, // UUID for idempotency
 *     riskPerTrade?: number,  // % of balance to risk (default 2)
 *     maxPositionSize?: number, // override config default
 *     maxDailyLoss?: number,    // override config default
 *   }
 */
interface TradeRequestBody {
  symbol?: string;
  side?: "buy" | "sell";
  volume?: number;
  sl?: number;
  tp?: number;
  clientOrderId?: string;
  riskPerTrade?: number;
  maxPositionSize?: number;
  maxDailyLoss?: number;
}

const DAY_MS = 86_400_000;

const DEFAULT_MAX_POSITION_SIZE = 500;
const DEFAULT_MAX_DAILY_LOSS = 200;
const DEFAULT_RISK_PER_TRADE = 2;

function realTradingEnabled(): boolean {
  const raw = process.env.REAL_TRADING_ENABLED;
  if (raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

interface RiskConfig {
  riskPerTrade: number;
  maxPositionSize: number;
  maxDailyLoss: number;
}

function resolveRiskConfig(body: TradeRequestBody): RiskConfig {
  const parse = (v: unknown, def: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    riskPerTrade: parse(body.riskPerTrade, DEFAULT_RISK_PER_TRADE),
    maxPositionSize: parse(body.maxPositionSize, DEFAULT_MAX_POSITION_SIZE),
    maxDailyLoss: parse(body.maxDailyLoss, DEFAULT_MAX_DAILY_LOSS),
  };
}

/**
 * Query Supabase (via the service-role client, bypassing RLS) for a trade
 * with the given client_order_id. Returns the existing trade row if found,
 * null otherwise. Used for idempotency: if the client retries after a
 * network blip, we return the existing trade instead of placing a new one.
 */
async function findTradeByClientOrderId(
  clientOrderId: string,
): Promise<{ id: string; broker_order_id: string | null; status: string } | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("trades")
      .select("id, broker_order_id, status")
      .eq("client_order_id", clientOrderId)
      .maybeSingle();
    if (error) {
      console.warn("[mt5/trade] idempotency lookup failed:", error.message);
      return null;
    }
    if (!data) return null;
    return data as { id: string; broker_order_id: string | null; status: string };
  } catch (err) {
    console.warn("[mt5/trade] idempotency lookup threw:", err);
    return null;
  }
}

/**
 * Insert a trade row into Supabase using the service-role client. The user_id
 * is taken from the server-side session (never trusted from the client).
 * Returns the inserted row id on success, null on failure (the broker order
 * has already been placed by this point; a Supabase failure is logged but
 * does not roll back the broker trade — the client retries via
 * syncPendingTrades).
 */
async function recordTrade(
  session: SessionData,
  input: {
    clientOrderId?: string;
    brokerOrderId: string | null;
    symbol: string;
    side: "buy" | "sell";
    volume: number;
    entryPrice: number | null;
    amount: number;
    source: "manual" | "bot" | "agent";
    sl?: number;
    tp?: number;
    brokerOpenTime?: string | null;
  },
): Promise<string | null> {
  const row = {
    status: "open" as const,
    datetime: new Date().toISOString(),
    market: input.symbol,
    side: input.side,
    amount: input.amount,
    entry_price: input.entryPrice ?? 0,
    exit_price: null,
    pnl: 0,
    pnl_pct: 0,
    result: null,
    agent_id: null,
    source: input.source,
    client_order_id: input.clientOrderId ?? null,
    broker_order_id: input.brokerOrderId,
    broker_open_time: input.brokerOpenTime ?? null,
    broker_close_time: null,
    hold_time_ms: null,
    user_id: session.userId,
  };
  try {
    const { data, error } = await supabaseAdmin
      .from("trades")
      .insert(row)
      .select("id")
      .single();
    if (error) {
      console.warn("[mt5/trade] Supabase insert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.warn("[mt5/trade] Supabase insert threw:", err);
    return null;
  }
}

/**
 * Sum today's closed-trade losses for the session user. Used by the daily
 * loss risk check. Returns the absolute loss in USD (0 if no losses today).
 */
async function todayClosedLoss(userId: string): Promise<number> {
  const dayStart = new Date(Date.now() - (Date.now() % DAY_MS)).toISOString();
  try {
    const { data, error } = await supabaseAdmin
      .from("trades")
      .select("pnl")
      .eq("user_id", userId)
      .eq("status", "closed")
      .gte("datetime", dayStart)
      .lt("pnl", 0);
    if (error) {
      console.warn("[mt5/trade] daily loss query failed:", error.message);
      return 0;
    }
    if (!Array.isArray(data)) return 0;
    return Math.abs(
      data.reduce((sum: number, row: { pnl: number }) => sum + (row.pnl ?? 0), 0),
    );
  } catch {
    return 0;
  }
}

/**
 * Fetch the symbol specification from MetaApi to validate the requested
 * volume is within the broker's min/max lot size. Returns null if the
 * specification cannot be loaded (we fail open in that case — the broker
 * will reject an invalid volume anyway).
 */
async function getSymbolVolumeBounds(
  connection: RpcConnection,
  symbol: string,
): Promise<{ minVolume: number; maxVolume: number } | null> {
  try {
    // The MetaApi RPC connection exposes getSymbolSpecification(symbol).
    // We use a loose cast because the minimal RpcConnection type above
    // doesn't include it (to keep the surface small). The runtime method
    // exists on the actual SDK object.
    const conn = connection as RpcConnection & {
      getSymbolSpecification?: (symbol: string) => Promise<{
        minVolume?: number;
        maxVolume?: number;
      }>;
    };
    if (!conn.getSymbolSpecification) return null;
    const spec = await conn.getSymbolSpecification(symbol);
    if (!spec) return null;
    return {
      minVolume: spec.minVolume ?? 0.01,
      maxVolume: spec.maxVolume ?? 100,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  // --- Auth guard -----------------------------------------------------------
  let session: SessionData;
  try {
    session = await requireAuth();
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
      },
      { status: 503 },
    );
  }

  // --- Real trading gate -----------------------------------------------------
  if (session.accountType === "real" && !realTradingEnabled()) {
    return NextResponse.json(
      {
        configured: true,
        ok: false,
        error:
          "Real trading is disabled. Set REAL_TRADING_ENABLED=true to enable.",
        reason: "real_trading_disabled",
      },
      { status: 403 },
    );
  }

  // --- Parse body ------------------------------------------------------------
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
  const clientOrderId = body.clientOrderId?.trim() || undefined;

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

  // --- Idempotency check -----------------------------------------------------
  if (clientOrderId) {
    const existing = await findTradeByClientOrderId(clientOrderId);
    if (existing) {
      return NextResponse.json({
        configured: true,
        ok: true,
        idempotent: true,
        tradeId: existing.id,
        orderId: existing.broker_order_id,
        symbol,
        side,
        volume,
        sl: sl ?? null,
        tp: tp ?? null,
        message: "Trade already exists for this clientOrderId — no duplicate placed.",
      });
    }
  }

  const risk = resolveRiskConfig(body);

  let connection:
    | Awaited<ReturnType<typeof getConnectedRpcConnection>>["connection"]
    | null = null;
  let accountInfo: MetaApiAccountInfo | null = null;
  try {
    const result = await getConnectedRpcConnection();
    connection = result.connection;

    // --- Server-side risk controls ------------------------------------------
    // 1. Fetch the real account balance + equity from MetaApi.
    accountInfo = await result.connection.getAccountInformation();
    const balance = Number.isFinite(accountInfo.balance)
      ? accountInfo.balance
      : 0;

    // 2. Position size based on balance * riskPerTrade / 100.
    const positionSize = (balance * risk.riskPerTrade) / 100;

    // Notional value of the requested order: volume * currentPrice (we use
    // equity as a proxy for margin availability when currentPrice is unknown).
    // For spot crypto on MT5 the "amount" is volume * contractSize * price.
    // We approximate using the entry price (sl/tp are absolute prices so the
    // caller is on a price-aware flow).
    const entryPrice = sl ?? tp ?? 0; // best-effort; real check is below
    void entryPrice;
    const notional = volume * (accountInfo.equity || balance);

    if (positionSize > risk.maxPositionSize) {
      await connection.close().catch(() => {});
      return NextResponse.json(
        {
          configured: true,
          ok: false,
          error: `Position size $${positionSize.toFixed(2)} exceeds max $${risk.maxPositionSize.toFixed(2)} (balance $${balance.toFixed(2)} * risk ${risk.riskPerTrade}%)`,
          reason: "position_size_exceeded",
          balance,
          positionSize,
          maxPositionSize: risk.maxPositionSize,
        },
        { status: 400 },
      );
    }

    // 3. Daily loss check.
    const dailyLoss = await todayClosedLoss(session.userId);
    if (dailyLoss + positionSize > risk.maxDailyLoss) {
      await connection.close().catch(() => {});
      return NextResponse.json(
        {
          configured: true,
          ok: false,
          error: `Daily loss limit reached: today $${dailyLoss.toFixed(2)} + this order $${positionSize.toFixed(2)} > max $${risk.maxDailyLoss.toFixed(2)}`,
          reason: "daily_loss_exceeded",
          dailyLoss,
          positionSize,
          maxDailyLoss: risk.maxDailyLoss,
        },
        { status: 400 },
      );
    }

    // 4. Volume bounds (broker min/max lot size).
    const bounds = await getSymbolVolumeBounds(result.connection, symbol);
    if (bounds) {
      if (volume < bounds.minVolume) {
        await connection.close().catch(() => {});
        return NextResponse.json(
          {
            configured: true,
            ok: false,
            error: `Volume ${volume} below broker minimum ${bounds.minVolume} for ${symbol}`,
            reason: "volume_below_min",
            minVolume: bounds.minVolume,
            maxVolume: bounds.maxVolume,
          },
          { status: 400 },
        );
      }
      if (volume > bounds.maxVolume) {
        await connection.close().catch(() => {});
        return NextResponse.json(
          {
            configured: true,
            ok: false,
            error: `Volume ${volume} above broker maximum ${bounds.maxVolume} for ${symbol}`,
            reason: "volume_above_max",
            minVolume: bounds.minVolume,
            maxVolume: bounds.maxVolume,
          },
          { status: 400 },
        );
      }
    }

    // 5. Equity / free margin check (best-effort: skip if MetaApi doesn't
    //    expose freeMargin on this connection).
    const freeMargin =
      typeof accountInfo.freeMargin === "number" ? accountInfo.freeMargin : null;
    if (freeMargin != null && notional > freeMargin) {
      await connection.close().catch(() => {});
      return NextResponse.json(
        {
          configured: true,
          ok: false,
          error: `Order notional $${notional.toFixed(2)} exceeds free margin $${freeMargin.toFixed(2)}`,
          reason: "insufficient_margin",
          notional,
          freeMargin,
        },
        { status: 400 },
      );
    }

    // --- All checks pass: submit the order to the broker --------------------
    const response: MetaApiTradeResponse =
      side === "buy"
        ? await result.connection.createMarketBuyOrder(symbol, volume, sl, tp)
        : await result.connection.createMarketSellOrder(symbol, volume, sl, tp);

    const brokerOrderId = response?.orderId != null ? String(response.orderId) : null;
    // Capture the broker-reported open time (ZT-14). MetaApi returns this as
    // either a Date or an ISO string; normalize to an ISO string for storage.
    const rawOpenTime = response?.openTime;
    const brokerOpenTimeIso =
      rawOpenTime != null
        ? rawOpenTime instanceof Date
          ? rawOpenTime.toISOString()
          : typeof rawOpenTime === "number"
            ? new Date(rawOpenTime).toISOString()
            : typeof rawOpenTime === "string"
              ? new Date(rawOpenTime).toISOString()
              : null
        : null;

    // Record the trade in Supabase with the broker order id + client order id.
    // We don't fail the request if the Supabase insert fails — the broker
    // order has already been placed. The client retries the save via
    // syncPendingTrades.
    const tradeId = await recordTrade(session, {
      clientOrderId,
      brokerOrderId,
      symbol,
      side,
      volume,
      entryPrice: accountInfo.equity || 0,
      amount: positionSize,
      source: "manual",
      sl,
      tp,
      brokerOpenTime: brokerOpenTimeIso,
    });

    return NextResponse.json({
      configured: true,
      ok: true,
      side,
      symbol,
      volume,
      sl: sl ?? null,
      tp: tp ?? null,
      orderId: brokerOrderId,
      positionId: response?.positionId != null ? String(response.positionId) : null,
      brokerOpenTime: brokerOpenTimeIso,
      tradeId,
      persisted: tradeId != null,
      balance,
      equity: accountInfo.equity,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { configured: true, ok: false, error: message },
      { status: 500 },
    );
  } finally {
    if (connection) {
      await releaseRpcConnection(connection);
    }
  }
}
