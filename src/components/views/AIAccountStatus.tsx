"use client";
import { useEffect, useState } from "react";

type Status = { selectedMode: string; reason: string; paidInferenceAvailable: boolean; freeAllowanceVerified: boolean };
type Budget = { monthlyRecordedActualMicroUsd: string; monthlyReservedMicroUsd: string; monthlyUnresolvedRequests: string; monthlyLimitMicroUsd: number };
const usd = (value: string | number) => "$" + (Number(value) / 1000000).toFixed(4);

export function AIAccountStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const options = { cache: "no-store" as const, signal: controller.signal };
        const response = await fetch("/api/ai/status", options);
        if (!response.ok) throw new Error("Status unavailable");
        const next: Status = await response.json();
        if (controller.signal.aborted) return;
        setStatus(next);
        const ledger = await fetch("/api/ai/budget", options);
        if (controller.signal.aborted) return;
        setBudget(ledger.ok ? await ledger.json() : null);
      } catch {
        if (!controller.signal.aborted) { setStatus(null); setBudget(null); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);
  return (
    <section className="mb-4 rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">AI account policy</h2>
        <button type="button" className="rounded border border-[var(--panel-border)] px-3 py-1.5" disabled={loading} onClick={() => { setLoading(true); setStatus(null); setBudget(null); refresh(v => v + 1); }}>Refresh</button>
      </div>
      <p className="mt-2 text-muted-foreground">{loading ? "Checking account policy..." : status ? status.selectedMode.toUpperCase() + " — " + status.reason : "Account status unavailable"}</p>
      {status && <p className="mt-1 text-muted-foreground">Paid inference: {status.paidInferenceAvailable ? "Available" : "Disabled"} · Free allowance: {status.freeAllowanceVerified ? "Verified" : "Not verified"}</p>}
      {budget ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Recorded cost", usd(budget.monthlyRecordedActualMicroUsd)],
          ["Reserved", usd(budget.monthlyReservedMicroUsd)],
          ["Application cutoff", usd(budget.monthlyLimitMicroUsd)],
          ["Unresolved requests", budget.monthlyUnresolvedRequests]
        ].map(([label, value]) => <div key={label}><div className="text-muted-foreground">{label}</div><div className="mt-1 font-mono text-sm text-foreground">{value}</div></div>)}
      </div> : <p className="mt-2 text-muted-foreground">Budget ledger unavailable or restricted.</p>}
      <p className="mt-2 text-muted-foreground">Application-wide ledger, UTC month. Not an OpenAI invoice or free-credit balance.</p>
    </section>
  );
}
