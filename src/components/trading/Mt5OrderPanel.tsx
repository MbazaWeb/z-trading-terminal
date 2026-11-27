"use client";
import {useState,useRef} from "react";
export function Mt5OrderPanel({symbol,ready}:{symbol:string;ready:boolean}){
 const [side,setSide]=useState<"buy"|"sell">("buy"),[sl,setSl]=useState(""),[tp,setTp]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false);
 const lock=useRef(false);
 async function submit(e:React.FormEvent){e.preventDefault();if(lock.current||blocked||!ready)return;
 if(!window.confirm("Submit a real broker order on your MT5 DEMO account?"))return;
 lock.current=true;setBusy(true);
 try{const res=await fetch("/api/account/mt5/order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({request_id:crypto.randomUUID(),symbol,side,volume:0.01,sl:Number(sl),tp:Number(tp)})});const data=await res.json();
 if(res.ok&&data.status==="confirmed"){setMessage("Broker confirmed deal "+data.deal);}
 else if(res.ok&&data.status==="rejected"){setMessage("Broker rejected order (code "+data.retcode+"). No execution confirmed.");}
 else{setMessage(data.error||"Outcome uncertain. Reconcile broker history.");if(res.status>=500||res.status===409||res.ok)setBlocked(true);}
 }catch{setMessage("Outcome unknown. Check MT5 history before retrying.");setBlocked(true);}finally{lock.current=false;setBusy(false);}}
 return <form onSubmit={submit} className="space-y-3 rounded-xl border border-[var(--panel-border)] bg-[#0d1117] p-3"><div className="flex justify-between border-b border-[var(--panel-border)] pb-2"><h2 className="text-xs font-bold uppercase tracking-wider">Trade</h2><span className="text-xs text-muted-foreground">MT5 / Market</span></div><div className="grid grid-cols-2 gap-2">{(["buy","sell"] as const).map(s=><button type="button" key={s} onClick={()=>setSide(s)} className={`rounded-lg py-3 font-bold uppercase ${side===s?(s==="buy"?"bg-[var(--bull)] text-[#0a0e17]":"bg-[var(--bear)] text-white"):"bg-[#141923] text-muted-foreground"}`}>{s}</button>)}</div><div className="flex justify-between rounded bg-[#0a0e17] p-2 text-xs"><span>Volume</span><span className="font-mono">0.01 lots · {symbol}</span></div><label className="block">Stop loss price<input className="mt-1 w-full rounded-lg border border-[var(--panel-border)] bg-[#11161f] p-3 font-mono" type="number" min="0" step="any" required value={sl} onChange={e=>setSl(e.target.value)}/></label><label className="block">Take profit price<input className="mt-1 w-full rounded-lg border border-[var(--panel-border)] bg-[#11161f] p-3 font-mono" type="number" min="0" step="any" required value={tp} onChange={e=>setTp(e.target.value)}/></label><button disabled={!ready||busy||blocked} className={`w-full rounded-lg py-3 font-bold uppercase text-white disabled:opacity-50 ${side==="buy"?"bg-[var(--bull)]":"bg-[var(--bear)]"}`}>{busy?"Submitting...":"Submit demo "+side.toUpperCase()}</button><p role="status">{message}</p></form>;
}
