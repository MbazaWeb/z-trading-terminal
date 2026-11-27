import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const url = process.env.MT5_BRIDGE_URL;
  const key = process.env.MT5_BRIDGE_KEY;
  if (!url || !url.startsWith("https://") || !key || key.length < 32) {
    return NextResponse.json({ error: "MT5 bridge not configured" }, { status: 503 });
  }
  try {
    const { login, password, server } = await request.json();
    if (typeof login !== "string" || !/^\d{1,15}$/.test(login) || typeof password !== "string" || !password || password.length > 256 || typeof server !== "string" || !server.trim() || server.length > 128) {
      return NextResponse.json({ error: "Invalid credentials format" }, { status: 400 });
    }
    const response = await fetch(new URL("/verify", url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ login: Number(login), password, server: server.trim() }),
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return NextResponse.json({ error: "MT5 verification failed" }, { status: 502 });
    const account = await response.json();
    if (account.loginid !== String(Number(login)) || account.accountType !== "demo" || account.server !== server.trim() || !Number.isFinite(account.balance)) {
      return NextResponse.json({ error: "Invalid broker response" }, { status: 502 });
    }
    return NextResponse.json({ account }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "MT5 bridge unavailable or invalid request" }, { status: 502 });
  }
}
