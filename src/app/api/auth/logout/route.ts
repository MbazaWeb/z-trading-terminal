import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";

/**
 * POST /api/auth/logout
 *
 * Clears the server-side session cookie. The client should also reset its
 * local auth store (provider, accountType, etc.) when this returns.
 */
export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
