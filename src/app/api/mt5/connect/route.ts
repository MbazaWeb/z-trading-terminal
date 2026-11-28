import { NextResponse } from "next/server";
import { provisionMetaApiAccount } from "@/lib/metaApiServer";
import { requireAdmin, authErrorResponse } from "@/lib/auth/session";

/**
 * POST /api/mt5/connect
 *
 * Provisions a new MetaApi account tied to the user's MT5 login / password /
 * server. This is a one-time setup step: once provisioned, the returned
 * account id should be persisted as the `MT5_ACCOUNT_ID` env var on Vercel
 * (and `METAAPI_TOKEN` should be set to the user's MetaApi.cloud API token).
 *
 * Requires admin privileges (ZT_OWNER_USER_ID env var must match the session
 * user id). Provisioning a new MetaApi account costs quota on the user's
 * MetaApi plan, so we restrict it to the owner.
 *
 * Request body:
 *   {
 *     login:   string,        // MT5 login number (digits only)
 *     password: string,        // MT5 master/investor password
 *     server:  string,        // broker server, e.g. "EquitiBrokerageSC-Live"
 *     platform?: "mt4" | "mt5",  // default "mt5"
 *     name?:   string,        // optional human-readable label
 *   }
 *
 * Returns:
 *   { accountId: string, state: string | undefined }
 */
interface ConnectRequestBody {
  login?: string;
  password?: string;
  server?: string;
  platform?: "mt4" | "mt5";
  name?: string;
}

export async function POST(request: Request) {
  // --- Admin guard ----------------------------------------------------------
  try {
    await requireAdmin();
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }

  const token = process.env.METAAPI_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      {
        error:
          "MetaApi not configured. Set METAAPI_TOKEN in your env to provision an MT5 account.",
        configured: false,
      },
      { status: 503 },
    );
  }

  let body: ConnectRequestBody;
  try {
    body = (await request.json()) as ConnectRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const login = body.login?.trim();
  const password = body.password;
  const server = body.server?.trim();
  const platform = body.platform ?? "mt5";
  const name = body.name?.trim();

  if (!login || !/^\d+$/.test(login)) {
    return NextResponse.json(
      { error: "login is required and must be digits only" },
      { status: 400 },
    );
  }
  if (!password) {
    return NextResponse.json(
      { error: "password is required" },
      { status: 400 },
    );
  }
  if (!server) {
    return NextResponse.json(
      { error: "server is required" },
      { status: 400 },
    );
  }

  try {
    const account = await provisionMetaApiAccount({
      login,
      password,
      server,
      platform,
      name,
    });
    return NextResponse.json({
      configured: true,
      accountId: account.id,
      state: account.state,
      message:
        "Account provisioned. Set MT5_ACCOUNT_ID in your env to start using the /api/mt5/* routes.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { configured: true, error: message },
      { status: 500 },
    );
  }
}
