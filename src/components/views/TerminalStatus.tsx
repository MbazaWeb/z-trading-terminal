"use client";
import {useEffect,useState} from "react";
export function TerminalStatus({provider,accountType,marketStatus,onBot}:{provider:string|null;accountType:"real"|"demo"|null;marketStatus:string;onBot:()=>void}){
 const [bot,setBot]=useState<string|null>(null);
 const [expired,setExpired]=useState(false);
 useEffect(()=>{
 if(provider!=="metatrader")return;
 let active=true;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
 async function poll(){try{const r=await fetch("/api/account/mt5/bot",{cache:"no-store",signal:controller.signal});const d=await r.json();if(active){setExpired(r.status===401);setBot(r.ok&&typeof d.state==="string"?d.state:null);}}catch{if(active)setBot(null);}finally{if(active)timer=setTimeout(poll,10000);}}
 void poll();return()=>{active=false;controller.abort();clearTimeout(timer);};
 },[provider]);
 if(provider!=="metatrader")return <div className="border-b p-3 text-sm">{accountType ? `${accountType === "demo" ? "Demo" : "Real"} account selected · ` : ""}Trading controls are unavailable for this broker connection.</div>;
 return <header className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-3 text-sm"><strong>MT5 {accountType === "demo" ? "Demo" : accountType === "real" ? "Real" : "Account"}</strong><span className={marketStatus==="ready"?"text-emerald-500":"text-amber-500"}>Market feed: {marketStatus}</span><span>Order execution: disabled</span><button className="ml-auto rounded border px-3 py-1" onClick={onBot}>Bot: {bot??"Unknown"}</button>{expired&&<p role="alert" className="w-full text-amber-500">Session expired. Sign in again to control the bot. Background execution may continue.</p>}</header>;
}
