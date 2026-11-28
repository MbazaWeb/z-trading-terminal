import { NextResponse } from "next/server";
import {
  requireAuth,
  authErrorResponse,
  type SessionData,
} from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseServer";

/**
 * GET /api/trades
 *
 * Returns the trade history for the authenticated session user. Reads via
 * the service-role client (bypasses RLS) so we can filter by user_id from
 * the session without requiring Supabase Auth.
 *
 * POST /api/trades
 *
 * Inserts a trade row. The user_id is taken from the server-side session
 * (never trusted from the client). If the request includes a `clientOrderId`
 * and a trade with that id already exists, the endpoint returns the existing
 * row (idempotent) instead of inserting a duplicate.
 *
 * Used by:
 *   - Paper trades (source = "paper", brokerOrderId = null)
 *   - Manual trades placed when MetaApi is not configured (fall back to paper)
 *   - Bot / agent trades that don't go through /api/mt5/trade
 *
 * Body for POST:
 *   {
 *     id?: string,             // optional client-generated id
 *     clientOrderId?: string,  // idempotency key (UUID)
 *     status: "open" | "closed",
 *     datetime: string (ISO),
 *     market: string,
 *     side: "buy" | "sell",
 *     amount: number,
 *     entryPrice: number,
 *     exitPrice?: number | null,
 *     pnl?: number,
 *     pnlPct?: number,
 *     result?: "win" | "loss" | null,
 *     agentId?: string | null,
 *     source: "manual" | "bot" | "agent" | "paper" | "seed",
 *     brokerOrderId?: string | null,
 *   }
 */

const TRADES_LIMIT = 500;

export async function GET() {
  let session: SessionData;
  try {
    session = await requireAuth();
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("trades")
      .select("*")
      .eq("user_id", session.userId)
      .order("datetime", { ascending: false })
      .limit(TRADES_LIMIT);
    if (error) {
      return NextResponse.json(
        { error: error.message, trades: [] },
        { status: 500 },
      );
    }
    return NextResponse.json({ trades: data ?? [], count: (data ?? []).length });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to fetch trades",
        trades: [],
      },
      { status: 500 },
    );
  }
}

interface InsertBody {
  id?: string;
  clientOrderId?: string;
  status?: "open" | "closed";
  datetime?: string;
  market?: string;
  side?: "buy" | "sell";
  amount?: number;
  entryPrice?: number;
  exitPrice?: number | null;
  pnl?: number;
  pnlPct?: number;
  result?: "win" | "loss" | null;
  agentId?: string | null;
  source?: "manual" | "bot" | "agent" | "paper" | "seed";
  brokerOrderId?: string | null;
  brokerOpenTime?: string | null;
  brokerCloseTime?: string | null;
  holdTimeMs?: number | null;
}

export async function POST(request: Request) {
  let session: SessionData;
  try {
    session = await requireAuth();
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }

  let body: InsertBody;
  try {
    body = (await request.json()) as InsertBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.market || !body.side || typeof body.amount !== "number") {
    return NextResponse.json(
      { error: "market, side, and amount are required" },
      { status: 400 },
    );
  }

  const clientOrderId = body.clientOrderId?.trim() || undefined;

  // --- Idempotency check -----------------------------------------------------
  if (clientOrderId) {
    try {
      const { data: existing } = await supabaseAdmin
        .from("trades")
        .select("*")
        .eq("client_order_id", clientOrderId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({
          ok: true,
          idempotent: true,
          trade: existing,
          message: "Trade already exists for this clientOrderId.",
        });
      }
    } catch (err) {
      console.warn("[trades] idempotency lookup failed:", err);
    }
  }

  const row = {
    id: body.id ?? undefined,
    status: body.status ?? "open",
    datetime: body.datetime ?? new Date().toISOString(),
    market: body.market,
    side: body.side,
    amount: body.amount,
    entry_price: body.entryPrice ?? 0,
    exit_price: body.exitPrice ?? null,
    pnl: body.pnl ?? 0,
    pnl_pct: body.pnlPct ?? 0,
    result: body.result ?? null,
    agent_id: body.agentId ?? null,
    source: body.source ?? "manual",
    client_order_id: clientOrderId ?? null,
    broker_order_id: body.brokerOrderId ?? null,
    broker_open_time: body.brokerOpenTime ?? null,
    broker_close_time: body.brokerCloseTime ?? null,
    hold_time_ms: body.holdTimeMs ?? null,
    user_id: session.userId,
  };

  try {
    const { data, error } = await supabaseAdmin
      .from("trades")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      console.warn("[trades] insert failed:", error.message);
      return NextResponse.json(
        { error: error.message, persisted: false },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, trade: data, persisted: true });
  } catch (err) {
    console.warn("[trades] insert threw:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Insert failed",
        persisted: false,
      },
      { status: 500 },
    );
  }
}
