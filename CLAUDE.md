# ICT Trader Dashboard — CLAUDE.md

## Project Overview
React 19 + Vite + Tailwind CSS v4 SPA deployed on Vercel.
Calls the ICT Trading Bot's FastAPI (`ict-trading-bot`) REST API for live data.
No server-side code — pure static build.

## Architecture
```
Browser (Vercel) → HTTPS → Bot FastAPI (VPS :8001)
                         ├── GET /api/bot/stats
                         ├── GET /api/bot/logs
                         ├── GET /api/bot/positions
                         └── GET /api/bot/signals
```

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
| `VITE_BOT_API_URL` | Public URL of the bot FastAPI, e.g. `https://vps-ip:8001` |
| `GEMINI_API_KEY` | Google AI Studio key for market analysis feature |

## Development
```bash
npm install
cp .env.example .env   # fill in VITE_BOT_API_URL and GEMINI_API_KEY
npm run dev
```

## Vercel Deployment
1. Connect repo to Vercel
2. Set `VITE_BOT_API_URL` and `GEMINI_API_KEY` in Vercel environment settings
3. Framework preset: Vite (auto-detected)
4. `vercel.json` handles SPA routing rewrites automatically

## File Structure
```
src/
  components/
    Dashboard.tsx     — main layout, polling loop, header, sidebar, modals
    EquityChart.tsx   — Recharts area chart (mock data; wire live data later)
    StatsGrid.tsx     — 4 metric cards (PnL, orders, status, infra)
    LogViewer.tsx     — terminal-style scrollable log feed
  services/
    geminiService.ts  — Gemini AI market analysis call
  lib/
    utils.ts          — cn() helper (clsx + tailwind-merge)
  types.ts            — Trade, BotStats, LogEntry TypeScript interfaces
  index.css           — Tailwind v4 imports + custom component classes
  App.tsx             — root component, renders <Dashboard />
  main.tsx            — React 19 createRoot entry point
vercel.json           — SPA rewrite rule
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

### `GET /api/bot/logs` → `LogEntry[]`
```json
[
  {
    "id": "abc123",
    "timestamp": "2025-05-07T10:00:00Z",
    "level": "trade",
    "message": "BTC long opened at 62000"
  }
]
```

## Notes
- `GEMINI_API_KEY` is baked into the JS bundle at build time via Vite `define` — acceptable for a private internal tool
- Tailwind v4 does NOT use `tailwind.config.js`; all theme tokens live in `@theme {}` inside `index.css`
- `vercel.json` SPA rewrite is required for any client-side routing to work after a hard refresh
- `VITE_BOT_API_URL` must NOT have a trailing slash
