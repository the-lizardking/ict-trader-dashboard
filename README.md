# ICT Trader Dashboard

Read-only live dashboard for the ICT Trading Bot's FastAPI on the VPS.
Server-rendered Streamlit app on Streamlit Community Cloud (free).

## Architecture

```
Browser ──HTTPS──▶ Streamlit Community Cloud ──HTTP──▶ VPS FastAPI :8001
                   (Python server, free tier)         (158.178.210.252)
```

The Python server makes the upstream call directly. No browser
mixed-content block, no Cloudflare tunnel, no Vercel rewrite, no
transport-layer moving parts.

## Deploy on Streamlit Community Cloud (one-time, operator)

1. Push to `main` (this is your GitHub deploy trigger).
2. <https://share.streamlit.io> → sign in with the operator's GitHub.
3. **New app** → `benbaichmankass/ict-trader-dashboard` → branch `main`
   → main file `streamlit_app.py` → **Deploy**.
4. Streamlit Cloud auto-redeploys on every push to `main`.

Optional: in the app's **Settings → Secrets** tab, set
`BOT_API_URL = "http://158.178.210.252:8001"` if the VPS IP ever changes
(this is the hardcoded default, so you can skip it).

## Local dev

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
# Override the upstream:
# BOT_API_URL=http://localhost:8001 streamlit run streamlit_app.py
```

## Tabs

| Tab | Endpoints |
|---|---|
| Overview | `/api/bot/stats`, `/api/pnl/history?days=30` |
| Positions | `/api/bot/positions` |
| Signals | `/api/bot/signals` |
| Closed trades | `/api/bot/trades/closed?limit=50` |
| Logs | `/api/bot/logs` |
| Health | `/api/bot/health/services`, `/api/bot/health/latest` |

Full API contract: [`ict-trading-bot/CLAUDE.md`](https://github.com/benbaichmankass/ict-trading-bot/blob/main/CLAUDE.md) § Dashboard REST API.

## Why not React + Vercel

The dashboard was a Vite/React SPA on Vercel for its first 5 days. Five
different transport architectures (direct HTTP, Vercel Edge Function,
Cloudflare Worker, CF quick tunnel, named CF tunnel) were all tried
because Vercel Hobby blocks plain-HTTP outbound from rewrites and from
user functions. The Streamlit pivot eliminates the entire problem.
Full rationale: [`CLAUDE.md`](./CLAUDE.md) § "Why not React + Vercel"
and [the audit doc in the bot repo](https://github.com/benbaichmankass/ict-trading-bot/blob/main/docs/audit/vercel-edge-vs-cf-worker.md).

**Do not reintroduce React + Vercel for this dashboard.** If a future
feature needs a richer UI, see CLAUDE.md for the alternatives to
consider first.
