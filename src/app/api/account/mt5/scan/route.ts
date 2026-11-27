import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/mt5Session";
export async function POST(request:NextRequest){
 if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Invalid origin"},{status:403});
 const key=process.env.MT5_BRIDGE_KEY,url=process.env.MT5_BRIDGE_URL;
 if(!key||key.length<32||!url?.startsWith("https://"))return NextResponse.json({error:"Bridge unavailable"},{status:503});
 const session=readSession(request.cookies.get("mt5_session")?.value??"",key);
 if(!session)return NextResponse.json({error:"Sign in again"},{status:401});
 try{
 const {symbols,strategy}=await request.json();
 if(!Array.isArray(symbols)||symbols.length<1||symbols.length>10||symbols.some(s=>typeof s!=="string"||!s||s.length>128)||!["ensemble","ma","bollinger","rsi","macd","trend","reversion","breakout"].includes(strategy))return NextResponse.json({error:"Invalid scanner configuration"},{status:400});
 const res=await fetch(new URL("/scan",url),{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({symbols,strategy,login:Number(session.login),server:session.server}),signal:AbortSignal.timeout(45000),cache:"no-store"});
 const data=await res.json();
 return NextResponse.json(res.ok?data:{error:typeof data.detail==="string"?data.detail:"Scan failed"},{status:res.status,headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Scanner unavailable"},{status:503});}
}
