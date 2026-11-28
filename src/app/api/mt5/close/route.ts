import { NextResponse } from "next/server";
import {
  getConnectedRpcConnection,
  releaseRpcConnection,
  readMetaApiConfig,
  type MetaApiTradeResponse,
} from "@/lib/metaApiServer";
import {
  requireAuth,
  authErrorResponse,
  type SessionData,
} from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseServer";

/**
 * POST /api/mt5/close
 *
 * Closes an open MT5 position by its broker position id. The caller supplies
 * the `positionId` returned by /api/mt5/trade when the position was opened.
 *
 * Requires an authenticated server-side session. Returns HTTP 401 when
 * unauthenticated; HTTP 503 when MetaApi is not configured; HTTP 500 on
 * broker errors.
 *
 * After the broker confirms the close, this route also updates the matching
 * Supabase trade row (looked up by `broker_order_id`) with the broker close
 * time and computed hold time (ZT-14). The update is best-effort: if the row
 * can't be found the broker close still succeeds — the trade will be
 * reconciled by the cron worker's `reconcilePositions()` step.
 *
 * Request body:
 *   { positionId: string }
 *
 * Returns:
 *   { ok: true, positionId, brokerCloseTime, holdTimeMs }
 */
interface CloseRequestBody {
  positionId?: string;
}

function toIso(value: Date | string | number | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export async function POST(request: Request) {
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

  let body: CloseRequestBody;
  try {
    body = (await request.json()) as CloseRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const positionId = body.positionId?.trim();
  if (!positionId) {
    return NextResponse.json(
      { error: "positionId is required" },
      { status: 400 },
    );
  }

  let connection:
    | Awaited<ReturnType<typeof getConnectedRpcConnection>>["connection"]
    | null = null;
  try {
    const result = await getConnectedRpcConnection();
    connection = result.connection;
    const response = (await result.connection.closePosition(positionId)) as
      | MetaApiTradeResponse
      | void;

    // Capture the broker-reported close time and compute the hold duration
    // from the stored broker_open_time (ZT-14).
    const brokerCloseTimeIso = toIso(response?.closeTime);
    let brokerOpenTimeIso: string | null = null;
    let holdTimeMs: number | null = null;
    if (brokerCloseTimeIso) {
      try {
        const { data } = await supabaseAdmin
          .from("trades")
          .select("id, broker_open_time")
          .eq("broker_order_id", positionId)
          .eq("user_id", session.userId)
          .maybeSingle();
        if (data?.broker_open_time) {
          brokerOpenTimeIso = data.broker_open_time as string;
          const openMs = new Date(brokerOpenTimeIso).getTime();
          const closeMs = new Date(brokerCloseTimeIso).getTime();
          if (Number.isFinite(openMs) && Number.isFinite(closeMs) && closeMs > openMs) {
            holdTimeMs = closeMs - openMs;
          }
        }
      } catch (err) {
        // Best-effort lookup — broker close has already succeeded.
        console.warn("[mt5/close] trade lookup failed:", err);
      }

      // Persist the broker close time + hold time on the matching trade row.
      if (brokerOpenTimeIso != null) {
        try {
          await supabaseAdmin
            .from("trades")
            .update({
              broker_close_time: brokerCloseTimeIso,
              hold_time_ms: holdTimeMs,
            })
            .eq("broker_order_id", positionId)
            .eq("user_id", session.userId);
        } catch (err) {
          console.warn("[mt5/close] trade update failed:", err);
        }
      }
    }

    return NextResponse.json({
      configured: true,
      ok: true,
      positionId,
      brokerCloseTime: brokerCloseTimeIso,
      holdTimeMs,
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
