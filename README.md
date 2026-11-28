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
- **Agents & Strategies** — 5 self-improving AI trading agents that adjust parameters after losses (visible "Learning" badges + improvement logs).
- **Bot** — Autonomous trading bot with equity-based position sizing (uses the real account balance, not a hardcoded fallback), risk management, and stop-loss automation. Receives signals from agents/strategies.
- **Reports** — Download daily/weekly PDF reports and trade history/agent performance CSV exports.

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
- `REAL_TRADING_ENABLED` — `false` (default) or `true`. Gates real-account orders.
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
    page.tsx                       # App shell: auth gate + guest browsing + view switcher
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
        trade/route.ts             # POST — broker-confirmed order + risk controls + idempotency
        connect/route.ts           # POST — admin-only MetaApi provisioning
        balance/route.ts           # GET — real MT5 balance (requireAuth)
        positions/route.ts         # GET — open MT5 positions (requireAuth)
        close/route.ts             # POST — close a broker position by id
      deriv/
        balance/route.ts           # GET — real Deriv balance (reads token from session)
      trades/
        route.ts                   # GET/POST — list / insert trades (service-role Supabase)
        [id]/route.ts              # PATCH — update / close a trade
  lib/
    auth/session.ts                # Server-side session utility (signed cookie, requireAuth, requireAdmin)
    authStore.ts                   # Client auth state (Zustand + persist) — no access token, no fabricated balances
    tradeStore.ts                  # Trade persistence (server-side via /api/trades, idempotency, syncPendingTrades)
    botStore.ts                    # Bot state + equity-based position sizing (computeEquityPositionSize)
    metaApiServer.ts               # MetaApi.cloud SDK wrapper (server-side)
    derivApiServer.ts              # Deriv WebSocket API (server-side)
    derivOAuth.ts                  # Deriv OAuth cookie helpers
    useDerivCallback.ts            # Client hook: picks up /?auth=deriv redirect, syncs from /api/auth/me
    supabase.ts                    # Browser Supabase client (anon key)
    supabaseServer.ts              # Server Supabase client (service role — bypasses RLS)
    strategy.ts                    # Drop Catcher strategy + risk config
    binance.ts                     # Binance public REST API client
  components/
    trading/                       # Candlestick chart, order book, trade panel, ticker tape
    views/                         # Login, Sidebar, Dashboard, Agents, Bot, Reports
    ui/                            # shadcn/ui components
supabase/schema.sql                # Database schema + RLS policies (client_order_id, broker_order_id, service-role writes)
```

## License

MIT
