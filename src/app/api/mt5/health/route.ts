import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const key = process.env.MT5_BRIDGE_KEY;
  const unavailable = () => NextResponse.json({status:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
  try {
    const url = new URL(process.env.MT5_BRIDGE_URL ?? "");
    if (!key || key.length < 32 || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return unavailable();
    const response = await fetch(new URL("/health",url),{headers:{Authorization:"Bearer "+key},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});
    if (!response.ok) return unavailable();
    const data = await response.json();
    if (data.status !== "ready" || data.accountType !== "demo") return unavailable();
    return NextResponse.json({status:"ready"},{headers:{"Cache-Control":"no-store"}});
  } catch { return unavailable(); }
}
