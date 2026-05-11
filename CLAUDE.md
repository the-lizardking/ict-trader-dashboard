# ICT Trader Dashboard — CLAUDE.md

## Project Overview
React 19 + Vite + Tailwind CSS v4 SPA deployed on Vercel.
Calls the ICT Trading Bot's FastAPI (`ict-trading-bot`) REST API for live data.
No server-side code — pure static build.

## Architecture
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

1. `/api/bot/:path*` → `http://158.178.210.252:8001/api/bot/:path*` — proxies dashboard API calls to the bot VPS. Vercel terminates TLS at its edge then makes the upstream HTTP request, so the browser never sees mixed content.
2. `/(.*)` → `/` — SPA catch-all for client-side routing.

Order matters. The API rewrite must come first; otherwise the catch-all eats every request and rewrites it to `/`.

If the bot VPS IP changes, update the destination in `vercel.json` and redeploy. If the bot eventually moves behind a real HTTPS endpoint, drop the rewrite and set `VITE_BOT_API_URL` to the new HTTPS URL.

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
src/
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
