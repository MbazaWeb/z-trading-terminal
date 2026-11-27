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
 else{setMessage(data.error||"Outcome uncertain. Reconcile broker history.");if(res.status>=500||res.status===409||res.ok)setBlocked(true);}
 }catch{setMessage("Outcome unknown. Check MT5 history before retrying.");setBlocked(true);}finally{lock.current=false;setBusy(false);}}
 return <form onSubmit={submit} className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">MT5 Demo Order</h2><p>{symbol} · 0.01 lots</p><select className="w-full rounded border bg-background p-2" value={side} onChange={e=>setSide(e.target.value==="buy"?"buy":"sell")}><option value="buy">BUY</option><option value="sell">SELL</option></select><label className="block">Stop loss price<input className="w-full rounded border bg-background p-2" type="number" min="0" step="any" required value={sl} onChange={e=>setSl(e.target.value)}/></label><label className="block">Take profit price<input className="w-full rounded border bg-background p-2" type="number" min="0" step="any" required value={tp} onChange={e=>setTp(e.target.value)}/></label><button disabled={!ready||busy||blocked} className="w-full rounded border p-2 disabled:opacity-50">{busy?"Submitting...":"Submit demo "+side.toUpperCase()}</button><p role="status">{message}</p></form>;
}
