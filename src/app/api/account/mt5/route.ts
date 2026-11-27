import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/mt5Session";
export async function GET(request: NextRequest) {
  const key=process.env.MT5_BRIDGE_KEY;
  const url=process.env.MT5_BRIDGE_URL;
  if(!key || key.length<32 || !url?.startsWith("https://")) return NextResponse.json({error:"Bridge unavailable"},{status:503});
  const session=readSession(request.cookies.get("mt5_session")?.value??"",key);
  if(!session) return NextResponse.json({error:"Sign in again to verify account"},{status:401});
  try {
    const target=new URL("/account",url);
    target.searchParams.set("login",session.login);
    target.searchParams.set("server",session.server);
    const res=await fetch(target,{headers:{Authorization:"Bearer "+key},cache:"no-store",signal:AbortSignal.timeout(20000)});
    if(!res.ok) throw Error("Account unavailable");
    const data=await res.json();
    if(data.loginid!==session.login || data.server!==session.server) throw Error("Account mismatch");
    return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
  } catch {return NextResponse.json({error:"Verified account unavailable"},{status:503});}
}
export async function DELETE() {
  const res=NextResponse.json({ok:true});
  res.cookies.set("mt5_session","",{httpOnly:true,secure:true,sameSite:"strict",path:"/api/account/mt5",maxAge:0});
  return res;
}
