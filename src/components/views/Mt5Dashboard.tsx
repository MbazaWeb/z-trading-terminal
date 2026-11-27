"use client";
import {useEffect,useState,useRef} from "react";
type Snapshot={loginid:string;server:string;currency:string;balance:number;equity:number;margin:number;freeMargin:number;profit:number;leverage:number;asOf:string;positions:{ticket:string;symbol:string;side:string;volume:number;open:number;current:number;profit:number;swap:number;sl:number;tp:number}[];deals:{ticket:string;symbol:string;time:number;entry:number;type:number;volume:number;profit:number;commission:number;swap:number;fee:number}[]};
export function Mt5Dashboard(){
 const [data,setData]=useState<Snapshot|null>(null);
 const [error,setError]=useState("");
 const [closing,setClosing]=useState<string|null>(null);
 const [notice,setNotice]=useState("");
 const closeLock=useRef(false);
 const [edit,setEdit]=useState<{ticket:string;sl:string;tp:string;oldSl:number;oldTp:number}|null>(null);
 const [modifyBlocked,setModifyBlocked]=useState<string[]>([]);
 async function modify(){
  if(!edit||closeLock.current||modifyBlocked.includes(edit.ticket))return;
  const sl=Number(edit.sl),tp=Number(edit.tp);
  if(!Number.isFinite(sl)||!Number.isFinite(tp)||sl<=0||tp<=0){setNotice("Enter valid positive prices");return;}
  if(!window.confirm("Update protective levels on demo position #"+edit.ticket+"?"))return;
  closeLock.current=true;setClosing(edit.ticket);
  try{
   const res=await fetch("/api/account/mt5/modify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket:edit.ticket,request_id:crypto.randomUUID(),sl,tp,expected_sl:edit.oldSl,expected_tp:edit.oldTp})});
   const result=await res.json();
   if(res.ok&&result.status==="confirmed"){setNotice("Broker confirmed SL/TP update");setEdit(null);}
   else if(res.ok&&result.status==="rejected"){setNotice("Broker rejected modification (code "+result.retcode+")");}
   else{setNotice(result.error||"Modification uncertain; verify MT5 position");if(res.ok||res.status>=500||res.status===409){setModifyBlocked(prev=>[...prev,edit.ticket]);setEdit(null);}}
  }catch{setNotice("Modification outcome unknown; verify MT5 position");setModifyBlocked(prev=>[...prev,edit.ticket]);setEdit(null);}
  finally{closeLock.current=false;setClosing(null);}
 }

 const [blocked,setBlocked]=useState<string[]>([]);
 async function close(ticket:string){
  if(closeLock.current||blocked.includes(ticket)||!window.confirm("Close the full MT5 demo position #"+ticket+"?"))return;
  closeLock.current=true;setClosing(ticket);
  try{
   const res=await fetch("/api/account/mt5/close",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket,request_id:crypto.randomUUID()})});
   const result=await res.json();
   if(res.ok&&result.status==="confirmed"){
    setNotice("Broker confirmed close deal "+result.deal);
    setBlocked(prev=>[...prev,ticket]);
   }else if(res.ok&&result.status==="rejected"){
    setNotice("Broker rejected close (code "+result.retcode+")");
   }else{
    setNotice(result.error||"Close uncertain; check broker history");
    if(res.ok||res.status>=500||res.status===409)setBlocked(prev=>[...prev,ticket]);
   }
  }catch{setNotice("Close outcome unknown; check broker history");setBlocked(prev=>[...prev,ticket]);}
  finally{closeLock.current=false;setClosing(null);}
 }

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
 
 const money=(n:number)=>n.toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2})+" "+(data?.currency??"");
 const [period,setPeriod]=useState("Today");
 const [report,setReport]=useState<{positions:{closedAt:number;net:number}[]}|null>(null);
 useEffect(()=>{let active=true;async function load(){try{const r=await fetch("/api/account/mt5/performance",{cache:"no-store"});const v=await r.json();if(active)setReport(r.ok&&Array.isArray(v.positions)?v:null);}catch{if(active)setReport(null);}}void load();const timer=setInterval(load,15000);return()=>{active=false;clearInterval(timer)}},[]);
 const rows=report?.positions.filter(x=>{const t=x.closedAt<1e12?x.closedAt*1000:x.closedAt;const now=new Date();return period==="Today"?t>=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime():t>=Date.now()-(period==="7D"?7:30)*86400000;});
 const wins=rows?.filter(x=>x.net>0),losses=rows?.filter(x=>x.net<0);const rate=rows?.length?Math.round((wins?.length??0)/rows.length*100):null;
 const metrics=[["Total closed",rows?.length],["Win trades",wins?.length],["Lose trades",losses?.length],["Amount win",wins?money(wins.reduce((a,x)=>a+x.net,0)):null],["Amount loss",losses?money(losses.reduce((a,x)=>a+x.net,0)):null],["Net P&L",rows?money(rows.reduce((a,x)=>a+x.net,0)):null]];
 const overview=<><h1 className="text-xl font-semibold">Dashboard</h1><p className="text-muted-foreground">Trading performance overview.</p><div className="flex flex-wrap gap-2 rounded-md border border-[var(--panel-border)] bg-[#0d1117] p-2">{["Today","7D","30D"].map(x=><button key={x} onClick={()=>setPeriod(x)} className={`rounded-lg px-4 py-2 font-semibold ${period===x?"bg-[#1c2230]":"text-muted-foreground"}`}>{x}</button>)}</div><div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{metrics.map(([label,value],i)=><div key={label} className="min-w-0 rounded-md border border-[var(--panel-border)] bg-[#0d1117] p-4"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className={`mt-3 break-words font-mono text-xl font-semibold ${i===1||i===3?"text-[var(--bull)]":i===2||i===4?"text-[var(--bear)]":""}`}>{value??"—"}</div></div>)}</div><div className="rounded-md border border-[var(--panel-border)] bg-[#0d1117] p-5"><h2 className="font-bold tracking-wide">WIN / LOSS</h2><div className="mx-auto my-5 flex size-40 items-center justify-center rounded-full" style={{background:`conic-gradient(var(--bull) ${rate??0}%, #1c2230 0)`}}><div className="flex size-32 flex-col items-center justify-center rounded-full bg-[#0d1117]"><span className="text-muted-foreground">Win rate</span><strong className="font-mono text-3xl text-[var(--bull)]">{rate===null?"—":rate+"%"}</strong></div></div></div></>;
 if(!data)return <section className="space-y-3 p-3">{overview}<p>{error||"Loading verified MT5 account..."}</p></section>;
 return <section className="space-y-4 p-3">{overview}<h2 className="font-semibold uppercase tracking-wide">Account overview</h2><p className="text-sm text-muted-foreground">Demo · {data.loginid} · {data.server} · Updated {new Date(data.asOf).toLocaleString()}</p>
 <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{[["Balance",data.balance],["Equity",data.equity],["Used margin",data.margin],["Free margin",data.freeMargin],["Floating P/L",data.profit]].map(([label,value])=><div key={label} className="rounded-md border border-[var(--panel-border)] bg-[#0d1117] p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-xl font-semibold">{money(Number(value))}</div></div>)}<div className="rounded-md border border-[var(--panel-border)] bg-[#0d1117] p-4">Leverage<div className="text-xl">1:{data.leverage}</div></div></div>
 <h2 className="font-semibold">Open positions ({data.positions.length})</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Symbol","Side","Lots","Entry","Current","Profit","Swap","SL","TP","Action"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{data.positions.map(p=><tr key={p.ticket} className="border-t">{[p.symbol,p.side,p.volume,p.open,p.current,money(p.profit),money(p.swap),p.sl||"Not set",p.tp||"Not set"].map((x,i)=><td className="p-2" key={i}>{x}</td>)}<td><button disabled={closing!==null||blocked.includes(p.ticket)} onClick={()=>void close(p.ticket)} className="rounded border p-2 disabled:opacity-50">{closing===p.ticket?"Closing...":blocked.includes(p.ticket)?"Check history":"Close"}</button><button className="ml-2 rounded border p-2" disabled={closing!==null||blocked.includes(p.ticket)||modifyBlocked.includes(p.ticket)} onClick={()=>setEdit({ticket:p.ticket,sl:String(p.sl),tp:String(p.tp),oldSl:p.sl,oldTp:p.tp})}>Edit SL/TP</button></td></tr>)}</tbody></table>{edit&&<div className="space-y-2 rounded border p-3"><h3>Edit protective prices #{edit.ticket}</h3><label className="block">Stop loss<input type="number" step="any" className="ml-2 rounded border bg-background p-2" value={edit.sl} onChange={e=>setEdit({...edit,sl:e.target.value})}/></label><label className="block">Take profit<input type="number" step="any" className="ml-2 rounded border bg-background p-2" value={edit.tp} onChange={e=>setEdit({...edit,tp:e.target.value})}/></label><button disabled={closing!==null} className="rounded border p-2" onClick={()=>void modify()}>Save SL/TP</button><button disabled={closing!==null} className="ml-2 p-2" onClick={()=>setEdit(null)}>Cancel</button></div>}<p role="status">{notice}</p>{!data.positions.length&&<p>No open positions.</p>}</div>
 <h2 className="font-semibold">Broker deal history — last 30 days</h2><p className="text-xs text-muted-foreground">Individual execution deals, not grouped closed trades.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Time","Symbol","Lots","Net P/L"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{data.deals.slice().reverse().map(d=><tr key={d.ticket} className="border-t"><td className="p-2">{new Date(d.time*1000).toLocaleString()}</td><td>{d.symbol}</td><td>{d.volume}</td><td>{money(d.profit+d.commission+d.swap+d.fee)}</td></tr>)}</tbody></table>{!data.deals.length&&<p>No execution deals returned.</p>}</div></section>;
}
