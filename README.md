# Z Trading Terminal

A professional Bloomberg/Binance-style market trading terminal built with Next.js 16, TypeScript, and Tailwind CSS. Features an interactive candlestick chart, self-improving AI trading agents, an autonomous trading bot with risk management, and downloadable reports.

## Features

- **Login** — Authenticate via Deriv (OAuth2) or MetaTrader (account credentials). Choose Real or Demo account.
- **Trading** — Interactive candlestick chart with multiple timeframes (1m to 1W), order book, buy/sell panel, and live ticker tape
- **Dashboard** — Today's trading stats, win/loss rates, cumulative P&L chart, and searchable trade logs
- **Agents & Strategies** — 5 self-improving AI trading agents that adjust parameters after losses (visible "Learning" badges + improvement logs)
- **Bot** — Autonomous trading bot with risk management and stop-loss automation, receives signals from agents/strategies
- **Reports** — Download daily/weekly PDF reports and trade history/agent performance CSV exports

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS 4
- Zustand (state management)
- lucide-react (icons)
- shadcn/ui (component library)

## Getting Started

```bash
bun install
bun run dev
```

Open http://localhost:3000

## Deriv OAuth Configuration

The app uses Deriv OAuth 2.0 Authorization Code flow with PKCE. Configure a
registered OAuth2 app in Deriv and set these values in `.env.local`:

```env
DERIV_CLIENT_ID=your-deriv-client-id
DERIV_REDIRECT_URI=http://localhost:3000/api/auth/deriv/callback
```

Register the exact `DERIV_REDIRECT_URI` with Deriv. It must match, including
scheme, host, port, and path. If unset, local development uses the current
origin with `/api/auth/deriv/callback`; configure the registered production
callback URL in the deployment environment.

## Project Structure

```
src/
  app/
    page.tsx              # App shell: auth gate + view switcher
    layout.tsx            # Root layout (fonts, Toaster)
    globals.css           # Trading terminal theme + animations
  lib/
    mockData.ts           # Shared Zustand store (trades, agents, bot)
    authStore.ts          # Auth state (persisted to localStorage)
    useDerivCallback.ts   # Deriv OAuth callback handler
  components/
    trading/              # Candlestick chart, order book, trade panel
    views/                # Login, Dashboard, Agents, Bot, Reports, Sidebar
    ui/                   # shadcn/ui components
```

## License

MIT
