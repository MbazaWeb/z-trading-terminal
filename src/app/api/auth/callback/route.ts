import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/?auth_error=invalid_callback", request.url));
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/?auth_error=verification_failed", request.url));
  if (request.nextUrl.searchParams.get("next") === "reset-password") {
    return NextResponse.redirect(new URL("/?auth=recovery", request.url));
  }
  return NextResponse.redirect(new URL("/", request.url));
}
