# MT5 demo execution bridge

Requires a dedicated Windows PC or VPS, 64-bit Python 3.12, and MetaTrader 5 logged into the exact demo account. Run from an interactive Windows session with access to that terminal.

Set the following process environment variables securely:
- MT5_BRIDGE_KEY: random secret of at least 32 characters.
- MT5_EXECUTION_LOGIN: exact demo account number.
- MT5_EXECUTION_SERVER: exact broker server name.
- MT5_ORDER_DB: optional absolute persistent SQLite database path.
- MT5_STOP_FILE: optional absolute emergency-stop file path.

Run PowerShell from this directory:

```powershell
.\start-demo.ps1
```

The launcher installs dependencies, verifies the connected demo account, forces both execution flags off, and binds the bridge to loopback port 8765 with one worker. It does not submit trades.

Expose only through an authenticated HTTPS reverse proxy or private gateway. Never expose the raw port publicly. Do not log request bodies or authorization headers. Configure rate limiting. No credentials belong in Git.

Next.js server-only preview configuration: MT5_BRIDGE_URL (HTTPS base URL), MT5_BRIDGE_KEY (same secret). Never prefix these with NEXT_PUBLIC_.

After read-only connectivity and regression checks pass, a separate supervised launch may enable MT5_DEMO_EXECUTION=true for manual demo execution and MT5_AGENT_EXECUTION=true for agent execution. Both require the exact allowlisted demo account; the bot starts stopped. Do not use a real account.

## Background maintenance
Use exactly one Uvicorn worker, without reload. The maintenance thread polls the allowlisted demo account every 30 seconds and persists position recommendations and deduplicated broker deals in MT5_ORDER_DB. History lookback is 30 days per poll; longer outages require manual backfill. Bot scheduling remains in the same process and starts stopped after restart. Use an OS supervisor that can access the logged-in terminal. No automatic protective modifications are enabled by this worker.
