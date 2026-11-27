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

The app uses Deriv's demo App ID (`1089`) by default. For production:

1. Register at https://api.deriv.com/dashboard
2. Create an OAuth2 application
3. Set the redirect URL to your app's origin
4. Replace `DERIV_APP_ID` in `src/components/views/LoginView.tsx`

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
