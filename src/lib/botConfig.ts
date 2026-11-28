// Server-side bot configuration persistence (ZT-12).
//
// The bot's running state, active symbol, and risk parameters (max position
// size, max daily loss, etc.) are stored in Supabase's `bot_config` table
// (one row per user). This module is the single source of truth for reading
// and writing that row from server-side code: the cron bot worker, the
// /api/bot/config route, and the reconciliation step.
//
// All reads return a normalized `BotConfigRow`; missing numeric fields fall
// back to the `BOT_DEFAULT_*` env vars (or hard-coded defaults when those are
// unset) so a brand-new user gets sensible values without having to configure
// anything first.

import { supabaseAdmin } from "@/lib/supabaseServer";

export interface BotConfigRow {
  id: string;
  user_id: string;
  running: boolean;
  active_symbol: string;
  max_position_size: number;
  max_daily_loss: number;
  max_concurrent_positions: number;
  default_stop_loss: number;
  default_take_profit: number;
  risk_per_trade: number;
  updated_at: string;
}

// ---- Defaults (env-var driven so deploys can override without code) --------

const DEFAULT_SYMBOL = process.env.BOT_DEFAULT_SYMBOL?.trim() || "BTCUSDT";
const DEFAULT_MAX_POSITION_SIZE = Number(
  process.env.BOT_DEFAULT_MAX_POSITION_SIZE ?? 500,
);
const DEFAULT_MAX_DAILY_LOSS = Number(
  process.env.BOT_DEFAULT_MAX_DAILY_LOSS ?? 200,
);
const DEFAULT_MAX_CONCURRENT_POSITIONS = 5;
const DEFAULT_STOP_LOSS = 1.5;
const DEFAULT_TAKE_PROFIT = 3.0;
const DEFAULT_RISK_PER_TRADE = 2.0;

function defaultConfig(userId: string): BotConfigRow {
  const now = new Date().toISOString();
  return {
    id: `default-${userId}`,
    user_id: userId,
    running: false,
    active_symbol: DEFAULT_SYMBOL,
    max_position_size: Number.isFinite(DEFAULT_MAX_POSITION_SIZE)
      ? DEFAULT_MAX_POSITION_SIZE
      : 500,
    max_daily_loss: Number.isFinite(DEFAULT_MAX_DAILY_LOSS)
      ? DEFAULT_MAX_DAILY_LOSS
      : 200,
    max_concurrent_positions: DEFAULT_MAX_CONCURRENT_POSITIONS,
    default_stop_loss: DEFAULT_STOP_LOSS,
    default_take_profit: DEFAULT_TAKE_PROFIT,
    risk_per_trade: DEFAULT_RISK_PER_TRADE,
    updated_at: now,
  };
}

function normalizeRow(raw: Record<string, unknown>): BotConfigRow {
  const userId = String(raw.user_id ?? "");
  const fallback = defaultConfig(userId);
  const num = (v: unknown, def: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : def;
  };
  return {
    id: String(raw.id ?? fallback.id),
    user_id: userId,
    running: Boolean(raw.running ?? false),
    active_symbol: String(raw.active_symbol ?? fallback.active_symbol),
    max_position_size: num(raw.max_position_size, fallback.max_position_size),
    max_daily_loss: num(raw.max_daily_loss, fallback.max_daily_loss),
    max_concurrent_positions: Math.max(
      1,
      Math.floor(num(raw.max_concurrent_positions, fallback.max_concurrent_positions)),
    ),
    default_stop_loss: num(raw.default_stop_loss, fallback.default_stop_loss),
    default_take_profit: num(raw.default_take_profit, fallback.default_take_profit),
    risk_per_trade: num(raw.risk_per_trade, fallback.risk_per_trade),
    updated_at: String(raw.updated_at ?? fallback.updated_at),
  };
}

/**
 * Read the bot config for a user. Returns a normalized `BotConfigRow` even
 * when no row exists yet (so callers don't have to null-check every field).
 *
 * When Supabase is not configured or the read fails, returns the default
 * config so the cron worker can still operate in a degraded mode.
 */
export async function getBotConfig(
  userId: string,
): Promise<BotConfigRow> {
  try {
    const { data, error } = await supabaseAdmin
      .from("bot_config")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[botConfig] getBotConfig failed:", error.message);
      return defaultConfig(userId);
    }
    if (!data) {
      // No row yet — insert the default so subsequent reads are fast. Best
      // effort; ignore conflicts from concurrent inserts.
      const fresh = defaultConfig(userId);
      await supabaseAdmin
        .from("bot_config")
        .insert({
          user_id: userId,
          running: fresh.running,
          active_symbol: fresh.active_symbol,
          max_position_size: fresh.max_position_size,
          max_daily_loss: fresh.max_daily_loss,
          max_concurrent_positions: fresh.max_concurrent_positions,
          default_stop_loss: fresh.default_stop_loss,
          default_take_profit: fresh.default_take_profit,
          risk_per_trade: fresh.risk_per_trade,
        })
        .then((res) => {
          if (res.error) {
            // Ignore unique-violation (concurrent insert); other errors are
            // logged so the operator can debug.
            if (!/duplicate/i.test(res.error.message)) {
              console.warn("[botConfig] default insert failed:", res.error.message);
            }
          }
        });
      return fresh;
    }
    return normalizeRow(data as Record<string, unknown>);
  } catch (err) {
    console.warn("[botConfig] getBotConfig threw:", err);
    return defaultConfig(userId);
  }
}

/**
 * Patch the bot config for a user. Only the supplied fields are updated.
 * Returns the updated row (or the default when the read back fails).
 */
export async function updateBotConfig(
  userId: string,
  patch: Partial<Omit<BotConfigRow, "id" | "user_id" | "updated_at">>,
): Promise<BotConfigRow | null> {
  const update: Record<string, unknown> = {};
  if (typeof patch.running === "boolean") update.running = patch.running;
  if (typeof patch.active_symbol === "string") update.active_symbol = patch.active_symbol;
  if (typeof patch.max_position_size === "number")
    update.max_position_size = patch.max_position_size;
  if (typeof patch.max_daily_loss === "number")
    update.max_daily_loss = patch.max_daily_loss;
  if (typeof patch.max_concurrent_positions === "number")
    update.max_concurrent_positions = Math.max(1, Math.floor(patch.max_concurrent_positions));
  if (typeof patch.default_stop_loss === "number")
    update.default_stop_loss = patch.default_stop_loss;
  if (typeof patch.default_take_profit === "number")
    update.default_take_profit = patch.default_take_profit;
  if (typeof patch.risk_per_trade === "number")
    update.risk_per_trade = patch.risk_per_trade;

  if (Object.keys(update).length === 0) {
    return getBotConfig(userId);
  }

  try {
    // Upsert: insert a default row if none exists, otherwise update.
    const { data: existing } = await supabaseAdmin
      .from("bot_config")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from("bot_config")
        .update(update)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (error) {
        console.warn("[botConfig] update failed:", error.message);
        return null;
      }
      if (!data) return null;
      return normalizeRow(data as Record<string, unknown>);
    }

    // No existing row — insert with the patch merged into defaults.
    const defaults = defaultConfig(userId);
    const insertRow = {
      user_id: userId,
      running: typeof patch.running === "boolean" ? patch.running : defaults.running,
      active_symbol:
        typeof patch.active_symbol === "string"
          ? patch.active_symbol
          : defaults.active_symbol,
      max_position_size:
        typeof patch.max_position_size === "number"
          ? patch.max_position_size
          : defaults.max_position_size,
      max_daily_loss:
        typeof patch.max_daily_loss === "number"
          ? patch.max_daily_loss
          : defaults.max_daily_loss,
      max_concurrent_positions:
        typeof patch.max_concurrent_positions === "number"
          ? patch.max_concurrent_positions
          : defaults.max_concurrent_positions,
      default_stop_loss:
        typeof patch.default_stop_loss === "number"
          ? patch.default_stop_loss
          : defaults.default_stop_loss,
      default_take_profit:
        typeof patch.default_take_profit === "number"
          ? patch.default_take_profit
          : defaults.default_take_profit,
      risk_per_trade:
        typeof patch.risk_per_trade === "number"
          ? patch.risk_per_trade
          : defaults.risk_per_trade,
    };
    const { data, error } = await supabaseAdmin
      .from("bot_config")
      .insert(insertRow)
      .select("*")
      .maybeSingle();
    if (error) {
      console.warn("[botConfig] insert failed:", error.message);
      return null;
    }
    if (!data) return null;
    return normalizeRow(data as Record<string, unknown>);
  } catch (err) {
    console.warn("[botConfig] updateBotConfig threw:", err);
    return null;
  }
}

/**
 * Toggle the bot's running state for a user. Convenience wrapper around
 * `updateBotConfig` so call sites read more naturally.
 */
export async function setBotRunning(
  userId: string,
  running: boolean,
): Promise<void> {
  await updateBotConfig(userId, { running });
}

/**
 * List every bot config row whose `running` flag is true. Used by the cron
 * worker to iterate over all users that need a bot cycle on this tick.
 */
export async function listRunningBots(): Promise<BotConfigRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("bot_config")
      .select("*")
      .eq("running", true);
    if (error) {
      console.warn("[botConfig] listRunningBots failed:", error.message);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).map(normalizeRow);
  } catch (err) {
    console.warn("[botConfig] listRunningBots threw:", err);
    return [];
  }
}

/**
 * Append a bot log entry for the user. Best-effort: failures are logged but
 * never thrown (the cron worker shouldn't abort just because a log row failed).
 */
export async function appendBotLog(
  userId: string,
  tag:
    | "SIGNAL"
    | "RISK-CHECK"
    | "ORDER"
    | "STOP-LOSS"
    | "TAKE-PROFIT"
    | "INFO",
  message: string,
): Promise<void> {
  try {
    await supabaseAdmin.from("bot_logs").insert({
      tag,
      message,
      user_id: userId,
    });
  } catch (err) {
    console.warn("[botConfig] appendBotLog failed:", err);
  }
}
