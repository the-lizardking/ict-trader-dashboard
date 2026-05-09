# ICT Trader Dashboard — CLAUDE.md

## Project Overview
React 19 + Vite + Tailwind CSS v4 SPA deployed on Vercel.
Calls the ICT Trading Bot's FastAPI (`ict-trading-bot`) REST API for live data.
No server-side code — pure static build.

## Architecture
```
Browser (Vercel)
  → HTTPS → Vercel edge → rewrite → HTTP → Bot FastAPI (VPS :8001)
                                     ├── GET /api/bot/stats
                                     ├── GET /api/bot/logs
                                     ├── GET /api/bot/positions
                                     └── GET /api/bot/signals
```

The browser only ever talks to the Vercel edge over HTTPS. The Vercel
rewrite (`vercel.json`) proxies `/api/bot/*` to the bot's plain-HTTP
endpoint server-side. This avoids the browser's mixed-content block
and makes CORS irrelevant (every dashboard request is same-origin).

## Tech Stack
- React 19, Vite 6, TypeScript 5.8
- Tailwind CSS v4 (`@import "tailwindcss"` syntax, `@theme {}` block)
- Recharts — equity curve area chart
- Framer Motion (motion) — modal animations
- Lucide React — icons
- `@google/genai` — Gemini AI market analysis

## Key Environment Variables
| Variable | Description |
|----------|-------------|
| `VITE_BOT_API_URL` | Bot API base URL. **Leave empty in production** so fetches go to `/api/bot/*` same-origin and ride the Vercel rewrite. Override only for local dev (`http://localhost:8001`) or a TLS-terminated bot endpoint. |
| `GEMINI_API_KEY` | Google AI Studio key for market analysis feature |

## API routing

`vercel.json` declares two rewrites, in order:

1. `/api/bot/:path*` → `http://158.178.210.252:8001/api/bot/:path*` — proxies dashboard API calls to the bot VPS. Vercel terminates TLS at its edge then makes the upstream HTTP request, so the browser never sees mixed content.
2. `/(.*)` → `/` — SPA catch-all for client-side routing.

Order matters. The API rewrite must come first; otherwise the catch-all eats every request and rewrites it to `/`.

If the bot VPS IP changes, update the destination in `vercel.json` and redeploy. If the bot eventually moves behind a real HTTPS endpoint, drop the rewrite and set `VITE_BOT_API_URL` to the new HTTPS URL.

## Development
```bash
npm install
cp .env.example .env   # set VITE_BOT_API_URL=http://localhost:8001 for local bot, or leave empty
npm run dev
```

Local dev does NOT use the Vercel rewrite. Either run the bot locally on `:8001` and set `VITE_BOT_API_URL=http://localhost:8001`, or run `vercel dev` instead of `npm run dev` to exercise the rewrite path against the real VPS.

## Vercel Deployment
1. Connect repo to Vercel
2. Framework preset: Vite (auto-detected)
3. Set `GEMINI_API_KEY` in Vercel environment settings
4. Set `VITE_BOT_API_URL` to **empty string** in Vercel environment settings (Production + Preview) — do not set it to the VPS IP, which would re-introduce the mixed-content block
5. `vercel.json` handles both the API rewrite and SPA routing

## File Structure
```
src/
  components/
    Dashboard.tsx        — main layout, polling loop, header, collapsible/mobile sidebar, modals, connection banners (allFailed vs partial)
    EquityChart.tsx      — Recharts area chart driven by a rolling totalPnL buffer (data prop)
    StatsGrid.tsx        — 4 metric cards (PnL, orders, status, infra)
    LogViewer.tsx        — terminal-style scrollable log feed
    PositionsPanel.tsx   — open trades from /api/bot/positions
    StrategySignals.tsx  — recent signals aggregated by pattern from /api/bot/signals
  services/
    api.ts               — typed fetchers (getStats/getLogs/getPositions/getSignals) with AbortController timeout, getDashboardSnapshot uses Promise.allSettled so one failing endpoint doesn't blank the dashboard, BotApiError carries httpStatus (0 = network/timeout)
    geminiService.ts     — Gemini AI market analysis call
  lib/
    utils.ts             — cn() helper (clsx + tailwind-merge)
  types.ts               — Trade, BotStats, LogEntry, Position, Signal, EquityPoint TypeScript interfaces
  index.css              — Tailwind v4 imports + custom component classes
  App.tsx                — root component, renders <Dashboard />
  main.tsx               — React 19 createRoot entry point
vercel.json              — API rewrite + SPA rewrite (order matters)
```

## API Contract (from ict-trading-bot)

### `GET /api/bot/stats` → `BotStats`
```json
{
  "pnl24h": 124.50,
  "totalPnL": 3200.00,
  "openTrades": 2,
  "winRate": 68.5,
  "status": "running",
  "datasource": "live",
  "vmHealth": { "cpu": 32.1, "memory": 48.5, "disk": 21.0 }
}
```

`vmHealth.cpu | memory | disk` are **nullable**. `null` per field means
the bot's psutil sample failed (ict-trading-bot#556) — render `—`,
not `0%`. A real `0` reading is a measurement and renders as `0%`.

### `GET /api/bot/logs` → `LogEntry[]`
```json
[
  {
    "id": "abc123",
    "timestamp": "2026-05-08T10:00:00Z",
    "level": "trade",
    "message": "BTC long opened at 62000"
  }
]
```

### `GET /api/bot/positions` → `Position[]`
```json
[
  {
    "id": "42",
    "account": "bybit_2",
    "symbol": "BTCUSDT",
    "side": "buy",
    "qty": 0.001,
    "entryPrice": 62000,
    "unrealizedPnl": 12.45,
    "openedAt": "2026-05-08T10:00:00Z"
  }
]
```

### `GET /api/bot/signals` → `Signal[]`
```json
[
  {
    "id": "abc123",
    "timestamp": "2026-05-08T10:00:00Z",
    "symbol": "BTCUSDT",
    "side": "buy",
    "pattern": "FVG_REVERSAL",
    "confidence": 0.82,
    "price": 62000
  }
]
```

`pattern | confidence | price` are **nullable**. The bot returns
`null` when the originating audit row was written without that
field (ict-trading-bot#556). Renderers must skip rows with null
`pattern` rather than aggregate them under "unknown".

## Equity history note

The bot exposes `GET /api/pnl/history?days=N` for true daily P&L history,
but it's JWT-gated (`require_session`) and the SPA does not yet have a
login flow. Until that lands, `EquityChart` consumes a session-only
client-side rolling buffer of `stats.totalPnL` collected each poll tick
(60 ticks × 10s = 10 minutes of history). The buffer resets on tab
refresh — moving to localStorage, or wiring login + `/api/pnl/history`,
is a follow-up.

## Notes
- `GEMINI_API_KEY` is baked into the JS bundle at build time via Vite `define` — acceptable for a private internal tool
- Tailwind v4 does NOT use `tailwind.config.js`; all theme tokens live in `@theme {}` inside `index.css`
- `vercel.json` SPA rewrite is required for any client-side routing to work after a hard refresh
- `VITE_BOT_API_URL` must NOT have a trailing slash if you set it (default empty triggers the same-origin rewrite path)
- The `FORCED STOP` button in the header is currently visually disabled — the bot doesn't expose an HTTP halt endpoint yet (`/halt` is only on the trader Telegram bot today). Wire to a new `POST /api/bot/halt` in a follow-up.
