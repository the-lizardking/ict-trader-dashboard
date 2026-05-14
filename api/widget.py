"""ICT Trader — adaptive home-screen widget API.

Aggregates the bot's read-only REST endpoints into a single JSON payload
sized for a phone home-screen PWA widget. Read-only; no VM changes.

Bot endpoints consumed (HTTP, port 8001):
    GET /api/bot/stats              -> P&L, status, VM health
    GET /api/bot/strategies         -> per-strategy enabled flag (green dots)
    GET /api/bot/health/services    -> systemd unit liveness
    GET /api/bot/trades/closed      -> last N closed trades for the 24h table

Deployed as a Vercel Python serverless function. Override the bot host
with BOT_API_URL (e.g. for Cloudflare Pages preview against a stub).
"""
from __future__ import annotations

import datetime as dt
import os
from typing import Any

import requests
from fastapi import FastAPI
from fastapi.responses import JSONResponse

BOT_API = os.environ.get("BOT_API_URL", "http://158.178.210.252:8001")
TIMEOUT_S = 6.0
TRADES_LIMIT = 50

# systemd unit-name substrings used to derive widget-level health dots.
_EXEC_HINTS = ("ict-bot", "ict-web-api", "ict-trader")
_TRAIN_HINTS = ("ict-trainer",)

app = FastAPI(title="ict-trader-widget", version="1.0")


def _fetch(path: str) -> Any:
    try:
        r = requests.get(f"{BOT_API}{path}", timeout=TIMEOUT_S)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def _service_up(services: list[dict] | None, hints: tuple[str, ...]) -> bool | None:
    if not services:
        return None
    matched = False
    for svc in services:
        name = (svc.get("name") or svc.get("unit") or "").lower()
        if not any(h in name for h in hints):
            continue
        matched = True
        state = (svc.get("active_state") or svc.get("state") or "").lower()
        if state == "active":
            return True
    return False if matched else None


def _strategy_dots(strategies_payload: dict | None) -> list[dict]:
    return [
        {"name": s.get("name", "?"), "up": bool(s.get("enabled"))}
        for s in (strategies_payload or {}).get("strategies") or []
    ]


def _parse_iso(ts: str | None) -> dt.datetime | None:
    if not ts:
        return None
    try:
        parsed = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def _recent_trades(trades: list[dict] | None) -> list[dict]:
    if not trades:
        return []
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)
    rows: list[dict] = []
    for t in trades:
        ts = _parse_iso(t.get("closedAt") or t.get("closeTime") or t.get("openedAt"))
        if ts is None or ts < cutoff:
            continue
        rows.append({
            "time":   ts.isoformat(),
            "symbol": t.get("symbol"),
            "side":   t.get("side"),
            "size":   t.get("qty"),
            "pnl":    t.get("realizedPnl"),
        })
    rows.sort(key=lambda r: r["time"], reverse=True)
    return rows


def _build_payload() -> dict:
    stats = _fetch("/api/bot/stats") or {}
    strategies = _fetch("/api/bot/strategies")
    services_resp = _fetch("/api/bot/health/services") or {}
    trades = _fetch(f"/api/bot/trades/closed?limit={TRADES_LIMIT}")

    svc_list = services_resp.get("services") if isinstance(services_resp, dict) else None

    return {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "pnl24h":   stats.get("pnl24h"),
        "pnlTotal": stats.get("totalPnL"),
        "status":   (stats.get("status") or "unknown").upper(),
        "systems": {
            "strategies": _strategy_dots(strategies),
            "execution":  _service_up(svc_list, _EXEC_HINTS),
            "training":   _service_up(svc_list, _TRAIN_HINTS),
        },
        "trades24h": _recent_trades(trades),
    }


@app.get("/api/widget")
@app.get("/api/widget.json")
def widget() -> JSONResponse:
    return JSONResponse(
        _build_payload(),
        headers={
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
        },
    )


# Vercel's @vercel/python runtime auto-detects the `app` ASGI export.
