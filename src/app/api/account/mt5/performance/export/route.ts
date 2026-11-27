import {NextRequest,NextResponse} from "next/server";
import {readSession} from "@/lib/mt5Session";
export async function GET(request:NextRequest){
 const key=process.env.MT5_BRIDGE_KEY,url=process.env.MT5_BRIDGE_URL;
 if(!key||key.length<32||!url?.startsWith("https://"))return NextResponse.json({error:"Bridge unavailable"},{status:503});
 const session=readSession(request.cookies.get("mt5_session")?.value??"",key);
 if(!session)return NextResponse.json({error:"Sign in again"},{status:401});
 try{
 const target=new URL("/performance/export",url);target.searchParams.set("login",String(session.login));target.searchParams.set("server",session.server);
 const fmt=request.nextUrl.searchParams.get("fmt");if(fmt!=="pdf"&&fmt!=="xlsx")return NextResponse.json({error:"Invalid format"},{status:400});target.searchParams.set("fmt",fmt);
 const r=await fetch(target,{headers:{Authorization:"Bearer "+key},signal:AbortSignal.timeout(25000),cache:"no-store"});
 if(!r.ok)return NextResponse.json({error:"Report export failed"},{status:r.status});return new NextResponse(await r.arrayBuffer(),{headers:{"Content-Type":r.headers.get("content-type")??"application/octet-stream","Content-Disposition":`attachment; filename="mt5-report.${fmt}"`,"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Monitor unavailable"},{status:503});}
}
