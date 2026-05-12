# ICT Trader Dashboard — CLAUDE.md

## Streamlit migration (adopted 2026-05-12)

**Decision:** the dashboard is being rebuilt as a Streamlit app hosted
on Streamlit Community Cloud. Operator-driven decision after multiple
consecutive incidents where the Vercel-fronted Vite app stopped
resolving live data. The Streamlit entry point is `streamlit_app.py`
at the repo root; deploy steps in [`README.md`](./README.md).

### Why a server-rendered Python app (not React + Vercel)

The dashboard is read-only — a browser tab that polls the bot's
FastAPI. The transport architecture between Vercel and the VM has
consumed an outsize fraction of the project's time. Concretely:

| When | PR | What | Outcome |
|---|---|---|---|
| 2026-05-07 | #2 | `vercel.json` rewrite `/api/bot/*` → `http://158.178.210.252:8001` (direct) | Worked for 3 days |
| 2026-05-10 | #22 | Vercel Hobby stopped honouring plain-HTTP destinations. Switched to a Cloudflare quick tunnel | Worked but tunnel URL rotates on every cloudflared restart |
| 2026-05-10 | #23 | Tried a Vercel Edge Function (server-side proxy) | Failed — Vercel Hobby applies the HTTP-outbound block to user functions too |
| 2026-05-10 | #25 | Reverted Edge Function, back to CF quick tunnel | Worked |
| 2026-05-10 | (cf-worker) | Tried a Cloudflare Worker at `*.workers.dev` proxying to the raw IP | Failed — CF error 1003: Workers can't fetch raw IPv4 either. Retired; `cf-worker/` directory in `ict-trading-bot` kept as historical record |
| 2026-05-11 | #29 | Quick-tunnel URL rotated; emergency vercel.json patch | Worked until next rotation |
| 2026-05-12 | #30 | Quick-tunnel URL rotated **again**; another emergency patch | Worked until next rotation |
| 2026-05-12 | #31 | **Named** CF tunnel at `c0ff9d8d-…cfargotunnel.com` + `ict-cloudflared-tunnel.service` (`Restart=always`) on the VM | Stable, but adds a cloudflared daemon, a CF account dependency, and a CNAME-ish hostname Vercel rewrites to |

Full evidence: [`ict-trading-bot/docs/audit/vercel-edge-vs-cf-worker.md`](https://github.com/benbaichmankass/ict-trading-bot/blob/main/docs/audit/vercel-edge-vs-cf-worker.md).

The fundamental constraint is that Vercel Hobby blocks plain-HTTP
outbound from rewrites *and* from user functions, and we don't have a
Vercel-Pro budget ($20+/user/mo) or a CF zone (which would unlock a
free named-tunnel CNAME). Every working architecture therefore
required a tunnel layer between Vercel and the VM. That tunnel layer
has been the source of every production outage since 2026-05-10.

**Streamlit removes the constraint.** The dashboard is rendered by a
Python process on Streamlit Community Cloud (free, ≤1 GB RAM,
auto-redeploys from `main`). The browser only sees Streamlit's HTTPS
endpoint, so there is no mixed-content block; the Python process
makes the upstream call to `http://158.178.210.252:8001` directly.
No tunnel, no worker, no rewrite, no V8-isolate proxy. The list of
things that can break the dashboard collapses to: Streamlit Cloud
being down, the VM's FastAPI being down, or this script's code.

### Migration plan

1. **Now (this PR):** ship `streamlit_app.py` + `requirements.txt` +
   `.streamlit/config.toml` on the simplification branch. Operator
   deploys it on share.streamlit.io. The React app remains alongside
   as a fallback.
2. **+24h** after Streamlit is verified live and stable: retire the
   React app and `vercel.json`. Retire the `cf-worker/` directory in
   `ict-trading-bot`. Retire `ict-cloudflared-tunnel.service` on the
   VM (via the existing `teardown-cloudflare-tunnel` operator action).
3. **+1 week:** delete the React app source (`src/`, `index.html`,
   `vite.config.ts`, `tsconfig.json`, `package.json`,
   `package-lock.json`) in a cleanup PR.

### Feature-scope tradeoff (explicit)

The first Streamlit cut covers **Overview** (stats + VM health + 30d
PnL line chart), **Positions**, **Signals**, **Closed trades**,
**Logs**, and **Health** (systemd services + latest snapshot).

It does **not** carry over (yet): the TradingView candle chart with
Bybit-WS per-tick updates, Backtests, Models / ShadowModels (ML
drift charts), LiquidityMaps, TimePrice (killzone heatmap),
TradeProcess, Settings (config view), or the Gemini AI analysis.
Those can be ported back if needed, but the operator's priority is
stable + transparent over rich; rich-but-fragile is what got us into
the transport-layer rabbit hole.

### What still applies from the rest of this file

- The "Bot-side authority split" note below (the dashboard is still a
  pure read-only consumer; nothing changes there).
- The API contract (the Streamlit app consumes the same FastAPI
  endpoints).
- The "Hard limit" on operator-gated actions (FORCED STOP, model
  promotion) — those still belong on the bot side, not the dashboard.
- The Vercel-specific sections lower down (`vercel.json` rewrites,
  `VITE_BOT_API_URL`, CI typecheck) describe the **legacy**
  architecture and remain accurate for the React app while it's still
  deployed. They will be removed in the cleanup PR.

---

## Bot-side authority split (consumer note, adopted 2026-05-11)

The dashboard is a **pure read-only consumer** of the bot's REST
API — it never mutates live trading state directly, so the bot-side
[VM authority split](https://github.com/benbaichmankass/ict-trading-bot/blob/main/CLAUDE.md#vm-authority-split-adopted-2026-05-11)
governs the bot, not this repo. But Claude sessions touching the
dashboard should know which side of the split each endpoint comes
from:

| Endpoint family | Source VM | Authority side |
|---|---|---|
| `/api/bot/{stats,positions,signals,logs,trades/*,liquidity,config,backtests,pnl/*}` | Live trader | Restricted (existing). Adding new panels that consume these endpoints is autonomous-Claude on the dashboard side; the bot-side endpoint additions follow the bot's normal Tier-1 / Tier-2 / Tier-3 rules. |
| `/api/bot/shadow/{predictions,stats,drift}` | Live trader (reads `runtime_logs/shadow_predictions.jsonl` written by the live `Coordinator`) | Restricted on the bot side, but the data source is trainer-VM-produced models running in shadow mode. The dashboard renderer is autonomous-Claude. |
| `/api/bot/health/{latest,history,snapshot,services}` | Live trader | Restricted (live-VM health). Dashboard renderer is autonomous-Claude. |
| Future trainer-VM telemetry (model registry views, training-cycle logs, dataset cards) | **Trainer** — `ict-trainer-vm` once provisioned | Autonomous-Claude both bot-side (per trainer charter) and dashboard-side. Move fast. |

**Hard limit that survives the split:** A dashboard wiring that
would *initiate* a live-trade action — e.g., the FORCED STOP button
in the header, or a "promote this model to limited_live" button —
is **operator-gated** at the bot-side endpoint, not at the
dashboard. The dashboard PR is autonomous; the bot-side endpoint
that takes the action is Tier-3 per
[`vm-operator-mode.md`](https://github.com/benbaichmankass/ict-trading-bot/blob/main/docs/claude/vm-operator-mode.md). Don't ship the dashboard button before the bot endpoint is approved.

## Project Overview (legacy React app)
React 19 + Vite + Tailwind CSS v4 SPA deployed on Vercel.
Calls the ICT Trading Bot's FastAPI (`ict-trading-bot`) REST API for live data.
No server-side code — pure static build.

## Architecture (legacy)
```
Browser (Vercel)
  → HTTPS → Vercel edge → rewrite → HTTP → Bot FastAPI (VPS :8001)
                                     ├── GET /api/bot/stats          (S-014)
                                     ├── GET /api/bot/logs           (S-014)
                                     ├── GET /api/bot/positions      (S-014)
                                     ├── GET /api/bot/signals        (S-014)
                                     ├── GET /api/bot/trades/closed  (#557, 2026-05-09)
                                     ├── GET /api/bot/liquidity      (S-064, 2026-05-09)
                                     ├── GET /api/bot/config         (S-064, 2026-05-09)
                                     ├── GET /api/bot/backtests      (M5 P4, 2026-05-10)
                                     ├── GET /api/bot/health/latest  (2026-05-11)
                                     ├── GET /api/bot/health/history (2026-05-11)
                                     ├── GET /api/bot/health/services(2026-05-11)
                                     ├── GET /api/bot/trades/scores  (2026-05-11)
                                     └── GET /api/pnl/history        (S-063, no-session)
```

The browser only ever talks to the Vercel edge over HTTPS. The Vercel
rewrite (`vercel.json`) proxies `/api/bot/*` to the bot's plain-HTTP
endpoint server-side. This avoids the browser's mixed-content block
and makes CORS irrelevant (every dashboard request is same-origin).

## Tech Stack
- React 19, Vite 6, TypeScript 5.8 (strict)
- Tailwind CSS v4 (`@import "tailwindcss"` syntax, `@theme {}` block)
- Recharts — equity curve area chart, performance + bar charts
- `lightweight-charts` (TradingView) — live candle chart on Overview, per-tick updates via Bybit public WebSocket
- Framer Motion (motion) — modal + tab transitions
- Lucide React — icons
- `@google/genai` — Gemini AI market analysis

## Key Environment Variables
| Variable | Description |
|----------|-------------|
| `VITE_BOT_API_URL` | Bot API base URL. **Leave empty in production** so fetches go to `/api/bot/*` same-origin and ride the Vercel rewrite. Override only for local dev (`http://localhost:8001`) or a TLS-terminated bot endpoint. |
| `GEMINI_API_KEY` | Google AI Studio key for market analysis feature |

## API routing

`vercel.json` declares two rewrites, in order:

1. `/api/bot/:path*` → `https://c0ff9d8d-0d78-4a0b-b7d1-4d9e1cba830c.cfargotunnel.com/api/bot/:path*` — proxies dashboard API calls to the bot VPS via the named Cloudflare tunnel (PR #31). Vercel terminates TLS at its edge; cloudflared on the VM tunnels back to `127.0.0.1:8001`.
2. `/(.*)` → `/` — SPA catch-all for client-side routing.

Order matters. The API rewrite must come first; otherwise the catch-all eats every request and rewrites it to `/`.

If the bot VPS IP changes, the named tunnel hostname stays stable —
no `vercel.json` change required. If the bot eventually moves behind
a real HTTPS endpoint, drop the rewrite and set `VITE_BOT_API_URL`
to the new HTTPS URL.

## Development
```bash
npm install
cp .env.example .env   # set VITE_BOT_API_URL=http://localhost:8001 for local bot, or leave empty
npm run dev
npm run typecheck      # required to pass before opening a PR (CI gates on it)
npm run build          # full production bundle; CI also runs this
```

Local dev does NOT use the Vercel rewrite. Either run the bot locally on `:8001` and set `VITE_BOT_API_URL=http://localhost:8001`, or run `vercel dev` instead of `npm run dev` to exercise the rewrite path against the real VPS.

## CI

`.github/workflows/typecheck.yml` runs `npm ci && npm run typecheck && npm run build` on every PR and on every push to `main`. There is **no automated test suite yet** (no Vitest, no Jest); a focused smoke-test sprint for `src/services/api.ts` is queued as a follow-up. Until then, typecheck + build are the only gates.

## Vercel Deployment
1. Connect repo to Vercel
2. Framework preset: Vite (auto-detected)
3. Set `GEMINI_API_KEY` in Vercel environment settings
4. Set `VITE_BOT_API_URL` to **empty string** in Vercel environment settings (Production + Preview) — do not set it to the VPS IP, which would re-introduce the mixed-content block
5. `vercel.json` handles both the API rewrite and SPA routing

## File Structure
```
streamlit_app.py        — NEW: minimal Streamlit dashboard (current architecture)
requirements.txt        — NEW: Python deps for Streamlit Cloud
.streamlit/config.toml  — NEW: Streamlit theme + privacy config
src/                    — LEGACY: React app (kept as fallback until Streamlit verified)
  components/
    Dashboard.tsx        — main layout, tab routing, polling loop, header, collapsible/mobile sidebar, modals, connection banners (allFailed vs partial)
    StatsGrid.tsx        — 4 metric cards (PnL, orders, status, infra)
    EquityChart.tsx      — Recharts area chart driven by a session rolling totalPnL buffer (10 min)
    LiveChart.tsx        — Per-tick TradingView-style candle chart (Bybit public REST history + WS streaming kline). Overlays buy/sell markers from /api/bot/signals + entry/TP/SL price-lines from /api/bot/positions; symbol selector unions config + live positions.
    SystemHealthTab.tsx  — VM resources + systemd service states + latest health snapshot + 24h snapshot history (consumes /api/bot/health/{latest,history,services})
    StrategySignals.tsx  — Active ICT Strategies — recent signals aggregated by pattern from /api/bot/signals
    PositionsPanel.tsx   — Open trades from /api/bot/positions
    LogViewer.tsx        — Terminal-style scrollable log feed
    JournalsTab.tsx      — Closed-trades table from /api/bot/trades/closed (#557); per-trade notes in localStorage
    BacktestsTab.tsx     — Backtest runs from /api/bot/backtests (M5 P4); aggregate strip + filterable table
    ModelsTab.tsx        — Pattern roster + 7d win rate per pattern (closed-trades attribution) + filtered live signals (S-062)
    TimePriceTab.tsx     — Killzone activity heatmap + signal cadence; Power-of-3 strip disabled by design (no phase tag in /api/bot/signals)
    PerformanceTab.tsx   — Daily P&L table + per-strategy aggregates (S-063); falls back to in-session equity buffer when /api/pnl/history fails
    LiquidityMapsTab.tsx — Per-symbol equal-highs/lows + recent sweeps from /api/bot/liquidity (S-064)
    SettingsTab.tsx      — Read-only config view (accounts, strategies, halt flag, live/dry per account) from /api/bot/config (S-064); secrets redacted server-side
    Diagnostics.tsx      — Per-endpoint metrics panel (latency, last ok/err, success/error counts) for the in-page diag
  services/
    api.ts               — typed fetchers + BotApiError (httpStatus 0 = network/timeout) + getDashboardSnapshot (Promise.allSettled so one failing endpoint doesn't blank the dashboard) + per-endpoint metrics
    geminiService.ts     — Gemini AI market analysis call
  lib/
    utils.ts             — cn() helper (clsx + tailwind-merge)
  types.ts               — All shared TS interfaces. See § "API Contract" below for nullability notes.
  index.css              — Tailwind v4 imports + custom component classes
  App.tsx                — root component, renders <Dashboard />
  main.tsx               — React 19 createRoot entry point
.github/
  workflows/
    typecheck.yml        — typecheck + build CI gate (M6 correctness pass)
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

`vmHealth.{cpu,memory,disk}` are **nullable** — `null` per field means
the bot's psutil sample failed (ict-trading-bot#556). Render `—`,
not `0%`. A real `0` reading is a measurement and renders as `0%`.

The endpoint returns **HTTP 503** on a structural DB failure (S-067
hardening) — `getDashboardSnapshot` captures this as a partial error
banner; it does not crash the rest of the dashboard.

### `GET /api/bot/logs` → `LogEntry[]`
```json
[
  { "id": "abc123", "timestamp": "2026-05-08T10:00:00Z",
    "level": "trade", "message": "BTC long opened at 62000" }
]
```

### `GET /api/bot/positions` → `Position[]`
```json
[
  { "id": "42", "account": "bybit_2", "symbol": "BTCUSDT",
    "side": "buy", "qty": 0.001, "entryPrice": 62000,
    "unrealizedPnl": 12.45, "openedAt": "2026-05-08T10:00:00Z" }
]
```

`unrealizedPnl` is `COALESCE(pnl, 0)` server-side — non-null. `qty`
and `entryPrice` are passed through without coalesce; the renderer
treats them defensively in case a write path ever leaves them NULL.

### `GET /api/bot/signals` → `Signal[]`
```json
[
  { "id": "abc123", "timestamp": "2026-05-08T10:00:00Z",
    "symbol": "BTCUSDT", "side": "buy", "pattern": "FVG_REVERSAL",
    "confidence": 0.82, "price": 62000 }
]
```

`pattern | confidence | price` are **nullable**. Renderers must skip
rows with null `pattern` rather than aggregate them under "unknown"
(ict-trading-bot#556).

### `GET /api/bot/trades/closed?limit=N&since=ISO_TS` → `ClosedTrade[]`
Closed (live, non-backtest) trades for the Journals + Performance +
Models tabs. Newest-first by closed-at. `limit` clamped 1..200
(default 50); `since` filters by closed-at. (ict-trading-bot#557.)

### `GET /api/bot/liquidity?symbol=X&limit=N&sweeps_limit=N` → `LiquidityResponse`
Per-symbol equal highs / equal lows / recent sweeps. The bot picks a
default symbol when omitted; `available_symbols` is included so the
dropdown reflects what the bot can actually serve. (S-064.)

### `GET /api/bot/config` → `BotConfigResponse`
Read-only effective config for the Settings tab — accounts (allowlist
filtered), strategies (recursive secret-key denylist applied), the
trading-mode halt flag, and per-account live/dry status. The bot
never echoes `api_key_env` / `api_secret_env` field values. (S-064.)

### `GET /api/bot/backtests?limit=N&strategy=X&since=ISO_TS` → `BacktestRun[]`
Backtest history from `trade_journal.db::backtest_results` written by
the M5 consumer (Telegram `/test <strategy>`) and the standalone
harness. Newest-first by `created_at`. Empty `[]` on missing DB / missing
table (fresh install). (M5 P4.)

**Wire-shape note:** `id` is a string (matching `trades/closed` and
`positions`). Count fields (`totalTrades` / `winningTrades` /
`losingTrades`) are nullable — an aborted backtest can land with
NULL counts.

### `GET /api/pnl/history?days=N` → `PnlHistoryPoint[]`
Per-day realised P&L history. **No JWT** — gate dropped in S-063 so the
unauth'd dashboard could consume it. The Performance tab is the primary
consumer; the Dashboard tab's `EquityChart` still uses an in-session
rolling buffer of `stats.totalPnL` (10 min of polled data) for now.

## Equity history note

`EquityChart` on the Dashboard tab consumes a session rolling buffer of
`stats.totalPnL` collected each poll tick (60 ticks × 10s = 10 min of
history, persisted to localStorage so a tab refresh doesn't blank it).
The Performance tab uses the proper bot `/api/pnl/history` feed and
falls back to this in-session buffer on a network/parse failure.

Switching the Dashboard tab's `EquityChart` to `/api/pnl/history` is a
plausible follow-up but tradeoffs: the history feed is daily-bucketed
and won't move within a 10s tick, so the live "watch the curve update"
feel goes away. The current rolling buffer is intentional UX, not a
gap.

## Notes
- `GEMINI_API_KEY` is baked into the JS bundle at build time via Vite `define` — acceptable for a private internal tool
- Tailwind v4 does NOT use `tailwind.config.js`; all theme tokens live in `@theme {}` inside `index.css`
- `vercel.json` SPA rewrite is required for any client-side routing to work after a hard refresh
- `VITE_BOT_API_URL` must NOT have a trailing slash if you set it (default empty triggers the same-origin rewrite path)
- The `FORCED STOP` button in the header is currently visually disabled — the bot doesn't expose an HTTP halt endpoint yet. Wire to a new `POST /api/bot/halt` in a follow-up sprint after the operator approves the Tier-2/3 surface on the bot side.
- `deriveClosedTradesFromLogs` in `services/api.ts` is a deprecated transitional fallback for `/api/bot/trades/closed` 404s. Plan: remove once production Vercel logs confirm the fallback hasn't fired for one full week from 2026-05-09.
