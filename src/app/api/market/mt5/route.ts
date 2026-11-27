import { NextRequest, NextResponse } from "next/server";
export async function GET(request: NextRequest) {
  const url = process.env.MT5_BRIDGE_URL;
  const key = process.env.MT5_BRIDGE_KEY;
  if (!url?.startsWith("https://") || !key || key.length < 32)
    return NextResponse.json({ error: "MT5 feed not configured" }, { status: 503 });
  const symbol = request.nextUrl.searchParams.get("symbol") || "";
  const timeframe = request.nextUrl.searchParams.get("timeframe") || "15m";
  if (symbol.length > 128 || !["1m","5m","15m","1H","4H","1D","1W"].includes(timeframe))
    return NextResponse.json({ error: "Invalid market request" }, { status: 400 });
  try {
    const target = new URL("/market", url);
    target.searchParams.set("symbol", symbol);
    target.searchParams.set("timeframe", timeframe);
    const response = await fetch(target, { headers: { Authorization: "Bearer " + key }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("Feed unavailable");
    return NextResponse.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "MT5 market feed unavailable" }, { status: 503 });
  }
}
