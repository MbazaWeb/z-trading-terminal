"use client";
import { useEffect, useState } from "react";

type Controls = { running: boolean; emergencyStop: boolean; enabledAgentIds: string[]; revision: string };
const ids = ["momentum","reverter","sentiment","breakout","arbitrage","signal","strategy","chart","multiIndicator","time","media","risk","stopLoss","stopWin","pip","alert"];
const required = ["risk","stopLoss","stopWin"];

export function ServerAgentControls() {
  const [controls, setControls] = useState<Controls | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/ai/control", { cache: "no-store", signal: abort.signal })
      .then(async r => { if (!r.ok) throw new Error(); const value = await r.json(); if (!abort.signal.aborted) setControls(value); })
      .catch(() => { if (!abort.signal.aborted) setMessage("Server controls unavailable or restricted."); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, []);
  async function update(next?: Controls) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(next ? "/api/ai/control" : "/api/ai/emergency-stop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: next ? JSON.stringify(next) : undefined
      });
      if (!r.ok) throw new Error();
      const current = await fetch("/api/ai/control", { cache: "no-store" });
      if (!current.ok) throw new Error();
      const value: Controls = await current.json();
      setControls(value);
      setMessage("Server configuration refreshed.");
    } catch {
      setControls(null);
      setMessage("Change not confirmed. Reload before making another change.");
    } finally { setBusy(false); }
  }
  return <section className="mb-4 rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-3 text-xs">
    <h2 className="text-sm font-semibold">Server strategy controller</h2>
    <p className="mt-1 text-muted-foreground">Local analysis configuration. Not a worker heartbeat or global trading stop.</p>
    <p className="mt-2">{controls ? controls.emergencyStop ? "Controller stop active" : controls.running ? "Configured to run" : "Stopped" : "Status unavailable"}</p>
    {controls && <><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ids.map(id => <label key={id} className="flex items-center gap-2">
        <input type="checkbox" checked={controls.enabledAgentIds.includes(id)} disabled={busy || controls.running} onChange={e => void update({...controls, enabledAgentIds: e.target.checked ? [...controls.enabledAgentIds,id] : controls.enabledAgentIds.filter(x=>x!==id)})}/>
        {id}
      </label>)}
    </div><div className="mt-3 flex flex-wrap gap-2">
      <button className="rounded border px-3 py-2" disabled={busy || controls.running || !required.every(id=>controls.enabledAgentIds.includes(id))} onClick={()=>void update({...controls,running:true,emergencyStop:false})}>Enable controller</button>
      <button className="rounded border px-3 py-2" disabled={busy || !controls.running} onClick={()=>void update({...controls,running:false})}>Stop controller</button>
    </div></>}
    <button className="mt-3 rounded border border-red-500 px-3 py-2 text-red-400" disabled={busy} onClick={()=>void update()}>Emergency stop controller</button>
    {message && <p role="status" className="mt-2 text-muted-foreground">{message}</p>}
  </section>;
}
