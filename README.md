# ICT Trader Dashboard

Read-only live dashboard for the ICT Trading Bot's FastAPI on the VPS.

## Current architecture (Streamlit, May 2026)

```
Browser ──HTTPS──▶ Streamlit Community Cloud ──HTTP──▶ VPS FastAPI :8001
                   (Python server, free tier)         (158.178.210.252)
```

The Streamlit Python server makes the upstream call directly. The
browser only sees Streamlit's HTTPS-rendered page, so there is no
mixed-content block. **No Cloudflare tunnel, no Vercel rewrite, no
transport-layer moving parts.**

### Deploy on Streamlit Community Cloud (one-time, operator)

1. Push this repo to GitHub (already done if you're reading this).
2. Sign into <https://share.streamlit.io> with the operator's GitHub account.
3. Click **New app** → pick `benbaichmankass/ict-trader-dashboard`
   → branch `main` → main file `streamlit_app.py` → **Deploy**.
4. Streamlit Cloud auto-redeploys on every push to `main`.

Optional: set `BOT_API_URL` in the app's **Settings → Secrets** tab if the
VPS IP ever changes (e.g. `BOT_API_URL = "http://1.2.3.4:8001"`). The
default baked into the script is `http://158.178.210.252:8001`.

### Local dev

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
# Override the upstream:
# BOT_API_URL=http://localhost:8001 streamlit run streamlit_app.py
```

### Tabs

| Tab | Endpoint(s) |
|---|---|
| Overview | `/api/bot/stats`, `/api/pnl/history?days=30` |
| Positions | `/api/bot/positions` |
| Signals | `/api/bot/signals` |
| Closed trades | `/api/bot/trades/closed?limit=50` |
| Logs | `/api/bot/logs` |
| Health | `/api/bot/health/services`, `/api/bot/health/latest` |

Full API contract: [`ict-trading-bot/CLAUDE.md`](https://github.com/benbaichmankass/ict-trading-bot/blob/main/CLAUDE.md) § Dashboard REST API.

## Legacy architecture (React + Vite + Vercel)

The React app is still in the repo (`src/`, `vercel.json`, `index.html`,
`vite.config.ts`, `package.json`) and still deployed on Vercel as a
fallback. It calls the bot API via Vercel's rewrite → Cloudflare named
tunnel → VPS FastAPI. Once the Streamlit dashboard has been verified
stable in production for ~24h, the following can be retired in a cleanup
PR:

- the React source (`src/`, `index.html`, `vite.config.ts`, `tsconfig.json`)
- `package.json` and `package-lock.json`
- `vercel.json`
- the `cf-worker/` directory in `ict-trading-bot`
- `ict-cloudflared-tunnel.service` on the VM (via the existing
  `teardown-cloudflare-tunnel` operator action)

Why the migration: see [`CLAUDE.md`](./CLAUDE.md) § "Streamlit migration
(adopted 2026-05-12)".
