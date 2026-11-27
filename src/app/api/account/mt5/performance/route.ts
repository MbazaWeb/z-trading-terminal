import {NextRequest,NextResponse} from "next/server";
import {readSession} from "@/lib/mt5Session";
export async function GET(request:NextRequest){
 const key=process.env.MT5_BRIDGE_KEY,url=process.env.MT5_BRIDGE_URL;
 if(!key||key.length<32||!url?.startsWith("https://"))return NextResponse.json({error:"Bridge unavailable"},{status:503});
 const session=readSession(request.cookies.get("mt5_session")?.value??"",key);
 if(!session)return NextResponse.json({error:"Sign in again"},{status:401});
 try{
 const target=new URL("/performance",url);target.searchParams.set("login",String(session.login));target.searchParams.set("server",session.server);
 const r=await fetch(target,{headers:{Authorization:"Bearer "+key},signal:AbortSignal.timeout(25000),cache:"no-store"});
 const d=await r.json();return NextResponse.json(r.ok?d:{error:typeof d.detail==="string"?d.detail:"Monitor unavailable"},{status:r.status,headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Monitor unavailable"},{status:503});}
}
