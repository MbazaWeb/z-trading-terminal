"use client";
import {BacktestPanel} from "./BacktestPanel";
import {useState,useRef,useEffect} from "react";
const strategies=[["ensemble","Automatic ensemble"],["ma","Moving average crossover"],["bollinger","Double Bollinger Bands"],["rsi","RSI"],["macd","MACD"],["trend","Trend following"],["reversion","Mean reversion"],["breakout","Breakout"]];
type Signal={symbol:string;side:"BUY"|"SELL"|"HOLD";reason:string;score?:number;regime?:string;sl?:number;tp?:number;frames?:Record<string,{side:string}>};
const defaults={fast:10,slow:30,period:20,atr_multiplier:2,reward_risk:2};
export function StrategyDashboard({symbols}:{symbols:{id:string;name:string}[]}){
 const [selected,setSelected]=useState<string[]>([]);
 const [strategy,setStrategy]=useState("ensemble");
 const [config,setConfig]=useState(defaults);
 const [signals,setSignals]=useState<Signal[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [updated,setUpdated]=useState("");
 const lock=useRef(false);
 const abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 async function run(){
  if(lock.current||!selected.length)return;
  if(config.fast>=config.slow||Object.values(config).some(v=>!Number.isFinite(v))){setError("Check indicator parameters");return;}
  lock.current=true;setBusy(true);setError("");setSignals([]);setUpdated("");
  const controller=new AbortController();abort.current=controller;
  try{
   const res=await fetch("/api/account/mt5/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbols:selected,strategy,...config}),signal:controller.signal});
   const data=await res.json();
   if(!res.ok||data.source!=="MT5"||!Array.isArray(data.signals))throw Error(data.error||"Scan unavailable");
   setSignals(data.signals);setUpdated(new Date().toLocaleString());
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Scan failed");}
  finally{lock.current=false;setBusy(false);}
 }
 const field="rounded border bg-background p-2";
 return <section className="space-y-4 p-3"><header><h1 className="text-xl font-semibold">Strategy configuration</h1><p className="text-sm text-muted-foreground">MT5 demo · Analysis only · M15 + H1 confirmation</p></header>
 <fieldset disabled={busy} className="space-y-4 rounded-lg border p-4"><legend>Scanner settings</legend>
 <label className="block">Strategy <select className={field} value={strategy} onChange={e=>setStrategy(e.target.value)}>{strategies.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{(Object.keys(defaults) as (keyof typeof defaults)[]).map(k=><label key={k} className="text-sm">{({fast:"Fast MA",slow:"Slow MA",period:"Bollinger period",atr_multiplier:"ATR multiplier",reward_risk:"Reward/risk"})[k]}<input className={field+" w-full"} type="number" step={k==="atr_multiplier"||k==="reward_risk" ? 0.1 : 1} value={config[k]} onChange={e=>setConfig({...config,[k]:e.target.valueAsNumber})}/></label>)}</div>
 <h2>Market Watch ({selected.length}/10)</h2><div className="grid max-h-60 grid-cols-2 gap-2 overflow-auto lg:grid-cols-3">{symbols.map(s=><label key={s.id} className="rounded border p-2"><input type="checkbox" checked={selected.includes(s.id)} disabled={!selected.includes(s.id)&&selected.length>=10} onChange={e=>setSelected(prev=>e.target.checked?[...prev,s.id]:prev.filter(x=>x!==s.id))}/> {s.id}</label>)}</div>{!symbols.length&&<p>Waiting for MT5 market feed.</p>}
 <button className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={busy||!selected.length||selected.some(s=>!symbols.some(x=>x.id===s))} onClick={()=>void run()}>{busy?"Scanning...":"Scan markets"}</button><button className="ml-2 rounded border p-2" onClick={()=>setConfig(defaults)}>Reset parameters</button></fieldset>
 <p role="status">{error||updated&&"Last scan: "+updated}</p><h2 className="font-semibold">Scan results</h2><div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["Market","Signal","M15","H1","Score","Regime","SL","TP","Reason"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{signals.map(s=><tr className="border-t" key={s.symbol}>{[s.symbol,s.side,s.frames?.["15m"]?.side,s.frames?.["1H"]?.side,s.score,s.regime,s.side==="HOLD"?null:s.sl,s.side==="HOLD"?null:s.tp,s.reason].map((v,i)=><td key={i} className="p-2">{v??"—"}</td>)}</tr>)}</tbody></table></div>{!signals.length&&<p className="text-muted-foreground">No scan results yet.</p>}<BacktestPanel symbols={symbols}/></section>;
}
