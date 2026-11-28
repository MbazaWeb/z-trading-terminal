# Z Trading Terminal

A professional Bloomberg/Binance-style market trading terminal built with Next.js 16, TypeScript, and Tailwind CSS. Features an interactive candlestick chart, self-improving AI trading agents, an autonomous trading bot with risk management, broker-confirmed execution via MetaApi.cloud, and downloadable reports.

## Features

- **Login** — Authenticate via Deriv (OAuth2 with PKCE, server-side token exchange) or MetaTrader (account credentials + server-side session). Choose Real, Demo, or Paper mode.
- **Guest browsing** — The Trading view (live charts, ticker tape, order book, recent trades) is accessible without login. Sign in to place trades.
- **Trading modes** — Paper (local simulation, no broker), Demo (broker demo account, $10,000 virtual balance), Real (broker real account, disabled by default — requires `REAL_TRADING_ENABLED=true`).
- **Broker-confirmed execution** — Orders go through `/api/mt5/trade`, which runs server-side risk controls (position size, daily loss, volume bounds, free margin) before submitting to MetaApi. The trade is only recorded locally once the broker confirms (with the broker order id). Paper mode records locally with `source: "paper"` and `brokerOrderId: null`.
- **Idempotent orders** — Every broker order includes a `clientOrderId` (UUID generated on the client). The server checks Supabase for an existing row with that id and returns it instead of placing a duplicate.
- **Trading** — Interactive candlestick chart with multiple timeframes (1m to 1W), order book, buy/sell panel, and live ticker tape.
- **Dashboard** — Today's trading stats, win/loss rates, cumulative P&L chart, and searchable trade logs.
- **Agents & Strategies** — 5 self-improving AI trading agents that adjust parameters after losses (visible "Learning" badges + improvement logs). Each agent has a versioned strategy (e.g. `momentum-v1.2`) and a live performance rollup (win rate, profit factor, max drawdown, Sharpe ratio). A built-in backtest engine replays any agent over ~500 historical Binance candles so strategy changes can be validated before going live.
- **Bot** — Autonomous trading bot driven by a serverless cron worker (`/api/cron/bot`). The browser only displays data fetched from `/api/mt5/positions`, `/api/bot/logs`, and `/api/bot/config`; all order placement, SL/TP monitoring, and reconciliation run server-side. Equity-based position sizing (uses the real account balance, not a hardcoded fallback), risk management, and broker reconciliation on every cycle.
- **Reports** — Download daily/weekly PDF reports and trade history/agent performance CSV exports. Trade log uses broker-reported open/close timestamps (when available) to compute actual hold duration; falls back to "Estimated" labels for paper trades.

## Cron Bot Architecture (ZT-12)

The bot is driven by a serverless cron endpoint at `/api/cron/bot` (configured in `vercel.json`). The browser no longer places orders or monitors positions — every cycle runs server-side:

1. **Authentication** — Vercel Cron sends `CRON_SECRET` in the `Authorization: Bearer <secret>` header. The endpoint refuses to run when the secret doesn't match (401). For ad-hoc invocations pass `?secret=<CRON_SECRET>`.
2. **Iteration** — `listRunningBots()` queries Supabase for every `bot_config` row with `running = true` and runs the cycle for each user.
3. **Per-user cycle:**
   - `reconcilePositions(userId)` — compares local open trades with the broker's live positions. Closes local-only trades (the broker already closed them, e.g. via SL/TP hit on the broker side without our `/api/mt5/close` being called). Logs a warning for broker-only positions (orphaned — needs manual intervention).
   - Fetch Binance candles for the user's `active_symbol` and run all 5 agents.
   - `evaluateConsensus(signals)` — if consensus passes (>= 70% confidence):
     - Risk controls: position size, daily loss, concurrent positions.
     - `REAL_TRADING_ENABLED` gate: the cron worker NEVER places broker orders unless the operator has explicitly opted in. This is stricter than `/api/mt5/trade` (which allows demo orders) because the cron runs autonomously.
     - Place the order via the MetaApi SDK; record the trade row with `broker_open_time` (ZT-14).
     - Append `SIGNAL`, `RISK-CHECK`, and `ORDER` log rows to `bot_logs`.
   - Check open positions for SL/TP crossings using the live Binance price; close via MetaApi (or mark closed locally when MetaApi isn't configured).
4. **Return summary** — `{ status, usersProcessed, totalOrdersPlaced, totalPositionsClosed, users: [...] }`.

**Schedule** — `vercel.json` ships with `0 * * * *` (hourly) which is the minimum cadence on Vercel Hobby. Bump it to `* * * * *` (every minute) on a Vercel Pro plan for tighter TP/SL response. The endpoint is idempotent so concurrent invocations are safe.

### Broker reconnection + reconciliation (ZT-12)

`src/lib/metaApiServer.ts` caches the MetaApi RPC connection for 5 minutes (`CONNECTION_TTL_MS`) so consecutive `/api/mt5/*` requests and cron cycles reuse the same websocket. On cache hit the connection is verified with `getAccountInformation()`; a stale connection is dropped and rebuilt. `releaseRpcConnection(conn)` is a no-op on cached connections (so route handlers' `finally` blocks don't tear down the cache).

`src/lib/reconciliation.ts` runs at the start of every cron cycle:
- `matched` — trade row exists locally and on the broker. Nothing to do.
- `localOnly` — trade row has a `broker_order_id` but the broker no longer reports the position. The broker already closed it (e.g. SL hit). The local trade is marked closed with the last known price.
- `brokerOnly` — the broker has a position we don't have a trade row for (orphaned — opened manually on the MT5 terminal or pre-Supabase). Logged to `bot_logs` with a `RISK-CHECK` tag so the operator can intervene; we never auto-close someone else's position.

## Strategy Versioning + Backtesting (ZT-13)

Each agent has a `strategyVersion` label (e.g. `momentum-v1.2`) defined in `src/lib/agents/registry.ts`. The registry is server-safe (no React dependency) so the cron worker and the backtest engine can both look up an agent's analyzer by id.

`src/lib/agents/performance.ts` — pure functions that compute `AgentPerformance` (win rate, profit factor, max drawdown, Sharpe ratio, avg hold time) from a list of closed trades attributed to one agent. Used by the AgentsView live panel and the backtest rollup.

`src/lib/agents/backtest.ts` — replays an agent's analyzer over a sliding window of ~500 historical Binance candles. Simulates a single long/short position per agent (BUY opens a long; SELL closes it; vice versa for shorts; HOLD is a no-op). Returns the trade list, equity curve, and the performance rollup. The backtest is deterministic and side-effect free — it never places real orders.

The AgentsView's "Backtest" button hits `/api/agents/backtest?agentId=...&symbol=BTCUSDT&interval=15m` and renders the equity curve + metrics in a modal.

## Broker Timestamps (ZT-14)

Trade rows include three new columns:

- `broker_open_time timestamptz` — set when `/api/mt5/trade` returns the broker's `response.openTime`.
- `broker_close_time timestamptz` — set when `/api/mt5/close` returns the broker's `response.closeTime`.
- `hold_time_ms bigint` — `broker_close_time - broker_open_time`, computed server-side and cached on the row so reports don't recompute it.

ReportsView renders "Open Time", "Close Time", and "Hold Duration" columns. Trades without broker timestamps (paper trades) show "est" (estimated) labels and the hold duration is computed from the local `datetime` field as a fallback. The CSV export includes all three columns.

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS 4
- Zustand (state management)
- lucide-react (icons)
- shadcn/ui (component library)
- MetaApi.cloud SDK (MT5 broker integration)
- Supabase (trade persistence, service-role writes)
- Binance public REST API (market data)
- Vercel Cron (serverless bot worker)

## Getting Started

```bash
bun install
bun run dev
```

Open http://localhost:3000

## Security Architecture

### Server-side session (HttpOnly cookie)

The Deriv OAuth access token is NEVER exposed to the client. The flow:

1. User clicks "Continue with Deriv" -> redirects to Deriv OAuth.
2. Deriv redirects back to `/api/auth/deriv/callback` with an authorization code.
3. The callback route exchanges the code for an access token **server-side**, stores it in a signed HttpOnly cookie (`zt_session`), and redirects to the app.
4. The client calls `/api/auth/me` to get a redacted view of the session (provider, accountType, loginid, tradingMode) — no access token.
5. When the client needs the balance, it calls `/api/deriv/balance`, which reads the token from the session and calls the Deriv WebSocket API from the server.

The session cookie is HMAC-SHA256 signed with `SESSION_SECRET` (set in production). Tampering with the cookie invalidates the signature.

### MT5 route guards

All four MT5 routes (`/api/mt5/{trade,connect,balance,positions}`) require an authenticated session via `requireAuth()`:

- `POST /api/mt5/trade` — `requireAuth()` + `REAL_TRADING_ENABLED` gate + server-side risk controls + idempotency check + Supabase persistence with `user_id` from session.
- `POST /api/mt5/connect` — `requireAdmin()` (owner-only, via `ZT_OWNER_USER_ID`).
- `GET /api/mt5/balance` — `requireAuth()`.
- `GET /api/mt5/positions` — `requireAuth()`.

### Real trading gate

`REAL_TRADING_ENABLED` defaults to `false`. When false, the trade endpoint rejects real-account orders with HTTP 403 and the message "Real trading is disabled. Set REAL_TRADING_ENABLED=true to enable." Demo and paper trades are always allowed.

### Server-side risk controls

Before submitting an order to MetaApi, `/api/mt5/trade` runs:

1. Fetch the real account balance + equity from MetaApi.
2. Position size: `balance * riskPerTrade / 100` must not exceed `maxPositionSize`.
3. Daily loss: today's closed-trade loss must be below `maxDailyLoss`.
4. Volume bounds: the requested volume must be within the broker's min/max for the symbol.
5. Free margin: the order notional must not exceed free margin.

If any check fails, the endpoint returns HTTP 400 with a clear reason (e.g., "Position size $500 exceeds max $300"). The order is NOT submitted to the broker.

### Supabase persistence

Trades are written via the service-role Supabase client (`supabaseAdmin` in `src/lib/supabaseServer.ts`) from server-side routes. The `user_id` is taken from the session (never trusted from the client). The schema includes a unique index on `client_order_id` for idempotency. Failed inserts are surfaced to the user with a toast and the trade is marked `persisted: false` for retry via `syncPendingTrades()`.

## Environment Variables

See `.env.example` for the full list. Key variables:

- `SESSION_SECRET` — Signs the HttpOnly session cookie. **Set in production.**
- `REAL_TRADING_ENABLED` — `false` (default) or `true`. Gates real-account orders in `/api/mt5/trade` AND gates the cron worker's broker orders entirely.
- `CRON_SECRET` — Authenticates `/api/cron/bot`. **Required for the bot to run.** Generate with `openssl rand -hex 32`.
- `BOT_DEFAULT_SYMBOL` / `BOT_DEFAULT_MAX_POSITION_SIZE` / `BOT_DEFAULT_MAX_DAILY_LOSS` — defaults for new users (no `bot_config` row yet).
- `ZT_OWNER_USER_ID` — Restricts `/api/mt5/connect` to the owner.
- `DERIV_CLIENT_ID` / `DERIV_REDIRECT_URI` — Deriv OAuth app config.
- `METAAPI_TOKEN` / `MT5_ACCOUNT_ID` — MetaApi.cloud credentials.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase config.

## Deriv OAuth Configuration

The app uses Deriv OAuth 2.0 Authorization Code flow with PKCE. Configure a registered OAuth2 app in Deriv and set these values in `.env.local`:

```env
DERIV_CLIENT_ID=your-deriv-client-id
DERIV_REDIRECT_URI=http://localhost:3000/api/auth/deriv/callback
SESSION_SECRET=your-32-byte-random-hex-string
```

Register the exact `DERIV_REDIRECT_URI` with Deriv. It must match, including scheme, host, port, and path. If unset, local development uses the current origin with `/api/auth/deriv/callback`; configure the registered production callback URL in the deployment environment.

## Project Structure

```
src/
  app/
    page.tsx                       # App shell: auth gate + guest browsing + view switcher (browser bot intervals removed)
    layout.tsx                     # Root layout (fonts, Toaster)
    globals.css                    # Trading terminal theme + animations
    api/
      auth/
        me/route.ts                # GET — redacted session info
        logout/route.ts            # POST — clear session cookie
        switch-account/route.ts    # POST — switch real <-> demo in session
        mt5-login/route.ts         # POST — MetaTrader session login
        deriv/
          start/route.ts           # GET — Deriv OAuth start (PKCE)
          callback/route.ts        # GET — Deriv OAuth callback (server-side token exchange + session)
      mt5/
        trade/route.ts             # POST — broker-confirmed order + risk controls + idempotency + broker_open_time
        connect/route.ts           # POST — admin-only MetaApi provisioning
        balance/route.ts           # GET — real MT5 balance (requireAuth)
        positions/route.ts         # GET — open MT5 positions (requireAuth)
        close/route.ts             # POST — close a broker position by id + broker_close_time + hold_time_ms
      deriv/
        balance/route.ts           # GET — real Deriv balance (reads token from session)
      trades/
        route.ts                   # GET/POST — list / insert trades (service-role Supabase, broker timestamps)
        [id]/route.ts              # PATCH — update / close a trade (broker timestamps)
      bot/
        config/route.ts            # GET/POST — read / patch the per-user bot_config row
        logs/route.ts              # GET — recent bot_logs rows for the activity feed
      cron/
        bot/route.ts               # GET — serverless cron worker (CRON_SECRET auth, reconcile + agents + orders + SL/TP)
      agents/
        backtest/route.ts          # GET — run an agent's strategy on historical Binance candles (requireAuth)
  lib/
    auth/session.ts                # Server-side session utility (signed cookie, requireAuth, requireAdmin)
    authStore.ts                   # Client auth state (Zustand + persist) — no access token, no fabricated balances
    tradeStore.ts                  # Trade persistence (server-side via /api/trades, idempotency, syncPendingTrades, broker timestamps)
    botStore.ts                    # Bot state + equity-based position sizing (computeEquityPositionSize)
    botConfig.ts                   # Server-side bot config persistence (Supabase bot_config table)
    reconciliation.ts              # Position reconciliation between Supabase and the broker (matched / localOnly / brokerOnly)
    metaApiServer.ts               # MetaApi.cloud SDK wrapper (server-side) + 5-minute connection cache
    derivApiServer.ts              # Deriv WebSocket API (server-side)
    derivOAuth.ts                  # Deriv OAuth cookie helpers
    useDerivCallback.ts            # Client hook: picks up /?auth=deriv redirect, syncs from /api/auth/me
    supabase.ts                    # Browser Supabase client (anon key)
    supabaseServer.ts              # Server Supabase client (service role — bypasses RLS)
    strategy.ts                    # Drop Catcher strategy + risk config
    binance.ts                     # Binance public REST API client
    agents/
      types.ts                     # AgentCore + AgentPerformance + ConsensusResult type definitions
      registry.ts                  # Server-safe agent registry (id, strategyVersion, analyzer)
      agentStore.ts                # Zustand store (5 agents, signals, consensus, self-improvement)
      consensus.ts                 # Weighted consensus evaluation + agent discussion thread
      performance.ts               # AgentPerformance calculation (win rate, profit factor, max DD, Sharpe)
      backtest.ts                  # Sliding-window backtest on historical Binance candles
      indicators.ts                # SMA, RSI, MACD, Bollinger Bands, ATR, volume spike
      momentum.ts / reverter.ts / sentiment.ts / breakout.ts / arbitrage.ts — the 5 agent analyzers
  components/
    trading/                       # Candlestick chart, order book, trade panel, ticker tape
    views/                         # Login, Sidebar, Dashboard, Agents, Bot, Reports
    ui/                            # shadcn/ui components
supabase/schema.sql                # Database schema + RLS policies (broker_open_time, broker_close_time, hold_time_ms)
vercel.json                        # Cron schedule for /api/cron/bot (hourly on Hobby, * * * * * on Pro)
```

## License

MIT
