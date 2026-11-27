"use client";
import {useEffect,useState} from "react";
type Snapshot={loginid:string;server:string;currency:string;balance:number;equity:number;margin:number;freeMargin:number;profit:number;leverage:number;asOf:string;positions:{ticket:string;symbol:string;side:string;volume:number;open:number;current:number;profit:number;swap:number}[];deals:{ticket:string;symbol:string;time:number;entry:number;type:number;volume:number;profit:number;commission:number;swap:number;fee:number}[]};
export function Mt5Dashboard(){
 const [data,setData]=useState<Snapshot|null>(null);
 const [error,setError]=useState("");
 useEffect(()=>{
  let stopped=false;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  async function poll(){try{
   const res=await fetch("/api/account/mt5",{cache:"no-store",signal:controller.signal});
   const value=await res.json();if(!res.ok)throw Error(value.error||"Account unavailable");
   if(!stopped){setData(value);setError("");}
  }catch(e){if(!stopped){setData(null);setError(e instanceof Error?e.message:"Account unavailable");}}
  finally{if(!stopped)timer=setTimeout(poll,5000);}}
  void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[]);
 if(!data)return <div className="p-6">{error||"Loading verified MT5 account..."}</div>;
 const money=(n:number)=>n.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2})+" "+data.currency;
 return <section className="space-y-5 p-4"><h1 className="text-xl font-semibold">MT5 Account Dashboard</h1><p className="text-sm text-muted-foreground">Demo · {data.loginid} · {data.server} · Updated {new Date(data.asOf).toLocaleString()}</p>
 <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{[["Balance",data.balance],["Equity",data.equity],["Used margin",data.margin],["Free margin",data.freeMargin],["Floating P/L",data.profit]].map(([label,value])=><div key={label} className="rounded-lg border p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-xl font-semibold">{money(Number(value))}</div></div>)}<div className="rounded-lg border p-4">Leverage<div className="text-xl">1:{data.leverage}</div></div></div>
 <h2 className="font-semibold">Open positions ({data.positions.length})</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Symbol","Side","Lots","Entry","Current","Profit","Swap"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{data.positions.map(p=><tr key={p.ticket} className="border-t">{[p.symbol,p.side,p.volume,p.open,p.current,money(p.profit),money(p.swap)].map((x,i)=><td className="p-2" key={i}>{x}</td>)}</tr>)}</tbody></table>{!data.positions.length&&<p>No open positions.</p>}</div>
 <h2 className="font-semibold">Broker deal history — last 30 days</h2><p className="text-xs text-muted-foreground">Individual execution deals, not grouped closed trades.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Time","Symbol","Lots","Net P/L"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{data.deals.slice().reverse().map(d=><tr key={d.ticket} className="border-t"><td className="p-2">{new Date(d.time*1000).toLocaleString()}</td><td>{d.symbol}</td><td>{d.volume}</td><td>{money(d.profit+d.commission+d.swap+d.fee)}</td></tr>)}</tbody></table>{!data.deals.length&&<p>No execution deals returned.</p>}</div></section>;
}
