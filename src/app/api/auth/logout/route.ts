import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/logout
 *
 * Clears the server-side session cookie. The client should also reset its
 * local auth store (provider, accountType, etc.) when this returns.
 */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearSession();
  return NextResponse.json({ ok: true });
}
