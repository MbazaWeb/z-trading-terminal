import { NextResponse } from "next/server";

// A public account number is not an authentication credential.
// Until a verified broker identity flow is implemented, do not issue MT5 sessions.
export async function POST() {
  return NextResponse.json(
    { error: "MT5 sign-in temporarily unavailable: verified broker authentication is required." },
    { status: 503 },
  );
}
