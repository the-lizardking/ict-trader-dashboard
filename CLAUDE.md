# ICT Trader Dashboard — CLAUDE.md

## What this is

Streamlit dashboard for the ICT Trading Bot's FastAPI on the VPS.
Read-only — polls the bot's REST API and renders stats, positions,
signals, closed trades, logs, and health. Hosted on Streamlit Community
Cloud (free), auto-redeploys from `main`.

- Entry point: [`streamlit_app.py`](./streamlit_app.py)
- Deploy + local-dev steps: [`README.md`](./README.md)
- Migration history: [PR #32](https://github.com/benbaichmankass/ict-trader-dashboard/pull/32)

## Architecture

```
Browser ──HTTPS──▶ Streamlit Community Cloud (Python) ──HTTP──▶ Bot FastAPI :8001
                                                                 (158.178.210.252)
```

Streamlit's Python server makes the upstream call directly. The browser
only sees Streamlit's HTTPS-rendered page, so there's no mixed-content
block, no CORS surface, no transport-layer intermediaries. The list of
things that can break the dashboard collapses to:

- Streamlit Cloud being down (free-tier SLA, ~ok)
- The VM's FastAPI being down (`ict-web-api.service`)
- This script's code

No tunnel, no worker, no rewrite, no V8 isolate.

## Why not React + Vercel (history)

For the first 5 days the dashboard was a Vite/React SPA on Vercel.
Five different transport architectures were tried (direct HTTP → Vercel
Edge Function → Cloudflare Worker → CF quick tunnel → named CF tunnel)
because **Vercel Hobby blocks plain-HTTP outbound** from rewrites and
from user functions. Every option except the named tunnel rotated, and
the named tunnel adds a cloudflared daemon plus a CF-account dependency.
The Streamlit pivot in PR #32 eliminates the transport-layer problem
entirely by moving the upstream call to the dashboard's Python server.

Full investigation: [`ict-trading-bot/docs/audit/vercel-edge-vs-cf-worker.md`](https://github.com/benbaichmankass/ict-trading-bot/blob/main/docs/audit/vercel-edge-vs-cf-worker.md).

**Do not reintroduce React + Vercel for this dashboard.** It looked
simpler than it is. If a future feature genuinely needs a richer
front-end, evaluate three options first: (a) a Streamlit Custom
Component in this same app, (b) a separate static site on a host
without the Hobby HTTP-outbound block (Cloudflare Pages, Netlify), or
(c) Vercel Pro — in that order.

## Bot-side authority split (consumer note, adopted 2026-05-11)

The dashboard is a **pure read-only consumer** of the bot's REST API
— it never mutates live trading state directly, so the bot-side
[VM authority split](https://github.com/benbaichmankass/ict-trading-bot/blob/main/CLAUDE.md#vm-authority-split-adopted-2026-05-11)
governs the bot, not this repo. But Claude sessions touching the
dashboard should know which side of the split each endpoint comes from:

| Endpoint family | Source VM | Authority side |
|---|---|---|
| `/api/bot/{stats,positions,signals,logs,trades/*,liquidity,config,backtests,pnl/*}` | Live trader | Restricted. Dashboard renderer is autonomous-Claude; bot-side endpoint additions follow the bot's Tier-1/2/3 rules. |
| `/api/bot/shadow/{predictions,stats,drift}` | Live trader | Restricted on the bot side; dashboard renderer autonomous. |
| `/api/bot/health/{latest,history,snapshot,services}` | Live trader | Restricted (live-VM health); dashboard renderer autonomous. |

**Hard limit that survives the split:** any dashboard wiring that would
*initiate* a live-trade action (FORCED STOP, promote-to-live, halt, etc.)
is **operator-gated at the bot-side endpoint**, not at the dashboard.
The dashboard PR is autonomous; the bot-side endpoint is Tier-3 per
[`vm-operator-mode.md`](https://github.com/benbaichmankass/ict-trading-bot/blob/main/docs/claude/vm-operator-mode.md).

## What's in this repo

```
streamlit_app.py       — the dashboard (single file, ~200 lines)
requirements.txt       — Python deps (streamlit, streamlit-autorefresh, requests, pandas)
.streamlit/config.toml — theme + privacy
README.md              — deploy + dev steps
CLAUDE.md              — this file
docs/                  — ad-hoc design notes
```

## Tabs (current)

| Tab | Endpoints |
|---|---|
| Overview | `/api/bot/stats`, `/api/pnl/history?days=30` |
| Positions | `/api/bot/positions` |
| Signals | `/api/bot/signals` |
| Closed trades | `/api/bot/trades/closed?limit=50` |
| Logs | `/api/bot/logs` |
| Health | `/api/bot/health/services`, `/api/bot/health/latest` |

**Not (yet) ported from the old React app:** TradingView candle chart
with Bybit-WS per-tick updates, Backtests, Models / ShadowModels (ML
drift charts), LiquidityMaps, TimePrice (killzone heatmap), TradeProcess,
Settings, Gemini AI analysis. These were the rich-but-fragile parts.
Port them back when there's a clear operator need — but keep each as a
separate Streamlit page or fragment so adding one doesn't break the rest.

## API contract (from ict-trading-bot)

Canonical contract lives in [`ict-trading-bot/CLAUDE.md`](https://github.com/benbaichmankass/ict-trading-bot/blob/main/CLAUDE.md) § "Dashboard REST API".

Important nullability notes for renderers:

- `BotStats.vmHealth.{cpu,memory,disk}` are **nullable** — render `—`,
  not `0%`. A real `0` reading is a measurement.
- `BotStats` returns **HTTP 503** on structural DB failure (S-067).
  The Streamlit `_fetch` helper surfaces this as a per-endpoint warning
  banner rather than crashing the page.
- `Signal.{pattern,confidence,price}` are **nullable**. Skip rows with
  null `pattern` rather than aggregating them under "unknown".
- `ClosedTrade.{realizedPnlPct,closeReason,pattern}` are **nullable**.
- `Position.{stopLoss,takeProfit,pattern}` are **nullable**.
- `BacktestRun.{totalTrades,winningTrades,losingTrades}` are **nullable**
  — an aborted backtest lands with NULL counts.

## Local dev

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
# Or hit a local bot:
BOT_API_URL=http://localhost:8001 streamlit run streamlit_app.py
```

The `BOT_API_URL` env var overrides the default
`http://158.178.210.252:8001`. On Streamlit Cloud, set it in
**Settings → Secrets** if the VPS IP ever changes; otherwise the
hardcoded default is fine.
