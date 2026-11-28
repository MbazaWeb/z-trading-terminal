import { NextResponse } from "next/server";
import {
  requireAuth,
  authErrorResponse,
  type SessionData,
} from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseServer";

/**
 * GET /api/bot/logs
 *
 * Returns the most recent bot log entries for the authenticated session user.
 * The BotView polls this endpoint every 10 seconds to render the live
 * activity feed without any local simulation — all entries are written by
 * the cron bot worker (`/api/cron/bot`), the reconciliation step, or the
 * /api/mt5/* routes.
 *
 * Query params:
 *   limit: number (default 100, max 500) — number of entries to return.
 *
 * Returns:
 *   { ok: true, logs: BotLogRow[] }
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(request: Request) {
  let session: SessionData;
  try {
    session = await requireAuth();
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitParam)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitParam)))
    : DEFAULT_LIMIT;

  try {
    const { data, error } = await supabaseAdmin
      .from("bot_logs")
      .select("id, timestamp, tag, message, user_id")
      .eq("user_id", session.userId)
      .order("timestamp", { ascending: false })
      .limit(limit);
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, logs: [] },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, logs: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to fetch bot logs",
        logs: [],
      },
      { status: 500 },
    );
  }
}
