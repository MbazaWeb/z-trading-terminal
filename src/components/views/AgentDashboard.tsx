"use client";
import {PerformancePanel} from "./PerformancePanel";
import {PositionMonitor} from "./PositionMonitor";
import {useState,useRef} from "react";
type Run={symbol:string;decision:string;stages:{agent:string;status:string;reason:string}[]};
export function AgentDashboard({symbols}:{symbols:{id:string}[]}){
 const [selected,setSelected]=useState<string[]>([]);
 const [runs,setRuns]=useState<Run[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const lock=useRef(false);
 async function run(){
 if(lock.current||!selected.length)return;
 lock.current=true;setBusy(true);setError("");setRuns([]);
 try{
 const res=await fetch("/api/account/mt5/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbols:selected,strategy:"ensemble"})});
 const data=await res.json();
 if(!res.ok||data.source!=="MT5"||!Array.isArray(data.agents))throw Error(data.error||"Agent scan unavailable");
 setRuns(data.agents);
 }catch(e){setError(e instanceof Error?e.message:"Agent scan failed");}finally{lock.current=false;setBusy(false);}
 }
 return <section className="space-y-4 p-4"><h1 className="text-2xl font-bold">Agents &amp; Strategies</h1><p className="text-sm text-muted-foreground">MT5 demo · Read-only decision pipeline</p><fieldset disabled={busy} className="grid max-h-60 grid-cols-2 gap-2 overflow-auto rounded border p-3 md:grid-cols-3">{symbols.map(s=><label key={s.id}><input type="checkbox" checked={selected.includes(s.id)} disabled={!selected.includes(s.id)&&selected.length>=10} onChange={e=>setSelected(p=>e.target.checked?[...p,s.id]:p.filter(x=>x!==s.id))}/> {s.id}</label>)}</fieldset><button className="w-full rounded-lg bg-[var(--bull)] px-4 py-3 font-bold text-[#0a0e17] disabled:opacity-50 sm:w-auto" disabled={busy||!selected.length} onClick={()=>void run()}>{busy?"Analyzing markets...":"Run agents"}</button><p role="status">{error}</p>{runs.map(r=><article key={r.symbol} className="rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-4"><h2 className="font-semibold">{r.symbol} · {r.decision}</h2>{r.stages.map(s=><div key={s.agent} className="grid gap-2 border-t border-[var(--panel-border)] py-3 text-sm sm:grid-cols-3"><span>{s.agent}</span><span className={s.status==="pass"?"text-green-500":s.status==="reject"?"text-red-500":"text-muted-foreground"}>{s.status}</span><span>{s.reason}</span></div>)}</article>)}<PositionMonitor/><PerformancePanel/></section>;
}
