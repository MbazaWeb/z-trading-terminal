import {NextRequest,NextResponse} from "next/server";
import {readSession} from "@/lib/mt5Session";
async function proxy(request:NextRequest){
 const key=process.env.MT5_BRIDGE_KEY,url=process.env.MT5_BRIDGE_URL;
 if(!key||key.length<32||!url?.startsWith("https://"))return NextResponse.json({error:"Bridge unavailable"},{status:503});
 const session=readSession(request.cookies.get("mt5_session")?.value??"",key);
 if(!session)return NextResponse.json({error:"Sign in again"},{status:401});
 if(request.method==="POST"&&request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Invalid origin"},{status:403});
 try{
 const target=new URL("/bot",url);
 target.searchParams.set("login",String(session.login));target.searchParams.set("server",session.server);
 const body=request.method==="POST"?JSON.stringify({...await request.json(),login:Number(session.login),server:session.server}):undefined;
 const r=await fetch(target,{method:request.method,headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body,cache:"no-store",signal:AbortSignal.timeout(15000)});
 const d=await r.json();return NextResponse.json(r.ok?d:{error:typeof d.detail==="string"?d.detail:"Bot request rejected"},{status:r.status,headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Bot status unavailable; verify before retrying"},{status:503});}
}
export const GET=proxy;
export const POST=proxy;
