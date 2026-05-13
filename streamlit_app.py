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
import yfinance as yf
from plotly.subplots import make_subplots

BOT_API = os.environ.get("BOT_API_URL", "http://158.178.210.252:8001")
TIMEOUT_S = 10.0
POLL_INTERVAL_S = 10
DEFAULT_LIMIT = 50

# Yahoo Finance ticker mapping (dashboard uses BTCUSDT style for signal matching)
_YF_SYMBOL: dict[str, str] = {
    "BTCUSDT": "BTC-USD",
    "ETHUSDT": "ETH-USD",
    "SOLUSDT": "SOL-USD",
    "BNBUSDT": "BNB-USD",
    "XRPUSDT": "XRP-USD",
}

# yfinance interval + download period that yields ~200 bars per interval label
_YF_PARAMS: dict[str, dict] = {
    "1m":  {"interval": "1m",  "period": "1d"},
    "5m":  {"interval": "5m",  "period": "5d"},
    "15m": {"interval": "15m", "period": "20d"},
    "1h":  {"interval": "1h",  "period": "30d"},
    "4h":  {"interval": "1h",  "period": "60d"},   # resampled after fetch
    "1d":  {"interval": "1d",  "period": "2y"},
}

# TradingView-inspired palette
_TV_BG     = "#131722"
_TV_GRID   = "#1e2634"
_TV_GREEN  = "#26a69a"
_TV_RED    = "#ef5350"
_TV_TEXT   = "#b2b5be"
_TV_EMA20  = "#f5a623"
_TV_EMA50  = "#9b59b6"
_TV_SIGNAL_LONG  = "#26a69a"
_TV_SIGNAL_SHORT = "#ef5350"
_TV_ENTRY  = "#3d7aed"

_CHART_CONFIG = {
    "scrollZoom": True,
    "displayModeBar": True,
    "modeBarButtonsToRemove": [
        "toImage", "sendDataToCloud", "lasso2d", "select2d", "autoScale2d",
    ],
    "displaylogo": False,
}

st.set_page_config(
    page_title="ICT Trader",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

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


@st.cache_data(ttl=30, show_spinner=False)
def _fetch_candles(
    symbol: str, interval: str, limit: int = 200
) -> tuple[pd.DataFrame | None, str | None]:
    try:
        params = _YF_PARAMS.get(interval, _YF_PARAMS["15m"])
        yf_symbol = _YF_SYMBOL.get(symbol, symbol.replace("USDT", "-USD"))

        raw = yf.download(
            yf_symbol,
            period=params["period"],
            interval=params["interval"],
            progress=False,
            auto_adjust=True,
        )
        if raw.empty:
            return None, f"No data returned for {yf_symbol}"

        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.get_level_values(0)

        if interval == "4h":
            raw = raw.resample("4h").agg({
                "Open": "first", "High": "max",
                "Low": "min", "Close": "last", "Volume": "sum",
            }).dropna()

        raw = raw.tail(limit)
        ts = raw.index
        if hasattr(ts, "tz") and ts.tz is not None:
            ts = ts.tz_convert("UTC").tz_localize(None)

        df = pd.DataFrame({
            "timestamp": ts,
            "open":   raw["Open"].to_numpy(),
            "high":   raw["High"].to_numpy(),
            "low":    raw["Low"].to_numpy(),
            "close":  raw["Close"].to_numpy(),
            "volume": raw["Volume"].to_numpy(),
        })
        return df, None
    except Exception as exc:  # noqa: BLE001
        return None, f"Candle fetch error: {exc}"


def fmt_pct(x: float | None) -> str:
    return "—" if x is None else f"{x:.1f}%"


def fmt_usd(x: float | None) -> str:
    return "—" if x is None else f"${x:,.2f}"


# ── Sidebar ───────────────────────────────────────────────────────────────────

PAGES = [
    "Overview", "Live Chart", "Positions", "Signals",
    "Closed Trades", "Models", "Backtesting", "Strategies",
    "Health", "Logs",
]

PAGE_ICONS = {
    "Overview": "🏠", "Live Chart": "📊", "Positions": "📋",
    "Signals": "⚡", "Closed Trades": "✅", "Models": "🧠",
    "Backtesting": "🔬", "Strategies": "♟️", "Health": "💊", "Logs": "📜",
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
            "nav", PAGES,
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

CHART_SYMBOLS  = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]
CHART_INTERVALS = list(_YF_PARAMS.keys())


def page_chart() -> None:
    st.header("Live Chart")

    # ── Controls ────────────────────────────────────────────────────
    r1c1, r1c2 = st.columns([3, 2])
    with r1c1:
        symbol = st.selectbox("Symbol", CHART_SYMBOLS)
    with r1c2:
        interval = st.selectbox("Interval", CHART_INTERVALS, index=2)

    t1, t2, t3, t4 = st.columns(4)
    show_ema20    = t1.toggle("EMA 20",   value=True)
    show_ema50    = t2.toggle("EMA 50",   value=True)
    show_signals  = t3.toggle("Signals",  value=False)
    show_trades   = t4.toggle("Trades",   value=False)

    # ── Fetch candles ─────────────────────────────────────────────
    df, candles_err = _fetch_candles(symbol, interval)
    if candles_err:
        st.warning(f"Candles unavailable: {candles_err}")
        return
    if df is None or df.empty:
        st.caption("No candle data.")
        return

    # Derived series
    df["ema20"] = df["close"].ewm(span=20, adjust=False).mean()
    df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
    vol_colors = [
        _TV_GREEN if c >= o else _TV_RED
        for c, o in zip(df["close"], df["open"])
    ]

    # ── Build figure ────────────────────────────────────────────
    fig = make_subplots(
        rows=2, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.02,
        row_heights=[0.75, 0.25],
    )

    # Candlesticks
    fig.add_trace(go.Candlestick(
        x=df["timestamp"],
        open=df["open"], high=df["high"],
        low=df["low"],   close=df["close"],
        name=symbol,
        increasing=dict(line=dict(color=_TV_GREEN, width=1), fillcolor=_TV_GREEN),
        decreasing=dict(line=dict(color=_TV_RED,   width=1), fillcolor=_TV_RED),
    ), row=1, col=1)

    # EMA lines
    if show_ema20:
        fig.add_trace(go.Scatter(
            x=df["timestamp"], y=df["ema20"],
            name="EMA 20",
            line=dict(color=_TV_EMA20, width=1.5),
            hovertemplate="EMA 20: %{y:.4g}<extra></extra>",
        ), row=1, col=1)

    if show_ema50:
        fig.add_trace(go.Scatter(
            x=df["timestamp"], y=df["ema50"],
            name="EMA 50",
            line=dict(color=_TV_EMA50, width=1.5),
            hovertemplate="EMA 50: %{y:.4g}<extra></extra>",
        ), row=1, col=1)

    # Signals layer
    if show_signals:
        signals, _ = _fetch("/api/bot/signals")
        if signals:
            sdf = pd.DataFrame(signals)
            if "symbol" in sdf.columns:
                sdf = sdf[sdf["symbol"] == symbol]
            if not sdf.empty and "timestamp" in sdf.columns:
                sdf["timestamp"] = pd.to_datetime(sdf["timestamp"])
                last_price = float(df["close"].iloc[-1])
                for direction, marker_sym, color, label in [
                    ("LONG",  "triangle-up",   _TV_SIGNAL_LONG,  "Long signal"),
                    ("SHORT", "triangle-down",  _TV_SIGNAL_SHORT, "Short signal"),
                ]:
                    subset = (
                        sdf[sdf["direction"] == direction]
                        if "direction" in sdf.columns else pd.DataFrame()
                    )
                    if not subset.empty:
                        fig.add_trace(go.Scatter(
                            x=subset["timestamp"],
                            y=subset["price"] if "price" in subset.columns
                              else [last_price] * len(subset),
                            mode="markers", name=label,
                            marker=dict(symbol=marker_sym, size=14, color=color,
                                        line=dict(width=1, color="white")),
                        ), row=1, col=1)

    # Trades layer
    if show_trades:
        trades, _ = _fetch(f"/api/bot/trades/closed?limit={DEFAULT_LIMIT}")
        if trades:
            tdf = pd.DataFrame(trades)
            if "symbol" in tdf.columns:
                tdf = tdf[tdf["symbol"] == symbol]
            if not tdf.empty:
                pnl_col = "realizedPnl" if "realizedPnl" in tdf.columns else None
                if "openTime" in tdf.columns and "entryPrice" in tdf.columns:
                    tdf["openTime"] = pd.to_datetime(tdf["openTime"])
                    fig.add_trace(go.Scatter(
                        x=tdf["openTime"], y=tdf["entryPrice"],
                        mode="markers", name="Entry",
                        marker=dict(symbol="circle", size=9, color=_TV_ENTRY,
                                    line=dict(width=1, color="white")),
                    ), row=1, col=1)
                if "closeTime" in tdf.columns and "exitPrice" in tdf.columns:
                    tdf["closeTime"] = pd.to_datetime(tdf["closeTime"])
                    exit_colors = [
                        _TV_GREEN if (pnl_col and row.get(pnl_col, 0) > 0) else _TV_RED
                        for _, row in tdf.iterrows()
                    ]
                    fig.add_trace(go.Scatter(
                        x=tdf["closeTime"], y=tdf["exitPrice"],
                        mode="markers", name="Exit",
                        marker=dict(symbol="x", size=10, color=exit_colors,
                                    line=dict(width=2)),
                    ), row=1, col=1)

    # Volume bars
    fig.add_trace(go.Bar(
        x=df["timestamp"], y=df["volume"],
        name="Volume",
        marker_color=vol_colors,
        opacity=0.7,
        showlegend=False,
        hovertemplate="Vol: %{y:.4s}<extra></extra>",
    ), row=2, col=1)

    # ── Styling ──────────────────────────────────────────────────
    _axis = dict(
        gridcolor=_TV_GRID, gridwidth=1,
        color=_TV_TEXT, tickfont=dict(color=_TV_TEXT, size=10),
        linecolor=_TV_GRID, zerolinecolor=_TV_GRID,
        showspikes=True, spikemode="across", spikesnap="cursor",
        spikecolor=_TV_TEXT, spikethickness=1, spikedash="dot",
    )

    fig.update_layout(
        template="plotly_dark",
        plot_bgcolor=_TV_BG,
        paper_bgcolor=_TV_BG,
        hovermode="x unified",
        height=700,
        margin=dict(l=0, r=70, t=10, b=0),
        dragmode="pan",
        xaxis_rangeslider_visible=False,
        legend=dict(
            orientation="h", y=1.02, x=0,
            font=dict(size=11, color=_TV_TEXT),
            bgcolor="rgba(0,0,0,0)",
        ),
        font=dict(color=_TV_TEXT, size=11),
        hoverlabel=dict(
            bgcolor="#1e2634", bordercolor=_TV_GRID,
            font=dict(color=_TV_TEXT, size=12),
        ),
    )

    # Price axis on the right (row 1), volume axis (row 2)
    fig.update_xaxes(**_axis)
    fig.update_yaxes(**_axis)
    fig.update_yaxes(side="right", row=1, col=1)
    fig.update_yaxes(side="right", showgrid=False, tickformat=".4s", row=2, col=1)

    st.plotly_chart(fig, use_container_width=True, config=_CHART_CONFIG)
    st.caption(
        f"Yahoo Finance · {_YF_SYMBOL.get(symbol, symbol)} · {interval} · "
        f"EMA 20/50 · up to 200 candles"
    )


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
    "live_approved": "🟢", "limited_live": "🟡", "shadow": "🔵",
    "backtest_approved": "🟤", "candidate": "⚪", "research_only": "⚫",
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
        done   = [s for s in sessions_list if s.get("status") == "completed"]
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
                    st.error(f"**{sess.get('model_id', '?')}** — {sess.get('error', 'unknown error')}")

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
        stage    = model.get("target_deployment_stage", "unknown")
        icon     = _STAGE_ICON.get(stage, "❔")
        model_id = model.get("model_id", "?")
        family   = model.get("model_family", "?")

        with st.expander(f"{icon} {model_id} · {family} · `{stage}`"):
            m1, m2, m3 = st.columns(3)
            m1.metric("Trainer",   model.get("trainer",   "?").split(".")[-1])
            m2.metric("Evaluator", model.get("evaluator", "?").split(".")[-1])
            m3.metric("Stage", stage)

            ds = model.get("dataset") or {}
            if ds:
                st.markdown(
                    f"**Dataset:** `{ds.get('family')}/{ds.get('symbol_scope')}"
                    f"/{ds.get('timeframe')}/{ds.get('version')}`"
                )

            if model.get("notes"):
                st.caption(model["notes"])

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
        st.info("No backtest results yet. Run `python -m src.backtest.run_backtest` to populate.")
        return

    df = pd.DataFrame(rows)

    st.subheader("Summary")
    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Total runs", len(df))
    m2.metric("Avg win rate",     fmt_pct(df["winRate"].mean()      if "winRate"      in df else None))
    m3.metric("Avg profit factor",f"{df['profitFactor'].mean():.2f}" if "profitFactor" in df else "—")
    m4.metric("Best PnL",   fmt_usd(df["totalPnl"].max() if "totalPnl" in df else None))
    m5.metric("Worst PnL",  fmt_usd(df["totalPnl"].min() if "totalPnl" in df else None))

    if {"winRate", "runDate"}.issubset(df.columns):
        st.subheader("Win Rate Over Runs")
        chart_df = df[["runDate", "winRate", "totalPnl"]].sort_values("runDate")
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=chart_df["runDate"], y=chart_df["winRate"],
            name="Win Rate %", line=dict(color="#3d7aed", width=2),
            mode="lines+markers", marker=dict(size=6),
        ))
        fig.add_trace(go.Bar(
            x=chart_df["runDate"], y=chart_df["totalPnl"],
            name="Total PnL",
            marker_color=["#22c55e" if v >= 0 else "#ef4444" for v in chart_df["totalPnl"]],
            yaxis="y2", opacity=0.5,
        ))
        fig.update_layout(
            template="plotly_dark", plot_bgcolor="#060c1a", paper_bgcolor="#060c1a",
            height=300, margin=dict(l=0, r=0, t=10, b=0),
            yaxis=dict(title="Win Rate %"),
            yaxis2=dict(title="PnL", overlaying="y", side="right"),
            legend=dict(orientation="h", y=1.05),
        )
        st.plotly_chart(fig, use_container_width=True)

    st.subheader("All Runs")
    col_map = {
        "id": "ID", "strategy": "Strategy", "runDate": "Run Date",
        "startDate": "Start", "endDate": "End", "totalTrades": "Trades",
        "winRate": "Win %", "profitFactor": "PF", "expectancy": "Expectancy",
        "sharpeRatio": "Sharpe", "maxDrawdownPct": "Max DD %", "totalPnl": "PnL",
    }
    display_cols = [c for c in col_map if c in df.columns]
    st.dataframe(df[display_cols].rename(columns=col_map), hide_index=True, use_container_width=True)

    if "id" in df.columns:
        st.subheader("Run Detail")
        selected_id = st.selectbox("Select run ID", df["id"].tolist())
        if selected_id:
            row = df[df["id"] == selected_id].iloc[0].to_dict()
            d1, d2, d3, d4 = st.columns(4)
            d1.metric("Total Trades", row.get("totalTrades", "—"))
            d2.metric("Win Rate",     fmt_pct(row.get("winRate")))
            d3.metric("Total PnL",   fmt_usd(row.get("totalPnl")))
            d4.metric("Profit Factor", f"{row.get('profitFactor', 0):.2f}")
            d5, d6, d7, d8 = st.columns(4)
            d5.metric("Winning",    row.get("winningTrades", "—"))
            d6.metric("Losing",     row.get("losingTrades",  "—"))
            d7.metric("Expectancy", fmt_usd(row.get("expectancy")))
            d8.metric("Max DD %",   fmt_pct(row.get("maxDrawdownPct")))


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
        name      = strat.get("name", "")
        enabled   = strat.get("enabled", True)
        risk_pct  = strat.get("risk_pct")
        timeframe = strat.get("timeframe", "—")
        symbols   = ", ".join(strat.get("symbols") or []) or "—"
        stats     = strat.get("stats") or {}
        desc      = strat.get("description") or {}
        changelog = strat.get("changelog") or []

        st.subheader(f"{'🟢' if enabled else '🔴'} {name}")
        st.caption(desc.get("short", ""))

        m1, m2, m3, m4, m5, m6 = st.columns(6)
        m1.metric("Timeframe",    timeframe)
        m2.metric("Risk/trade",   f"{risk_pct}%" if risk_pct is not None else "—")
        m3.metric("Symbols",      symbols)
        m4.metric("Total trades", stats.get("total_trades", 0))
        m5.metric("Win rate",     fmt_pct(stats.get("win_rate_pct")))
        m6.metric("Total PnL",   fmt_usd(stats.get("total_pnl")))

        exit_reasons = stats.get("exit_reasons") or {}
        if exit_reasons:
            total = stats.get("total_trades") or 1
            reason_cols = st.columns(len(exit_reasons))
            for col, (reason, count) in zip(reason_cols, sorted(exit_reasons.items())):
                col.metric(reason, count, f"{count / total * 100:.0f}%")

        if (desc or {}).get("how_it_works"):
            with st.expander("How it works"):
                st.write(desc["how_it_works"])
        if strat.get("config"):
            with st.expander("Config parameters"):
                st.json(strat["config"])
        if changelog:
            with st.expander(f"Update log ({len(changelog)} entries)"):
                st.dataframe(pd.DataFrame(changelog), hide_index=True, use_container_width=True)
        st.divider()


# ── Health ────────────────────────────────────────────────────────────────────

def page_health() -> None:
    st.header("System Health")
    services, services_err = _fetch("/api/bot/health/services")
    latest, latest_err     = _fetch("/api/bot/health/latest")

    st.subheader("Systemd services")
    if services_err:
        st.warning(services_err)
    elif services and services.get("services"):
        st.dataframe(pd.DataFrame(services["services"]), hide_index=True, use_container_width=True)
    else:
        st.caption("No service data.")

    st.subheader("Latest health snapshot")
    if latest_err:
        st.warning(latest_err)
    elif latest and latest.get("present") and latest.get("snapshot"):
        snap = latest["snapshot"]
        s1, s2, s3 = st.columns(3)
        s1.metric("CPU",    fmt_pct(snap.get("cpu_percent")))
        s2.metric("Memory", fmt_pct(snap.get("memory_percent")))
        s3.metric("Disk",   fmt_pct(snap.get("disk_percent")))
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
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True, height=600)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    page = render_sidebar()
    stats, stats_err = _fetch("/api/bot/stats")

    dispatch = {
        "Overview":      lambda: page_overview(stats, stats_err),
        "Live Chart":    page_chart,
        "Positions":     page_positions,
        "Signals":       page_signals,
        "Closed Trades": page_trades,
        "Models":        page_models,
        "Backtesting":   page_backtesting,
        "Strategies":    page_strategies,
        "Health":        page_health,
        "Logs":          page_logs,
    }
    dispatch.get(page, page_overview)()  # type: ignore[operator]

    time.sleep(POLL_INTERVAL_S)
    st.rerun()


if __name__ == "__main__":
    main()
