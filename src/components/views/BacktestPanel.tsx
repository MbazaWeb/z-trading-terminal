"use client";
import {useState} from "react";
type Metrics={trades:number;winRate:number|null;net:number;maxClosedDrawdown:number;profitFactor:number|null};
type Result={strategy:string;inSample:Metrics;outOfSample:Metrics};
export function BacktestPanel({symbols}:{symbols:{id:string}[]}){
 const [symbol,setSymbol]=useState("");
 const [bars,setBars]=useState(1500);
 const [cost,setCost]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [results,setResults]=useState<Result[]>([]);
 async function run(){
 if(busy||!symbol||!cost.trim()||!Number.isFinite(Number(cost))||Number(cost)<0)return;
 setBusy(true);setError("");setResults([]);
 try{
 const r=await fetch("/api/account/mt5/backtest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol,bars,cost:Number(cost),strategies:["ensemble","ma","bollinger","rsi","macd","trend","reversion","breakout"]})});
 const d=await r.json();if(!r.ok||d.source!=="MT5"||!Array.isArray(d.results))throw Error(d.error||"Backtest failed");setResults(d.results);
 }catch(e){setError(e instanceof Error?e.message:"Backtest unavailable");}finally{setBusy(false);}
 }
 return <section className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">Historical strategy comparison</h2><p className="text-sm text-muted-foreground">M15 · 70/30 chronological split · default parameters · results in price units, not account currency.</p><fieldset disabled={busy} className="flex flex-wrap gap-3"><label>Market <select className="rounded border bg-background p-2" value={symbol} onChange={e=>setSymbol(e.target.value)}><option value="">Select market</option>{symbols.map(s=><option key={s.id}>{s.id}</option>)}</select></label><label>Bars <input className="w-24 rounded border bg-background p-2" type="number" min={400} max={5000} value={bars} onChange={e=>setBars(e.target.valueAsNumber)}/></label><label>Round-trip cost (price units) <input className="w-28 rounded border bg-background p-2" type="number" min={0} step="any" value={cost} onChange={e=>setCost(e.target.value)}/></label><button disabled={!symbol||!cost.trim()||busy} className="rounded border p-2" onClick={()=>void run()}>{busy?"Running...":"Compare strategies"}</button></fieldset><p role="status">{error}</p><div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Strategy","Sample","Trades","Win %","Net","Closed drawdown","Profit factor"].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{results.flatMap(r=>(["inSample","outOfSample"] as const).map(k=><tr key={r.strategy+k} className="border-t">{[r.strategy,k,r[k].trades,r[k].winRate?.toFixed(1),r[k].net.toFixed(5),r[k].maxClosedDrawdown.toFixed(5),r[k].profitFactor?.toFixed(2)].map((v,i)=><td key={i} className="p-2">{v??"—"}</td>)}</tr>))}</tbody></table></div></section>;
}
