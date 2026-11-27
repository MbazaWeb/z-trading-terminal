"use client";
import {useEffect,useState} from "react";
type Status={state:string;busy:boolean;heartbeat:number;workerAlive:boolean;events:{time:number;error?:string;message?:string;type?:string;result?:unknown}[]};
export function BotDashboard({symbols}:{symbols:{id:string}[]}){
 const [selected,setSelected]=useState<string[]>([]);
 const [status,setStatus]=useState<Status|null>(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 async function refresh(){try{const r=await fetch("/api/account/mt5/bot",{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error);setStatus(d);}catch{setStatus(null);}}
 useEffect(()=>{void refresh();const id=setInterval(refresh,5000);return()=>clearInterval(id);},[]);
 async function control(action:string){
 if(action==="start"&&!window.confirm("Start automated demo orders on selected markets?"))return;
 setBusy(true);setError("");
 try{const r=await fetch("/api/account/mt5/bot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,symbols:selected.length?selected:["unused"],strategy:"ensemble"})});const d=await r.json();if(!r.ok)throw Error(d.error);setStatus(d);}catch(e){setError(e instanceof Error?e.message:"Bot request failed");}finally{setBusy(false);}
 }
 return <section className="space-y-4 p-4"><h1 className="text-xl font-semibold">Automated demo bot</h1><p>State: {status?.state??"Unknown"} {status?.busy?"· Cycle in progress":""}</p><p className="text-sm">45-second interval after cycle completion. Stop and pause prevent new cycles and check cancellation between orders. An in-flight broker request may finish.</p><fieldset disabled={busy||status?.state==="running"} className="grid grid-cols-2 gap-2">{symbols.map(s=><label key={s.id}><input type="checkbox" checked={selected.includes(s.id)} disabled={selected.length>=10&&!selected.includes(s.id)} onChange={e=>setSelected(p=>e.target.checked?[...p,s.id]:p.filter(x=>x!==s.id))}/> {s.id}</label>)}</fieldset><div className="flex gap-2">{["start","pause","stop"].map(a=><button key={a} className="rounded border p-2 capitalize" disabled={busy||(a==="start"&&(!status||status.busy||status.state==="running"||!selected.length))} onClick={()=>void control(a)}>{a}</button>)}</div><p role="status">{error}</p><p>Worker: {status?status.workerAlive?"Alive":"Unavailable":"Unknown"} · Last heartbeat: {status?new Date(status.heartbeat*1000).toLocaleTimeString():"—"}</p><h2>Activity and notifications</h2>{status?.events.map((e,i)=><details key={i} className="rounded border p-2"><summary>{new Date(e.time*1000).toLocaleString()} · {e.error??e.message??"Cycle completed"}</summary><pre className="overflow-auto text-xs">{JSON.stringify(e.result,null,2)}</pre></details>)}</section>;
}
