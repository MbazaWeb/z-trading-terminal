import { NextResponse } from "next/server";
import { requireAuth, authErrorResponse } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseServer";

export async function GET() {
  try {
    const session = await requireAuth();
    const { data, error } = await supabaseAdmin
      .from("broker_accounts")
      .select("id,broker,account_number,server,currency,balance,equity,account_type,connection_status,last_synced_at,created_at")
      .eq("user_id", session.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ accounts: data ?? [] });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response.status !== 401) return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load accounts" }, { status: 500 });
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const body = await request.json() as { accountId?: string; action?: "select"|"disconnect"|"reconnect" };
    if (!body.accountId || !body.action) return NextResponse.json({ error: "accountId and action are required" }, { status: 400 });

    const { data: account, error } = await supabaseAdmin
      .from("broker_accounts")
      .select("*")
      .eq("id", body.accountId)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (error) throw error;
    if (!account) return NextResponse.json({ error: "Broker account not found" }, { status: 404 });

    if (body.action === "disconnect") {
      await supabaseAdmin.from("broker_accounts").update({ connection_status: "disconnected", updated_at: new Date().toISOString() }).eq("id", account.id);
      await supabaseAdmin.from("audit_logs").insert({ user_id: session.userId, broker_account_id: account.id, action: "broker_account_disconnected" });
    } else {
      await supabaseAdmin.from("broker_accounts").update({ connection_status: "connected", last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", account.id);
      await supabaseAdmin.from("audit_logs").insert({ user_id: session.userId, broker_account_id: account.id, action: body.action === "select" ? "broker_account_selected" : "broker_account_reconnected" });
    }
    return NextResponse.json({ ok: true, accountId: account.id });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response.status === 401) return NextResponse.json(response.body, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update broker account" }, { status: 500 });
  }
}
