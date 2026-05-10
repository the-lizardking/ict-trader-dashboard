# ICT Trader Dashboard

Live trading dashboard for the ICT Trading Bot. Built with React 19 + Vite + Tailwind CSS v4, deployed on Vercel.

## Features

- **Live metrics** — 24h PnL, open trades, win rate, VM health (CPU/RAM/disk)
- **Equity curve** — area chart of account equity over time
- **ICT strategy monitor** — active/paused status of running strategies
- **Live log feed** — terminal-style feed of bot events with level badges
- **AI Analysis** — Gemini-powered ICT market analysis from recent log data

## Architecture

```
Vercel (SPA) ──HTTPS──▶ VPS FastAPI :8001
                          /api/bot/stats
                          /api/bot/logs
                          /api/bot/positions
                          /api/bot/signals
```

No SSH tunneling. No Express server. Pure static build calling the bot's public REST API.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env:
#   VITE_BOT_API_URL=https://your-vps:8001
#   GEMINI_API_KEY=your_key
npm run dev
```

## Vercel Deployment

1. Push to GitHub
2. Import repo in Vercel dashboard
3. Add environment variables:
   - `VITE_BOT_API_URL` — bot API public URL (no trailing slash)
   - `GEMINI_API_KEY` — Google AI Studio key
4. Deploy — `vercel.json` handles SPA routing automatically

## Bot API Setup

The `ict-trading-bot` repo exposes the required endpoints via FastAPI on port 8001.
On the VPS, set in the systemd service environment:

```
DASHBOARD_ORIGIN=https://your-vercel-app.vercel.app
```

This enables CORS for the Vercel domain.

## Related

- [ict-trading-bot](https://github.com/benbaichmankass/ict-trading-bot) — Python trading bot + FastAPI data feed
