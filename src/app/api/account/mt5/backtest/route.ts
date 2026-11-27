import {NextRequest,NextResponse} from "next/server";
import {readSession} from "@/lib/mt5Session";
export async function POST(request:NextRequest){
 if(request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Invalid origin"},{status:403});
 const key=process.env.MT5_BRIDGE_KEY,url=process.env.MT5_BRIDGE_URL;
 if(!key||key.length<32||!url?.startsWith("https://"))return NextResponse.json({error:"Bridge unavailable"},{status:503});
 const session=readSession(request.cookies.get("mt5_session")?.value??"",key);
 if(!session)return NextResponse.json({error:"Sign in again"},{status:401});
 try{
 const {symbol,bars,cost,strategies}=await request.json();
 if(typeof symbol!=="string"||!symbol||symbol.length>128||!Number.isInteger(bars)||bars<400||bars>5000||typeof cost!=="number"||!Number.isFinite(cost)||cost<0||!Array.isArray(strategies)||strategies.length<1||strategies.length>8)return NextResponse.json({error:"Invalid backtest settings"},{status:400});
 const res=await fetch(new URL("/backtest",url),{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({symbol,bars,cost,strategies,login:Number(session.login),server:session.server}),signal:AbortSignal.timeout(60000),cache:"no-store"});
 const data=await res.json();
 return NextResponse.json(res.ok?data:{error:typeof data.detail==="string"?data.detail:"Backtest failed"},{status:res.status,headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Backtest unavailable"},{status:503});}
}
