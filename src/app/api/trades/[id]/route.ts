import { NextResponse } from "next/server";
import {
  requireAuth,
  authErrorResponse,
  type SessionData,
} from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseServer";

/**
 * PATCH /api/trades/[id]
 *
 * Updates a trade row. Used to close a position (set status="closed",
 * exit_price, pnl, result) or to mark a paper trade as filled. The user_id
 * is verified against the session to prevent cross-user writes.
 *
 * Body:
 *   {
 *     status?: "open" | "closed",
 *     exitPrice?: number | null,
 *     pnl?: number,
 *     pnlPct?: number,
 *     result?: "win" | "loss" | null,
 *     brokerOrderId?: string | null,
 *   }
 */
interface PatchBody {
  status?: "open" | "closed";
  exitPrice?: number | null;
  pnl?: number;
  pnlPct?: number;
  result?: "win" | "loss" | null;
  brokerOrderId?: string | null;
  brokerOpenTime?: string | null;
  brokerCloseTime?: string | null;
  holdTimeMs?: number | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session: SessionData;
  try {
    session = await requireAuth();
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 },
    );
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (body.status === "open" || body.status === "closed") update.status = body.status;
  if (body.exitPrice !== undefined) update.exit_price = body.exitPrice;
  if (typeof body.pnl === "number") update.pnl = body.pnl;
  if (typeof body.pnlPct === "number") update.pnl_pct = body.pnlPct;
  if (body.result !== undefined) update.result = body.result;
  if (body.brokerOrderId !== undefined) update.broker_order_id = body.brokerOrderId;
  if (body.brokerOpenTime !== undefined) update.broker_open_time = body.brokerOpenTime;
  if (body.brokerCloseTime !== undefined) update.broker_close_time = body.brokerCloseTime;
  if (body.holdTimeMs !== undefined) update.hold_time_ms = body.holdTimeMs;

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 },
    );
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("trades")
      .update(update)
      .eq("id", id)
      .eq("user_id", session.userId)
      .select("*")
      .maybeSingle();
    if (error) {
      console.warn("[trades/:id] update failed:", error.message);
      return NextResponse.json(
        { error: error.message, persisted: false },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "Trade not found for this user", persisted: false },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, trade: data, persisted: true });
  } catch (err) {
    console.warn("[trades/:id] update threw:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Update failed",
        persisted: false,
      },
      { status: 500 },
    );
  }
}
