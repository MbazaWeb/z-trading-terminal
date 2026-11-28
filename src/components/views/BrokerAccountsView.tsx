"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Link2, Unlink } from "lucide-react";

interface BrokerAccount {
  id: string;
  broker: "mt5" | "deriv";
  account_number: string;
  server: string | null;
  currency: string | null;
  balance: number | null;
  equity: number | null;
  account_type: "demo" | "real";
  connection_status: "connected" | "disconnected" | "error";
}

export function BrokerAccountsView() {
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/broker-accounts", { cache: "no-store" });
    const data = await response.json();
    setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    setLoading(false);
  }

  useEffect(() => void load(), []);

  async function action(accountId: string, action: "select" | "disconnect" | "reconnect") {
    await fetch("/api/broker-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, action }),
    });
    await load();
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Broker Accounts</h1>
          <p className="text-xs text-muted-foreground">Real broker data; demo execution only.</p>
        </div>
        <Button variant="outline" asChild>
          <a href="/api/auth/deriv/start">Connect Deriv</a>
        </Button>
      </div>
      {loading ? (
        <Loader2 className="size-5 animate-spin" />
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-[var(--panel-border)] p-6 text-sm text-muted-foreground">
          No broker accounts connected.
        </div>
      ) : (
        <div className="grid gap-3">
          {accounts.map((account) => (
            <div key={account.id} className="grid gap-3 rounded-lg border border-[var(--panel-border)] p-4 md:grid-cols-[1fr_1fr_auto]">
              <div>
                <div className="font-semibold uppercase">{account.broker}</div>
                <div className="text-xs text-muted-foreground">Account {account.account_number}</div>
                <div className="text-xs text-muted-foreground">{account.server ?? "Server not set"}</div>
              </div>
              <div className="text-xs">
                <div>{account.currency ?? "—"} · {account.account_type}</div>
                <div>Balance: {account.balance ?? "—"}</div>
                <div>Equity: {account.equity ?? "—"}</div>
                <div>Status: {account.connection_status}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => action(account.id, "select")}><Link2 className="size-3" />Select</Button>
                {account.connection_status === "connected" ? (
                  <Button size="sm" variant="outline" onClick={() => action(account.id, "disconnect")}><Unlink className="size-3" />Disconnect</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => action(account.id, "reconnect")}>Reconnect</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
