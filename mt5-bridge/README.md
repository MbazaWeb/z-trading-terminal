# MT5 read-only verification bridge

Run on a dedicated Windows PC or VPS with MetaTrader 5 installed and Python 64-bit.

PowerShell:
```
cd mt5-bridge
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:MT5_BRIDGE_KEY = "<random secret of at least 32 characters>"
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8765
```

Expose only through an authenticated HTTPS reverse proxy or private gateway. Never expose the raw port publicly. Use a dedicated terminal, one worker, and demo credentials only. The bridge verifies accounts and returns a snapshot; it does not maintain a session or execute orders. Do not log request bodies. Configure rate limiting at the gateway. No credentials belong in Git.

Next.js server configuration: MT5_BRIDGE_URL (HTTPS base URL), MT5_BRIDGE_KEY (same secret). The API route is a preliminary integration endpoint; the frontend is not wired yet.


## Background maintenance
Run the Windows bridge with exactly one Uvicorn worker (no reload in operation). The maintenance thread polls the allowlisted demo account every 30 seconds and persists position recommendations and deduplicated broker deals in MT5_ORDER_DB. History lookback is 30 days per poll; outages longer than that require manual backfill. Bot scheduling remains in the same process and starts stopped after restart. Use an OS service supervisor for process restart. No automatic protective modifications are enabled by this worker.
