"""ICT Trader Dashboard — Streamlit version.

Read-only dashboard for the ICT Trading Bot's FastAPI on the VPS.
Runs on Streamlit Community Cloud (free, server-rendered) so the
upstream call is Python-side — no browser mixed-content block, no
Cloudflare tunnel, no Vercel rewrite.

Background: the Vite/Vercel dashboard was caught between Vercel
Hobby's plain-HTTP outbound block and a fragile chain of Cloudflare
tunnel hostnames (PRs #2 → #22 → #25 → #29 → #30 → #31). The
Streamlit pivot removes the entire transport layer: upstream goes
straight from this Python process to the FastAPI on
158.178.210.252:8001.

Deploy: push this file to GitHub, then go to share.streamlit.io and
point a new app at this repo's `streamlit_app.py`. Free tier (1 app,
1 GB RAM) is plenty for a poll-every-10s read-only dashboard.

Local dev: `pip install -r requirements.txt && streamlit run streamlit_app.py`.
Override the upstream with the BOT_API_URL env var.
"""
from __future__ import annotations

import datetime as dt
import os
from typing import Any

import pandas as pd
import plotly.graph_objects as go
import requests
import streamlit as st
from streamlit_autorefresh import st_autorefresh

BOT_API = os.environ.get("BOT_API_URL", "http://158.178.210.252:8001")
TIMEOUT_S = 10.0
POLL_INTERVAL_S = 10
DEFAULT_LIMIT = 50

st.set_page_config(
    page_title="ICT Trader Dashboard",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Re-run the script every POLL_INTERVAL_S seconds so cached fetches
# expire and the page redraws. Per-poll-interval cache TTL pairs with
# this so each rerun gets fresh data.
st_autorefresh(interval=POLL_INTERVAL_S * 1000, key="poll_tick")


@st.cache_data(ttl=POLL_INTERVAL_S, show_spinner=False)
def _fetch(path: str) -> tuple[Any, str | None]:
    """GET `${BOT_API}{path}` -> (json_or_none, error_message_or_none)."""
    url = f"{BOT_API}{path}"
    try:
        r = requests.get(url, timeout=TIMEOUT_S)
        r.raise_for_status()
        return r.json(), None
    except requests.HTTPError as e:
        return None, f"HTTP {e.response.status_code} on {path}"
    except requests.Timeout:
        return None, f"Timed out after {TIMEOUT_S}s on {path}"
    except requests.RequestException as e:
        return None, f"Network error on {path}: {e}"
    except ValueError as e:
        return None, f"Bad JSON from {path}: {e}"


def fmt_pct(x: float | None) -> str:
    return "—" if x is None else f"{x:.1f}%"


def fmt_usd(x: float | None) -> str:
    return "—" if x is None else f"${x:,.2f}"


def render_header() -> tuple[dict | None, str | None]:
    stats, stats_err = _fetch("/api/bot/stats")
    cols = st.columns([3, 1])
    with cols[0]:
        st.title("ICT Trader Dashboard")
        st.caption(
            f"Live data from `{BOT_API}` · auto-refresh every {POLL_INTERVAL_S}s · "
            f"last poll {dt.datetime.utcnow().strftime('%H:%M:%S UTC')}"
        )
    with cols[1]:
        if stats_err:
            st.error("Bot unreachable")
            st.caption(stats_err)
        elif stats:
            status = stats.get("status", "unknown")
            datasource = stats.get("datasource", "unknown")
            badge = {"running": "✅", "paused": "⏸️", "stopped": "🛑"}.get(status, "❔")
            st.success(f"{badge} {status} · {datasource}")
    return stats, stats_err


def overview_tab(stats: dict | None, stats_err: str | None) -> None:
    if stats_err:
        st.warning(f"Stats endpoint error: {stats_err}")
        return
    s = stats or {}
    vm = s.get("vmHealth") or {}

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("24h PnL", fmt_usd(s.get("pnl24h")))
    c2.metric("Total PnL", fmt_usd(s.get("totalPnL")))
    c3.metric("Open trades", s.get("openTrades", 0))
    c4.metric("Win rate", fmt_pct(s.get("winRate")))

    st.subheader("VM health")
    h1, h2, h3 = st.columns(3)
    h1.metric("CPU", fmt_pct(vm.get("cpu")))
    h2.metric("Memory", fmt_pct(vm.get("memory")))
    h3.metric("Disk", fmt_pct(vm.get("disk")))

    st.subheader("Realised PnL — last 30 days")
    pnl, pnl_err = _fetch("/api/pnl/history?days=30")
    if pnl_err:
        st.info(f"PnL history unavailable: {pnl_err}")
    elif not pnl:
        st.caption("No PnL history yet.")
    else:
        df = pd.DataFrame(pnl)
        if {"date", "realizedPnl"}.issubset(df.columns):
            st.line_chart(df.set_index("date")[["realizedPnl"]])
        else:
            st.json(pnl)


def positions_tab() -> None:
    rows, err = _fetch("/api/bot/positions")
    if err:
        st.warning(err)
        return
    if not rows:
        st.caption("No open positions.")
        return
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)


def signals_tab() -> None:
    rows, err = _fetch("/api/bot/signals")
    if err:
        st.warning(err)
        return
    if not rows:
        st.caption("No recent signals.")
        return
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)


def trades_tab() -> None:
    rows, err = _fetch(f"/api/bot/trades/closed?limit={DEFAULT_LIMIT}")
    if err:
        st.warning(err)
        return
    if not rows:
        st.caption("No closed trades.")
        return
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)


def logs_tab() -> None:
    rows, err = _fetch("/api/bot/logs")
    if err:
        st.warning(err)
        return
    if not rows:
        st.caption("No log entries.")
        return
    st.dataframe(
        pd.DataFrame(rows), hide_index=True, use_container_width=True, height=600
    )


def health_tab() -> None:
    services, services_err = _fetch("/api/bot/health/services")
    latest, latest_err = _fetch("/api/bot/health/latest")

    st.subheader("Systemd services")
    if services_err:
        st.warning(services_err)
    elif services and services.get("services"):
        st.dataframe(
            pd.DataFrame(services["services"]),
            hide_index=True,
            use_container_width=True,
        )
    else:
        st.caption("No service data.")

    st.subheader("Latest health snapshot")
    if latest_err:
        st.warning(latest_err)
    elif latest and latest.get("present") and latest.get("snapshot"):
        st.json(latest["snapshot"])
    else:
        st.caption("No snapshot available.")


def chart_tab() -> None:
    candles, candles_err = _fetch("/api/bot/candles/BTCUSDT?limit=100")
    signals, signals_err = _fetch("/api/bot/signals")
    positions, positions_err = _fetch("/api/bot/positions")

    if candles_err:
        st.warning(f"Candles unavailable: {candles_err}")
        return

    if not candles:
        st.caption("No candle data available.")
        return

    df = pd.DataFrame(candles)
    required_cols = {"timestamp", "open", "high", "low", "close"}
    if not required_cols.issubset(df.columns):
        st.json(candles[:3])
        return

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp")

    fig = go.Figure()
    fig.add_trace(go.Candlestick(
        x=df["timestamp"],
        open=df["open"],
        high=df["high"],
        low=df["low"],
        close=df["close"],
        name="BTCUSDT"
    ))

    if not signals_err and signals:
        signals_df = pd.DataFrame(signals)
        signals_df = signals_df[signals_df["symbol"] == "BTCUSDT"]
        if not signals_df.empty:
            signals_df["timestamp"] = pd.to_datetime(signals_df["timestamp"])
            for _, sig in signals_df.iterrows():
                color = "green" if sig.get("direction") == "LONG" else "red"
                fig.add_trace(go.Scatter(
                    x=[sig["timestamp"]],
                    y=[sig.get("price", df["close"].iloc[-1])],
                    mode="markers",
                    marker=dict(size=10, color=color, symbol="triangle-up" if sig.get("direction") == "LONG" else "triangle-down"),
                    name=f"Signal: {sig.get('pattern', 'N/A')}",
                    hovertext=f"{sig.get('pattern', 'N/A')}<br>Conf: {sig.get('confidence', 0):.1%}"
                ))

    if not positions_err and positions:
        positions_df = pd.DataFrame(positions)
        positions_df = positions_df[positions_df["symbol"] == "BTCUSDT"]
        if not positions_df.empty:
            for _, pos in positions_df.iterrows():
                entry = pos.get("entryPrice")
                if entry:
                    fig.add_hline(y=entry, line_dash="dash", line_color="blue", annotation_text=f"Entry: ${entry:,.2f}")
                sl = pos.get("stopLoss")
                if sl:
                    fig.add_hline(y=sl, line_dash="dash", line_color="red", annotation_text=f"SL: ${sl:,.2f}")
                tp = pos.get("takeProfit")
                if tp:
                    fig.add_hline(y=tp, line_dash="dash", line_color="green", annotation_text=f"TP: ${tp:,.2f}")

    fig.update_layout(
        title="BTCUSDT Live Chart",
        xaxis_title="Time",
        yaxis_title="Price (USD)",
        template="plotly_dark",
        hovermode="x unified",
        height=600
    )
    st.plotly_chart(fig, use_container_width=True)


def main() -> None:
    stats, stats_err = render_header()
    tab_names = ["Overview", "BTCUSDT Chart", "Positions", "Signals", "Closed trades", "Logs", "Health"]
    tabs = st.tabs(tab_names)
    with tabs[0]:
        overview_tab(stats, stats_err)
    with tabs[1]:
        chart_tab()
    with tabs[2]:
        positions_tab()
    with tabs[3]:
        signals_tab()
    with tabs[4]:
        trades_tab()
    with tabs[5]:
        logs_tab()
    with tabs[6]:
        health_tab()


if __name__ == "__main__":
    main()
