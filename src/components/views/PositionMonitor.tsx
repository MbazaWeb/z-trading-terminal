"use client";
import {useEffect,useState} from "react";
type Position={ticket:string;symbol:string;profit:number;swap:number;sl:number;tp:number;action:string;reason:string;recommendedSl?:number};
type Snapshot={currency:string;floatingProfit:number;positions:Position[];checkedAt:number};
export function PositionMonitor(){
 const [data,setData]=useState<Snapshot|null>(null);
 const [error,setError]=useState("");
 useEffect(()=>{
 let active=true;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
 async function poll(){
 try{const r=await fetch("/api/account/mt5/position-monitor",{cache:"no-store",signal:controller.signal});const d=await r.json();if(!r.ok||d.source!=="MT5"||!Array.isArray(d.positions))throw Error(d.error||"Monitor unavailable");if(active){setData(d);setError("");}}
 catch(e){if(active){setData(null);setError(e instanceof Error?e.message:"Monitor unavailable");}}
 finally{if(active)timer=setTimeout(poll,15000);}
 }
 void poll();return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[]);
 return <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">Position management agent</h2><p className="text-sm text-muted-foreground">Read-only monitoring · refresh every 15 seconds after response</p><p role="status">{error||(!data?"Loading broker positions...":new Date(data.checkedAt).toLocaleString())}</p>{data&&<><p>Floating P/L: {data.floatingProfit.toFixed(2)} {data.currency}</p><div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Market","Ticket","P/L","SL","TP","Action","Suggested SL","Reason"].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{data.positions.map(p=><tr key={p.ticket} className="border-t">{[p.symbol,p.ticket,p.profit.toFixed(2),p.sl,p.tp,p.action,p.recommendedSl,p.reason].map((v,i)=><td key={i} className="p-2">{v??"—"}</td>)}</tr>)}</tbody></table></div>{!data.positions.length&&<p>No open positions.</p>}</>}</section>;
}
