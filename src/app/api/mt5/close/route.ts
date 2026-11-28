import { NextResponse } from "next/server";
import {
  getConnectedRpcConnection,
  readMetaApiConfig,
} from "@/lib/metaApiServer";
import { requireAuth, authErrorResponse } from "@/lib/auth/session";

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
 * Request body:
 *   { positionId: string }
 *
 * Returns:
 *   { ok: true, positionId }
 */
interface CloseRequestBody {
  positionId?: string;
}

export async function POST(request: Request) {
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
    await result.connection.closePosition(positionId);
    return NextResponse.json({
      configured: true,
      ok: true,
      positionId,
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
