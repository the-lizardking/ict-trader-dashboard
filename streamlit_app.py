"""ICT Trader Dashboard — Streamlit version with sidebar navigation.

Read-only dashboard for the ICT Trading Bot's FastAPI on the VPS.
Sidebar navigation is collapsible (hamburger on mobile) and the
pages render one at a time so there is no wasted network round-trip
for hidden tabs.

Local dev: `pip install -r requirements.txt && streamlit run streamlit_app.py`
Override the upstream with the BOT_API_URL env var.
"""
from __future__ import annotations

import datetime as dt
import os
import time
from typing import Any

import pandas as pd
import plotly.graph_objects as go
import requests
import streamlit as st

BOT_API = os.environ.get("BOT_API_URL", "http://158.178.210.252:8001")
TIMEOUT_S = 10.0
POLL_INTERVAL_S = 10
DEFAULT_LIMIT = 50

st.set_page_config(
    page_title="ICT Trader",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# st.html() injects the block directly into the page without markdown
# processing — avoids Streamlit Cloud stripping <style> from st.markdown.
st.html("""
<style>
  [data-testid="stSidebar"] {
      background: linear-gradient(180deg, #050c1a 0%, #091428 100%);
      border-right: 1px solid #182040;
  }
  [data-testid="stSidebar"] .stRadio > div { gap: 2px; }
  [data-testid="stSidebar"] .stRadio label { padding: 6px 8px; border-radius: 6px; }
  [data-testid="stSidebar"] .stRadio label:hover { background: #182040; }
  [data-testid="stMetric"] {
      background: #0d1628;
      border: 1px solid #1a2840;
      border-radius: 8px;
      padding: 0.6rem 0.8rem;
  }
  .main .block-container { padding-top: 1.2rem; }
  @media (max-width: 640px) {
      [data-testid="column"] { min-width: 100% !important; }
  }
</style>
""")


# ── Data fetching ─────────────────────────────────────────────────────────────

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


# ── Sidebar ───────────────────────────────────────────────────────────────────

PAGES = [
    "Overview",
    "Live Chart",
    "Positions",
    "Signals",
    "Closed Trades",
    "Models",
    "Backtesting",
    "Strategies",
    "Health",
    "Logs",
]

PAGE_ICONS = {
    "Overview": "🏠",
    "Live Chart": "📊",
    "Positions": "📋",
    "Signals": "⚡",
    "Closed Trades": "✅",
    "Models": "🧠",
    "Backtesting": "🔬",
    "Strategies": "♟️",
    "Health": "💊",
    "Logs": "📜",
}


def render_sidebar() -> str:
    with st.sidebar:
        st.markdown("### 📈 ICT Trader")
        st.divider()

        stats, err = _fetch("/api/bot/stats")
        if err:
            st.error("⚠️ Bot unreachable")
        elif stats:
            status = stats.get("status", "unknown")
            icon = {"running": "🟢", "paused": "🟡", "stopped": "🔴"}.get(status, "⚪")
            st.caption(f"{icon} **{status.upper()}** · {stats.get('datasource', '?')}")

        st.caption(f"⏱ {dt.datetime.utcnow().strftime('%H:%M:%S')} UTC")
        st.divider()

        page = st.radio(
            "nav",
            PAGES,
            format_func=lambda p: f"{PAGE_ICONS.get(p, '')} {p}",
            label_visibility="collapsed",
        )

        st.divider()
        st.caption(f"Auto-refresh every {POLL_INTERVAL_S}s")

    return page  # type: ignore[return-value]


# ── Overview ──────────────────────────────────────────────────────────────────

def page_overview(stats: dict | None, stats_err: str | None) -> None:
    st.header("Overview")
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

    st.subheader("VM Health")
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


# ── Live Chart ────────────────────────────────────────────────────────────────

def page_chart() -> None:
    st.header("BTCUSDT Live Chart")
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
    if not {"timestamp", "open", "high", "low", "close"}.issubset(df.columns):
        st.json(candles[:3])
        return

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp")

    fig = go.Figure()
    fig.add_trace(go.Candlestick(
        x=df["timestamp"], open=df["open"],
        high=df["high"], low=df["low"], close=df["close"],
        name="BTCUSDT",
    ))

    if not signals_err and signals:
        sdf = pd.DataFrame(signals)
        sdf = sdf[sdf["symbol"] == "BTCUSDT"]
        if not sdf.empty:
            sdf["timestamp"] = pd.to_datetime(sdf["timestamp"])
            for _, sig in sdf.iterrows():
                color = "green" if sig.get("direction") == "LONG" else "red"
                fig.add_trace(go.Scatter(
                    x=[sig["timestamp"]],
                    y=[sig.get("price", df["close"].iloc[-1])],
                    mode="markers",
                    marker=dict(
                        size=10, color=color,
                        symbol="triangle-up" if sig.get("direction") == "LONG" else "triangle-down",
                    ),
                    name=f"Signal: {sig.get('pattern', 'N/A')}",
                ))

    if not positions_err and positions:
        pdf = pd.DataFrame(positions)
        pdf = pdf[pdf["symbol"] == "BTCUSDT"]
        if not pdf.empty:
            for _, pos in pdf.iterrows():
                for level, label, color in [
                    ("entryPrice", "Entry", "#3d7aed"),
                    ("stopLoss", "SL", "#ef4444"),
                    ("takeProfit", "TP", "#22c55e"),
                ]:
                    val = pos.get(level)
                    if val:
                        fig.add_hline(
                            y=val, line_dash="dash", line_color=color,
                            annotation_text=f"{label}: ${val:,.2f}",
                        )

    fig.update_layout(
        template="plotly_dark",
        plot_bgcolor="#060c1a",
        paper_bgcolor="#060c1a",
        hovermode="x unified",
        height=600,
        margin=dict(l=0, r=0, t=20, b=0),
        xaxis_title="Time",
        yaxis_title="Price (USD)",
    )
    st.plotly_chart(fig, use_container_width=True)


# ── Positions ─────────────────────────────────────────────────────────────────

def page_positions() -> None:
    st.header("Open Positions")
    rows, err = _fetch("/api/bot/positions")
    if err:
        st.warning(err)
        return
    if not rows:
        st.caption("No open positions.")
        return
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)


# ── Signals ───────────────────────────────────────────────────────────────────

def page_signals() -> None:
    st.header("Signals")
    rows, err = _fetch("/api/bot/signals")
    if err:
        st.warning(err)
        return
    if not rows:
        st.caption("No recent signals.")
        return
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)


# ── Closed Trades ─────────────────────────────────────────────────────────────

def page_trades() -> None:
    st.header("Closed Trades")
    rows, err = _fetch(f"/api/bot/trades/closed?limit={DEFAULT_LIMIT}")
    if err:
        st.warning(err)
        return
    if not rows:
        st.caption("No closed trades.")
        return
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)


# ── Models & Training ─────────────────────────────────────────────────────────

_STAGE_ICON = {
    "live_approved": "🟢",
    "limited_live": "🟡",
    "shadow": "🔵",
    "backtest_approved": "🟤",
    "candidate": "⚪",
    "research_only": "⚫",
}


def page_models() -> None:
    st.header("Models & Training")

    st.subheader("VM Trainer Sessions")
    sessions, sessions_err = _fetch("/api/bot/ml/sessions")

    if sessions_err:
        st.info(
            "Training session endpoint not yet available — "
            "will populate once the VM trainer exposes `/api/bot/ml/sessions`."
        )
        with st.expander("What will appear here once wired up"):
            st.markdown("""
- **Active runs** — model ID, trainer, dataset, elapsed time, epoch progress bar
- **Completed sessions** — final eval metrics and deployment stage reached
- **Failed runs** — error summary and last log line
            """)
    else:
        sessions_list: list = (
            sessions if isinstance(sessions, list)
            else (sessions or {}).get("sessions", [])
        )
        active = [s for s in sessions_list if s.get("status") == "running"]
        done = [s for s in sessions_list if s.get("status") == "completed"]
        failed = [s for s in sessions_list if s.get("status") == "failed"]

        c1, c2, c3 = st.columns(3)
        c1.metric("Active", len(active))
        c2.metric("Completed", len(done))
        c3.metric("Failed", len(failed))

        if active:
            st.markdown("**Active runs**")
            for sess in active:
                with st.container(border=True):
                    left, right = st.columns([3, 1])
                    with left:
                        st.markdown(f"**{sess.get('model_id', '?')}** · `{sess.get('trainer', '?')}`")
                        st.caption(
                            f"Dataset: {sess.get('dataset', '?')} · "
                            f"Stage: {sess.get('target_stage', '?')}"
                        )
                    with right:
                        elapsed = sess.get("elapsed_seconds", 0)
                        st.metric("Elapsed", f"{int(elapsed // 60)}m {int(elapsed % 60)}s")
                    epoch = sess.get("current_epoch")
                    total = sess.get("total_epochs")
                    if epoch and total:
                        st.progress(epoch / total, text=f"Epoch {epoch}/{total}")

        if done:
            with st.expander(f"Completed sessions ({len(done)})"):
                st.dataframe(pd.DataFrame(done), hide_index=True, use_container_width=True)

        if failed:
            with st.expander(f"Failed runs ({len(failed)})", expanded=True):
                for sess in failed:
                    st.error(
                        f"**{sess.get('model_id', '?')}** — {sess.get('error', 'unknown error')}"
                    )

    st.divider()

    st.subheader("Model Registry")
    registry, registry_err = _fetch("/api/bot/ml/registry")

    if registry_err:
        st.info("Model registry endpoint not yet available.")
        return

    models: list = (
        registry if isinstance(registry, list)
        else (registry or {}).get("models", [])
    )
    if not models:
        st.caption("No models registered yet.")
        return

    for model in models:
        stage = model.get("target_deployment_stage", "unknown")
        icon = _STAGE_ICON.get(stage, "❔")
        model_id = model.get("model_id", "?")
        family = model.get("model_family", "?")

        with st.expander(f"{icon} {model_id} · {family} · `{stage}`"):
            m1, m2, m3 = st.columns(3)
            m1.metric("Trainer", model.get("trainer", "?").split(".")[-1])
            m2.metric("Evaluator", model.get("evaluator", "?").split(".")[-1])
            m3.metric("Stage", stage)

            ds = model.get("dataset") or {}
            if ds:
                st.markdown(
                    f"**Dataset:** "
                    f"`{ds.get('family')}/{ds.get('symbol_scope')}"
                    f"/{ds.get('timeframe')}/{ds.get('version')}`"
                )

            notes = model.get("notes", "")
            if notes:
                st.caption(notes)

            cfg = model.get("trainer_config") or {}
            if cfg:
                with st.expander("Trainer config"):
                    st.json(cfg)


# ── Backtesting ───────────────────────────────────────────────────────────────

def page_backtesting() -> None:
    st.header("Backtesting")

    col_f, col_l = st.columns([3, 1])
    with col_f:
        strategy_filter = st.text_input("Filter by strategy", placeholder="e.g. ict-v1")
    with col_l:
        limit = st.selectbox("Show", [25, 50, 100, 200], index=1)

    path = f"/api/bot/backtests?limit={limit}"
    if strategy_filter.strip():
        path += f"&strategy={strategy_filter.strip()}"

    rows, err = _fetch(path)

    if err:
        st.warning(f"Backtests endpoint error: {err}")
        return
    if not rows:
        st.info(
            "No backtest results yet. "
            "Run `python -m src.backtest.run_backtest` to populate."
        )
        return

    df = pd.DataFrame(rows)

    st.subheader("Summary")
    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Total runs", len(df))
    m2.metric(
        "Avg win rate",
        fmt_pct(df["winRate"].mean() if "winRate" in df else None),
    )
    m3.metric(
        "Avg profit factor",
        f"{df['profitFactor'].mean():.2f}" if "profitFactor" in df else "—",
    )
    m4.metric("Best PnL", fmt_usd(df["totalPnl"].max() if "totalPnl" in df else None))
    m5.metric("Worst PnL", fmt_usd(df["totalPnl"].min() if "totalPnl" in df else None))

    if {"winRate", "runDate"}.issubset(df.columns):
        st.subheader("Win Rate Over Runs")
        chart_df = df[["runDate", "winRate", "totalPnl"]].sort_values("runDate")
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=chart_df["runDate"],
            y=chart_df["winRate"],
            name="Win Rate %",
            line=dict(color="#3d7aed", width=2),
            mode="lines+markers",
            marker=dict(size=6),
        ))
        fig.add_trace(go.Bar(
            x=chart_df["runDate"],
            y=chart_df["totalPnl"],
            name="Total PnL",
            marker_color=[
                "#22c55e" if v >= 0 else "#ef4444"
                for v in chart_df["totalPnl"]
            ],
            yaxis="y2",
            opacity=0.5,
        ))
        fig.update_layout(
            template="plotly_dark",
            plot_bgcolor="#060c1a",
            paper_bgcolor="#060c1a",
            height=300,
            margin=dict(l=0, r=0, t=10, b=0),
            yaxis=dict(title="Win Rate %"),
            yaxis2=dict(title="PnL", overlaying="y", side="right"),
            legend=dict(orientation="h", y=1.05),
        )
        st.plotly_chart(fig, use_container_width=True)

    st.subheader("All Runs")
    col_map = {
        "id": "ID",
        "strategy": "Strategy",
        "runDate": "Run Date",
        "startDate": "Start",
        "endDate": "End",
        "totalTrades": "Trades",
        "winRate": "Win %",
        "profitFactor": "PF",
        "expectancy": "Expectancy",
        "sharpeRatio": "Sharpe",
        "maxDrawdownPct": "Max DD %",
        "totalPnl": "PnL",
    }
    display_cols = [c for c in col_map if c in df.columns]
    st.dataframe(
        df[display_cols].rename(columns=col_map),
        hide_index=True,
        use_container_width=True,
    )

    if "id" in df.columns:
        st.subheader("Run Detail")
        selected_id = st.selectbox("Select run ID", df["id"].tolist())
        if selected_id:
            row = df[df["id"] == selected_id].iloc[0].to_dict()
            d1, d2, d3, d4 = st.columns(4)
            d1.metric("Total Trades", row.get("totalTrades", "—"))
            d2.metric("Win Rate", fmt_pct(row.get("winRate")))
            d3.metric("Total PnL", fmt_usd(row.get("totalPnl")))
            d4.metric("Profit Factor", f"{row.get('profitFactor', 0):.2f}")

            d5, d6, d7, d8 = st.columns(4)
            d5.metric("Winning", row.get("winningTrades", "—"))
            d6.metric("Losing", row.get("losingTrades", "—"))
            d7.metric("Expectancy", fmt_usd(row.get("expectancy")))
            d8.metric("Max DD %", fmt_pct(row.get("maxDrawdownPct")))


# ── Strategies ────────────────────────────────────────────────────────────────

def page_strategies() -> None:
    st.header("Strategies")
    data, err = _fetch("/api/bot/strategies")
    if err:
        st.warning(err)
        return
    strategies = (data or {}).get("strategies") or []
    if not strategies:
        st.caption("No strategy data available.")
        return

    for strat in strategies:
        name = strat.get("name", "")
        enabled = strat.get("enabled", True)
        risk_pct = strat.get("risk_pct")
        timeframe = strat.get("timeframe", "—")
        symbols = ", ".join(strat.get("symbols") or []) or "—"
        stats = strat.get("stats") or {}
        desc = strat.get("description") or {}
        changelog = strat.get("changelog") or []

        badge = "🟢" if enabled else "🔴"
        st.subheader(f"{badge} {name}")
        st.caption(desc.get("short", ""))

        m1, m2, m3, m4, m5, m6 = st.columns(6)
        m1.metric("Timeframe", timeframe)
        m2.metric("Risk/trade", f"{risk_pct}%" if risk_pct is not None else "—")
        m3.metric("Symbols", symbols)
        m4.metric("Total trades", stats.get("total_trades", 0))
        m5.metric("Win rate", fmt_pct(stats.get("win_rate_pct")))
        m6.metric("Total PnL", fmt_usd(stats.get("total_pnl")))

        exit_reasons = stats.get("exit_reasons") or {}
        if exit_reasons:
            total = stats.get("total_trades") or 1
            reason_cols = st.columns(len(exit_reasons))
            for col, (reason, count) in zip(reason_cols, sorted(exit_reasons.items())):
                col.metric(reason, count, f"{count / total * 100:.0f}%")

        how = (desc or {}).get("how_it_works", "")
        if how:
            with st.expander("How it works"):
                st.write(how)

        cfg = strat.get("config") or {}
        if cfg:
            with st.expander("Config parameters"):
                st.json(cfg)

        if changelog:
            with st.expander(f"Update log ({len(changelog)} entries)"):
                st.dataframe(pd.DataFrame(changelog), hide_index=True, use_container_width=True)

        st.divider()


# ── Health ────────────────────────────────────────────────────────────────────

def page_health() -> None:
    st.header("System Health")
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
        snap = latest["snapshot"]
        s1, s2, s3 = st.columns(3)
        s1.metric("CPU", fmt_pct(snap.get("cpu_percent")))
        s2.metric("Memory", fmt_pct(snap.get("memory_percent")))
        s3.metric("Disk", fmt_pct(snap.get("disk_percent")))
        with st.expander("Raw snapshot"):
            st.json(snap)
    else:
        st.caption("No snapshot available.")


# ── Logs ──────────────────────────────────────────────────────────────────────

def page_logs() -> None:
    st.header("Logs")
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


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    page = render_sidebar()
    stats, stats_err = _fetch("/api/bot/stats")

    dispatch = {
        "Overview": lambda: page_overview(stats, stats_err),
        "Live Chart": page_chart,
        "Positions": page_positions,
        "Signals": page_signals,
        "Closed Trades": page_trades,
        "Models": page_models,
        "Backtesting": page_backtesting,
        "Strategies": page_strategies,
        "Health": page_health,
        "Logs": page_logs,
    }
    dispatch.get(page, page_overview)()  # type: ignore[operator]

    # Pure-Python polling: page is fully rendered above; sleep server-side
    # then rerun so st.cache_data TTLs expire and data stays fresh.
    # Widget interactions (sidebar clicks) will interrupt and trigger an
    # immediate rerun, so navigation responsiveness is not affected.
    time.sleep(POLL_INTERVAL_S)
    st.rerun()


if __name__ == "__main__":
    main()
