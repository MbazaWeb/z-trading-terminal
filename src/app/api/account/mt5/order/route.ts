import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/mt5Session";
export async function POST(request:NextRequest){
 if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Invalid origin"},{status:403});
 const key=process.env.MT5_BRIDGE_KEY,url=process.env.MT5_BRIDGE_URL;
 if(process.env.MT5_DEMO_EXECUTION!=="true"||!key||key.length<32||!url?.startsWith("https://"))return NextResponse.json({error:"Demo execution disabled"},{status:503});
 const session=readSession(request.cookies.get("mt5_session")?.value??"",key);
 if(!session)return NextResponse.json({error:"Sign in again"},{status:401});
 try{
 const {request_id,symbol,side,volume,sl,tp}=await request.json();
 const res=await fetch(new URL("/order",url),{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({request_id,symbol,side,volume,sl,tp,login:Number(session.login),server:session.server}),signal:AbortSignal.timeout(25000),cache:"no-store"});
 const data=await res.json();
 return NextResponse.json(res.ok?data:{error:typeof data.detail==="string"?data.detail:"Broker request rejected"},{status:res.status,headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Outcome unknown. Check broker history before retrying."},{status:502});}
}
