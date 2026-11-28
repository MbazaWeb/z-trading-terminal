import { NextResponse } from "next/server";
import {
  requireAuth,
  authErrorResponse,
  type SessionData,
} from "@/lib/auth/session";
import { getBotConfig, updateBotConfig } from "@/lib/botConfig";

/**
 * GET /api/bot/config
 *
 * Returns the bot config for the authenticated session user. When no row
 * exists yet (first call after signup), inserts a default config and returns
 * it so the UI can render with sensible values without a null-check.
 *
 * POST /api/bot/config
 *
 * Patches the bot config. Used by the BotView Start/Stop button (sets
 * `running` true/false) and by the risk-management sliders (updates
 * max_position_size, max_daily_loss, etc.).
 *
 * Body for POST (any subset of):
 *   {
 *     running?: boolean,
 *     activeSymbol?: string,
 *     maxPositionSize?: number,
 *     maxDailyLoss?: number,
 *     maxConcurrentPositions?: number,
 *     defaultStopLoss?: number,
 *     defaultTakeProfit?: number,
 *     riskPerTrade?: number,
 *   }
 *
 * Returns the updated config row.
 */

export async function GET() {
  let session: SessionData;
  try {
    session = await requireAuth();
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }

  try {
    const config = await getBotConfig(session.userId);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to read bot config",
      },
      { status: 500 },
    );
  }
}

interface PatchBody {
  running?: boolean;
  activeSymbol?: string;
  maxPositionSize?: number;
  maxDailyLoss?: number;
  maxConcurrentPositions?: number;
  defaultStopLoss?: number;
  defaultTakeProfit?: number;
  riskPerTrade?: number;
}

export async function POST(request: Request) {
  let session: SessionData;
  try {
    session = await requireAuth();
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const patch: Parameters<typeof updateBotConfig>[1] = {};
  if (typeof body.running === "boolean") patch.running = body.running;
  if (typeof body.activeSymbol === "string" && body.activeSymbol.trim()) {
    patch.active_symbol = body.activeSymbol.trim();
  }
  if (typeof body.maxPositionSize === "number") {
    patch.max_position_size = Math.max(0, body.maxPositionSize);
  }
  if (typeof body.maxDailyLoss === "number") {
    patch.max_daily_loss = Math.max(0, body.maxDailyLoss);
  }
  if (typeof body.maxConcurrentPositions === "number") {
    patch.max_concurrent_positions = Math.max(1, Math.floor(body.maxConcurrentPositions));
  }
  if (typeof body.defaultStopLoss === "number") {
    patch.default_stop_loss = Math.max(0, body.defaultStopLoss);
  }
  if (typeof body.defaultTakeProfit === "number") {
    patch.default_take_profit = Math.max(0, body.defaultTakeProfit);
  }
  if (typeof body.riskPerTrade === "number") {
    patch.risk_per_trade = Math.max(0, body.riskPerTrade);
  }

  try {
    const updated = await updateBotConfig(session.userId, patch);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Failed to update bot config" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, config: updated });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to update bot config",
      },
      { status: 500 },
    );
  }
}
