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

try:
    from streamlit_lightweight_charts import renderLightweightCharts as _render_lc
    _LC_AVAILABLE = True
except ImportError:
    _LC_AVAILABLE = False

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
_TV_ENTRY  = "#3d7aed"

# Lightweight Charts overview chart tuning — change these to adjust look/feel
_LC_HEIGHT = 520           # chart height in pixels
_LC_GRID_H = "rgba(42,54,74,0.6)"   # horizontal grid lines
_LC_GRID_V = "rgba(42,54,74,0.0)"   # vertical grid lines (off by default)

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
    page_icon="\U0001f4c8",
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


# ── Data fetching ──────────────────────────────────────────────────────────────

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
    "Overview": "\U0001f3e0", "Live Chart": "\U0001f4ca", "Positions": "\U0001f4cb",
    "Signals": "⚡", "Closed Trades": "✅", "Models": "\U0001f9e0",
    "Backtesting": "\U0001f52c", "Strategies": "♟️", "Health": "\U0001f48a", "Logs": "\U0001f4dc",
}


def render_sidebar() -> str:
    with st.sidebar:
        st.markdown("### \U0001f4c8 ICT Trader")
        st.divider()

        stats, err = _fetch("/api/bot/stats")
        if err:
            st.error("⚠️ Bot unreachable")
        elif stats:
            status = stats.get("status", "unknown")
            icon = {"running": "\U0001f7e2", "paused": "\U0001f7e1", "stopped": "\U0001f534"}.get(status, "⚪")
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


# ── Lightweight Charts helpers ────────────────────────────────────────────────────

def _lc_candle_data(df: pd.DataFrame) -> list[dict]:
    """Convert OHLCV DataFrame to Lightweight Charts candlestick format (unix seconds)."""
    records = []
    for _, row in df.iterrows():
        ts = row["timestamp"]
        if not isinstance(ts, pd.Timestamp):
            ts = pd.Timestamp(ts)
        records.append({
            "time":  int(ts.timestamp()),
            "open":  float(row["open"]),
            "high":  float(row["high"]),
            "low":   float(row["low"]),
            "close": float(row["close"]),
        })
    return records


def _lc_markers(
    signals: list[dict] | None,
    trades:  list[dict] | None,
    symbol:  str,
) -> list[dict]:
    """Build a sorted Lightweight Charts marker list from signals and closed trades.

    Signal direction: accepts both "direction" (LONG/SHORT) and "side" (buy/sell).
    Trade timestamps: accepts both openedAt/closedAt and openTime/closeTime.
    Marker shapes: arrowUp / arrowDown / circle / square
    Positions:     belowBar / aboveBar / inBar
    """
    markers: list[dict] = []

    if signals:
        sdf = pd.DataFrame(signals)
        if "symbol" in sdf.columns:
            sdf = sdf[sdf["symbol"] == symbol]
        if not sdf.empty and "timestamp" in sdf.columns:
            sdf = sdf.copy()
            sdf["ts_utc"] = pd.to_datetime(sdf["timestamp"], errors="coerce", utc=True)
            sdf = sdf.dropna(subset=["ts_utc"])
            for _, row in sdf.iterrows():
                # Resolve direction: "direction" field (LONG/SHORT) takes priority,
                # fall back to "side" field (buy/sell) for other API shapes.
                raw_dir = str(row.get("direction", row.get("side", "buy"))).lower()
                is_long = raw_dir in ("long", "buy")
                markers.append({
                    "time":     int(row["ts_utc"].timestamp()),
                    "position": "belowBar" if is_long else "aboveBar",
                    "color":    _TV_GREEN  if is_long else _TV_RED,
                    "shape":    "arrowUp"  if is_long else "arrowDown",
                    "text":     "LONG"     if is_long else "SHORT",
                })

    if trades:
        tdf = pd.DataFrame(trades)
        if "symbol" in tdf.columns:
            tdf = tdf[tdf["symbol"] == symbol]
        pnl_col   = "realizedPnl" if "realizedPnl" in tdf.columns else None
        # Accept both field-name conventions from different API versions
        open_col  = next((c for c in ("openedAt",  "openTime")  if c in tdf.columns), None)
        close_col = next((c for c in ("closedAt",  "closeTime") if c in tdf.columns), None)

        # Entry markers (blue circle below bar)
        if not tdf.empty and open_col and "entryPrice" in tdf.columns:
            sub = tdf.copy()
            sub["ts_utc"] = pd.to_datetime(sub[open_col], errors="coerce", utc=True)
            sub = sub.dropna(subset=["ts_utc"])
            for _, row in sub.iterrows():
                markers.append({
                    "time":     int(row["ts_utc"].timestamp()),
                    "position": "belowBar",
                    "color":    _TV_ENTRY,
                    "shape":    "circle",
                    "text":     "Entry",
                })

        # Exit markers (green/red arrow above bar)
        if not tdf.empty and close_col and "exitPrice" in tdf.columns:
            sub = tdf.copy()
            sub["ts_utc"] = pd.to_datetime(sub[close_col], errors="coerce", utc=True)
            sub = sub.dropna(subset=["ts_utc"])
            for _, row in sub.iterrows():
                pnl = row.get(pnl_col, 0) if pnl_col else 0
                markers.append({
                    "time":     int(row["ts_utc"].timestamp()),
                    "position": "aboveBar",
                    "color":    _TV_GREEN if (pnl or 0) > 0 else _TV_RED,
                    "shape":    "arrowDown",
                    "text":     "Exit",
                })

    # Lightweight Charts requires markers sorted by time
    markers.sort(key=lambda m: m["time"])
    return markers


def render_overview_chart(
    df: pd.DataFrame,
    signals: list[dict] | None,
    trades:  list[dict] | None,
    symbol:  str,
) -> None:
    """Render a TradingView Lightweight Charts candlestick on the overview tab.

    Extending:
      - Second series (e.g. equity curve): append a second dict to the
        "series" list with type "Line" and its own "data" list.
      - Marker tweaks: edit _lc_markers() above.
      - Height / theme: change _LC_HEIGHT / _TV_BG / _LC_GRID_* at the top.
    """
    if not _LC_AVAILABLE:
        st.warning(
            "Install `streamlit-lightweight-charts` to enable the overview chart.\n"
            "`pip install streamlit-lightweight-charts`"
        )
        return

    candle_data = _lc_candle_data(df)
    markers     = _lc_markers(signals, trades, symbol)

    chart_opts = [{
        "chart": {
            "height": _LC_HEIGHT,
            "layout": {
                "background": {"type": "solid", "color": _TV_BG},
                "textColor":  _TV_TEXT,
            },
            "grid": {
                "vertLines": {"color": _LC_GRID_V},
                "horzLines": {"color": _LC_GRID_H},
            },
            "crosshair": {"mode": 1},
            "rightPriceScale": {"borderColor": "#2a364a", "visible": True},
            "timeScale": {
                "borderColor":    "#2a364a",
                "timeVisible":    True,
                "secondsVisible": False,
            },
            # Touch / mobile: enable horizontal drag and pinch-to-zoom.
            # vertTouchDrag=False prevents the chart stealing page scroll.
            "handleScroll": {
                "mouseWheel":       True,
                "pressedMouseMove": True,
                "horzTouchDrag":    True,
                "vertTouchDrag":    False,
            },
            "handleScale": {
                "axisPressedMouseMove": True,
                "axisDoubleClickReset": True,
                "mouseWheel":           True,
                "pinch":                True,
            },
        },
        "series": [{
            "type": "Candlestick",
            "data": candle_data,
            "options": {
                "upColor":       _TV_GREEN,
                "downColor":     _TV_RED,
                "borderVisible": False,
                "wickUpColor":   _TV_GREEN,
                "wickDownColor": _TV_RED,
            },
            "markers": markers,
        }],
    }]

    _render_lc(chart_opts, key="overview_lc_chart")


# ── Overview ──────────────────────────────────────────────────────────────────

def page_overview(stats: dict | None, stats_err: str | None) -> None:
    st.header("Overview")

    s  = stats or {}
    vm = s.get("vmHealth") or {}

    if stats_err:
        st.warning(f"Stats endpoint error: {stats_err}")
    else:
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("24h PnL",     fmt_usd(s.get("pnl24h")))
        c2.metric("Total PnL",   fmt_usd(s.get("totalPnL")))
        c3.metric("Open trades", s.get("openTrades", 0))
        c4.metric("Win rate",    fmt_pct(s.get("winRate")))

        st.subheader("VM Health")
        h1, h2, h3 = st.columns(3)
        h1.metric("CPU",    fmt_pct(vm.get("cpu")))
        h2.metric("Memory", fmt_pct(vm.get("memory")))
        h3.metric("Disk",   fmt_pct(vm.get("disk")))

    # ── Price chart ─────────────────────────────────────────────────────────────
    st.subheader("Price Overview")
    # Two rows of two so controls stack cleanly on narrow / mobile screens
    oc1, oc2 = st.columns(2)
    with oc1:
        ov_symbol   = st.selectbox("Symbol",   CHART_SYMBOLS,   key="ov_symbol")
    with oc2:
        ov_interval = st.selectbox("Interval", CHART_INTERVALS, index=2, key="ov_interval")
    oc3, oc4, _ = st.columns([1, 1, 4])
    with oc3:
        ov_signals  = st.toggle("Signals", value=True, key="ov_signals")
    with oc4:
        ov_trades   = st.toggle("Trades",  value=True, key="ov_trades")

    df, candles_err = _fetch_candles(ov_symbol, ov_interval)
    if candles_err:
        st.warning(f"Candles unavailable: {candles_err}")
    elif df is None or df.empty:
        st.caption("No candle data.")
    else:
        sig_data = None
        if ov_signals:
            sig_data, _ = _fetch("/api/bot/signals")
        trade_data = None
        if ov_trades:
            trade_data, _ = _fetch(f"/api/bot/trades/closed?limit={DEFAULT_LIMIT}")

        render_overview_chart(df, sig_data, trade_data, ov_symbol)
        st.caption(
            f"Yahoo Finance · {_YF_SYMBOL.get(ov_symbol, ov_symbol)} · {ov_interval} · "
            f"up to 200 candles · auto-refreshes every {POLL_INTERVAL_S}s"
        )

    # ── PnL history (secondary) ─────────────────────────────────────────────────
    with st.expander("Realised PnL — last 30 days"):
        pnl, pnl_err = _fetch("/api/pnl/history?days=30")
        if pnl_err:
            st.info(f"PnL history unavailable: {pnl_err}")
        elif not pnl:
            st.caption("No PnL history yet.")
        else:
            df_pnl = pd.DataFrame(pnl)
            if {"date", "realizedPnl"}.issubset(df_pnl.columns):
                st.line_chart(df_pnl.set_index("date")[["realizedPnl"]])
            else:
                st.json(pnl)


# ── Live Chart ─────────────────────────────────────────────────────────────────

CHART_SYMBOLS   = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]
CHART_INTERVALS = list(_YF_PARAMS.keys())


def page_chart() -> None:
    st.header("Live Chart")

    # ── Controls ─────────────────────────────────────────────────────────────
    r1c1, r1c2 = st.columns([3, 2])
    with r1c1:
        symbol = st.selectbox("Symbol", CHART_SYMBOLS)
    with r1c2:
        interval = st.selectbox("Interval", CHART_INTERVALS, index=2)

    t1, t2, t3, t4 = st.columns(4)
    show_ema20   = t1.toggle("EMA 20",  value=True)
    show_ema50   = t2.toggle("EMA 50",  value=True)
    show_signals = t3.toggle("Signals", value=False)
    show_trades  = t4.toggle("Trades",  value=False)

    # ── Fetch candles ─────────────────────────────────────────────────────────────
    df, candles_err = _fetch_candles(symbol, interval)
    if candles_err:
        st.warning(f"Candles unavailable: {candles_err}")
        return
    if df is None or df.empty:
        st.caption("No candle data.")
        return

    df["ema20"] = df["close"].ewm(span=20, adjust=False).mean()
    df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
    vol_colors = [
        _TV_GREEN if c >= o else _TV_RED
        for c, o in zip(df["close"], df["open"])
    ]

    # ── Build figure ─────────────────────────────────────────────────────────────
    fig = make_subplots(
        rows=2, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.02,
        row_heights=[0.75, 0.25],
    )

    fig.add_trace(go.Candlestick(
        x=df["timestamp"],
        open=df["open"], high=df["high"],
        low=df["low"],   close=df["close"],
        name=symbol,
        increasing=dict(line=dict(color=_TV_GREEN, width=1), fillcolor=_TV_GREEN),
        decreasing=dict(line=dict(color=_TV_RED,   width=1), fillcolor=_TV_RED),
    ), row=1, col=1)

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

    # ── Signals layer ─────────────────────────────────────────────────────────────
    # API shape: {timestamp, symbol, side ("buy"/"sell"), price, pattern, confidence}
    if show_signals:
        signals, sig_err = _fetch("/api/bot/signals")
        if sig_err:
            st.caption(f"Signals: {sig_err}")
        elif signals:
            sdf = pd.DataFrame(signals)
            if "symbol" in sdf.columns:
                sdf = sdf[sdf["symbol"] == symbol]
            if not sdf.empty and "timestamp" in sdf.columns:
                sdf["timestamp"] = pd.to_datetime(sdf["timestamp"], errors="coerce", utc=True)
                sdf["timestamp"] = sdf["timestamp"].dt.tz_localize(None)
                sdf = sdf.dropna(subset=["timestamp"])
            if not sdf.empty:
                last_price = float(df["close"].iloc[-1])
                for side_val, marker_sym, color, label in [
                    ("buy",  "triangle-up",   _TV_GREEN, "Long"),
                    ("sell", "triangle-down",  _TV_RED,   "Short"),
                ]:
                    subset = sdf[sdf["side"] == side_val] if "side" in sdf.columns else pd.DataFrame()
                    if not subset.empty:
                        prices = (
                            subset["price"].fillna(last_price)
                            if "price" in subset.columns
                            else pd.Series([last_price] * len(subset))
                        )
                        hover = (
                            subset["pattern"].fillna("").astype(str)
                            if "pattern" in subset.columns
                            else pd.Series([""] * len(subset))
                        )
                        fig.add_trace(go.Scatter(
                            x=subset["timestamp"],
                            y=prices,
                            mode="markers",
                            name=label,
                            text=hover,
                            marker=dict(
                                symbol=marker_sym, size=14, color=color,
                                line=dict(width=1, color="white"),
                            ),
                            hovertemplate=f"{label} %{{text}}: %{{y:.4g}}<extra></extra>",
                        ), row=1, col=1)

    # ── Trades layer ─────────────────────────────────────────────────────────────
    # API shape: {openedAt, closedAt, entryPrice, exitPrice, realizedPnl,
    #             side ("buy"/"sell"), symbol, closeReason, qty}
    if show_trades:
        trades, tr_err = _fetch(f"/api/bot/trades/closed?limit={DEFAULT_LIMIT}")
        if tr_err:
            st.caption(f"Trades: {tr_err}")
        elif trades:
            tdf = pd.DataFrame(trades)
            if "symbol" in tdf.columns:
                tdf = tdf[tdf["symbol"] == symbol]

            if not tdf.empty:
                pnl_col = "realizedPnl" if "realizedPnl" in tdf.columns else None

                # Entry markers
                if "openedAt" in tdf.columns and "entryPrice" in tdf.columns:
                    tdf["openedAt"] = pd.to_datetime(tdf["openedAt"], errors="coerce", utc=True)
                    tdf["openedAt"] = tdf["openedAt"].dt.tz_localize(None)
                    sub = tdf.dropna(subset=["openedAt", "entryPrice"])
                    if not sub.empty:
                        close_reasons = sub["closeReason"].fillna("") if "closeReason" in sub.columns else pd.Series([""] * len(sub))
                        fig.add_trace(go.Scatter(
                            x=sub["openedAt"],
                            y=sub["entryPrice"],
                            mode="markers",
                            name="Entry",
                            text=close_reasons,
                            marker=dict(
                                symbol="circle", size=9, color=_TV_ENTRY,
                                line=dict(width=1, color="white"),
                            ),
                            hovertemplate="Entry: %{y:.4g}<extra></extra>",
                        ), row=1, col=1)

                # Exit markers
                if "closedAt" in tdf.columns and "exitPrice" in tdf.columns:
                    tdf["closedAt"] = pd.to_datetime(tdf["closedAt"], errors="coerce", utc=True)
                    tdf["closedAt"] = tdf["closedAt"].dt.tz_localize(None)
                    sub = tdf.dropna(subset=["closedAt", "exitPrice"])
                    if not sub.empty:
                        exit_colors = [
                            _TV_GREEN if (pnl_col and (row.get(pnl_col) or 0) > 0) else _TV_RED
                            for _, row in sub.iterrows()
                        ]
                        reasons = sub["closeReason"].fillna("") if "closeReason" in sub.columns else pd.Series([""] * len(sub))
                        fig.add_trace(go.Scatter(
                            x=sub["closedAt"],
                            y=sub["exitPrice"],
                            mode="markers",
                            name="Exit",
                            text=reasons,
                            marker=dict(
                                symbol="x", size=10, color=exit_colors,
                                line=dict(width=2),
                            ),
                            hovertemplate="Exit (%{text}): %{y:.4g}<extra></extra>",
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

    # ── Styling ─────────────────────────────────────────────────────────────
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

    fig.update_xaxes(**_axis)
    fig.update_yaxes(**_axis)
    fig.update_yaxes(side="right", row=1, col=1)
    fig.update_yaxes(side="right", showgrid=False, tickformat=".4s", row=2, col=1)

    st.plotly_chart(fig, use_container_width=True, config=_CHART_CONFIG)
    st.caption(
        f"Yahoo Finance · {_YF_SYMBOL.get(symbol, symbol)} · {interval} · "
        f"EMA 20/50 · up to 200 candles"
    )


# ── Positions ───────────────────────────────────────────────────────────────────

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


# ── Signals ────────────────────────────────────────────────────────────────────

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


# ── Closed Trades ─────────────────────────────────────────────────────────────────

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


# ── Models & Training ──────────────────────────────────────────────────────────────

_STAGE_ICON = {
    "live_approved": "\U0001f7e2", "limited_live": "\U0001f7e1", "shadow": "\U0001f535",
    "backtest_approved": "\U0001f7e4", "candidate": "⚪", "research_only": "⚫",
}

# Operator's 2-bucket deployment view (2026-05-18). Collapses the 7
# registry stages into "is this model influencing real money or just
# observing?":
#   LIVE    — predictions influence trade decisions on live accounts.
#   SHADOW  — predictions logged in real time but decisions unchanged.
#   OFFLINE — model exists in the registry but no strategy references it.
#
# Source of truth: the bot's /api/bot/ml/registry endpoint returns
# ``deployment_bucket`` per row (PR #1391). The dashboard prefers that
# field but falls back to a legacy stage→bucket mapping when the bot
# API hasn't been upgraded yet — this keeps the dashboard rendering
# correctly during a rollout window.
_BUCKET_PILL = {
    "LIVE":    "🟢 LIVE",
    "SHADOW":  "🔵 SHADOW",
    "OFFLINE": "⚫ OFFLINE",
}
_BUCKET_LEGEND = (
    "🟢 LIVE = influencing trade decisions · "
    "🔵 SHADOW = predictions logged real-time, decisions unchanged · "
    "⚫ OFFLINE = registered but no strategy wires it."
)


def _normalize_bucket(row: dict) -> str:
    """Resolve the deployment bucket for a registry row.

    Prefer the bot's `deployment_bucket` field (added in PR #1391).
    Fall back to a legacy stage→bucket map for backward compat while
    the new bot API rolls out.
    """
    bucket = row.get("deployment_bucket")
    if bucket in _BUCKET_PILL:
        return bucket
    stage = row.get("target_deployment_stage") or row.get("stage") or ""
    if stage in ("live_approved", "limited_live", "advisory"):
        return "LIVE"
    if stage == "shadow":
        return "SHADOW"
    return "OFFLINE"


def _format_pill(bucket: str) -> str:
    return _BUCKET_PILL.get(bucket, "❔ UNKNOWN")


def _fmt_age(seconds: float | int | None) -> str:
    if seconds is None:
        return "—"
    s = int(seconds)
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60}m {s % 60}s"
    if s < 86400:
        return f"{s // 3600}h {(s % 3600) // 60}m"
    return f"{s // 86400}d {(s % 86400) // 3600}h"


def _trainer_status_banner(payload: dict) -> None:
    """Top-of-page banner summarizing trainer VM state.

    The trainer runs on a once-a-day systemd timer (``ict-trainer.timer``);
    between cycles the oneshot ``ict-trainer.service`` is ``inactive
    (dead)`` and that is normal, not idle. The banner only flags problems
    when the timer itself is missing/inactive OR the most recent
    completed cycle failed OR the mirror has gone stale far beyond a
    normal between-cycles window.

    State priorities (most-severe first):
      1. ``mirror_missing`` → red (trainer has never published).
      2. ``last_cycle_failed`` → red (last cycle's overall_rc != 0).
      3. ``stale_no_timer`` → red (mirror age > 36 h AND timer not
         active/enabled — really broken).
      4. ``idle_no_timer`` → yellow (no cycles in 24 h AND timer
         inactive — really paused).
      5. ``waiting_for_timer`` → blue/info (timer active, no cycle yet
         today, last cycle succeeded — the normal between-cycles state).
      6. ``healthy`` → green (recent successful cycle and timer active).
    """
    if not payload.get("mirror_present"):
        st.error(
            "🛑 **Trainer mirror missing.** The trainer VM has never published "
            "state, or the publisher (`ict-trainer-publish.timer`) is not "
            "running. Until it does, this page has no visibility."
        )
        return

    status = payload.get("status") or {}
    age = payload.get("mirror_age_seconds")
    age_str = _fmt_age(age)

    svc = (status.get("service") or {})
    timer = (status.get("timer") or {})
    last_cycle = status.get("last_cycle") or {}
    last_rc = status.get("last_cycle_outcome")
    cycles_24h = status.get("cycles_24h", 0)

    svc_active = svc.get("active_state")
    svc_enabled = svc.get("unit_file_state")
    timer_state = timer.get("active_state")
    timer_enabled = timer.get("unit_file_state")

    # Daily-timer architecture: service inactive + timer active+enabled
    # = normal between-cycles waiting state. Only flag if the timer is
    # also missing — that's the real "paused" signal.
    timer_running = timer_state == "active" and timer_enabled == "enabled"
    really_stale = age is not None and age > 36 * 3600  # 36 h
    last_failed = isinstance(last_rc, int) and last_rc != 0
    waiting_for_next_cycle = timer_running and cycles_24h == 0 and not last_failed
    truly_idle = (not timer_running) and cycles_24h == 0

    cols = st.columns(4)
    cols[0].metric("Mirror age", age_str)
    cols[1].metric("Cycles (24 h)", cycles_24h)
    cols[2].metric("Service", f"{svc_active or '?'} / {svc_enabled or '?'}")
    cols[3].metric("Timer", f"{timer_state or '?'} / {timer_enabled or '?'}")

    if last_failed:
        st.error(
            f"❌ **Last cycle failed** at {last_cycle.get('ts', '?')} with rc={last_rc}. "
            "See the Cycle Events table below for which manifest tripped."
        )
    elif really_stale and not timer_running:
        st.error(
            f"⏳ **Trainer silent and timer down** — last publish was {age_str} "
            "ago and `ict-trainer.timer` is not active+enabled. The pipeline "
            "is genuinely paused."
        )
    elif truly_idle:
        st.warning(
            f"💤 **Trainer paused.** Timer is `{timer_state or '?'}/{timer_enabled or '?'}` "
            "and no cycle ran in 24 h. Re-enable via `trainer-vm-diag-request` "
            "(`systemctl enable --now ict-trainer.timer`)."
        )
    elif waiting_for_next_cycle:
        next_trigger = (
            timer.get("next_elapse")
            or timer.get("trigger")
            or timer.get("next_run")
            or "—"
        )
        last_ts = last_cycle.get("ts") or "—"
        st.info(
            f"⏱ **Trainer waiting for next daily cycle.** Timer active; "
            f"next trigger **{next_trigger}**. Last successful cycle at "
            f"`{last_ts}` ({age_str} ago). Service `inactive` between "
            "cycles is normal — this is a oneshot triggered by the timer."
        )
    else:
        st.success(
            f"✅ Trainer healthy — last publish {age_str} ago, "
            f"{cycles_24h} cycle(s) in 24 h."
        )

    head_sha = (status.get("trainer_vm") or {}).get("head_sha")
    role = (status.get("trainer_vm") or {}).get("role")
    if head_sha or role:
        st.caption(f"Trainer VM: `{role or '?'}` · repo HEAD `{head_sha or '?'}`")


def _render_cycle_events(rows: list[dict]) -> None:
    if not rows:
        st.caption("No cycle events mirrored yet.")
        return
    df = pd.DataFrame(rows)
    show_cols = [c for c in (
        "ts", "status", "manifest", "model_id", "exit_code",
        "overall_rc", "head", "stderr_tail",
    ) if c in df.columns]
    if not show_cols:
        st.dataframe(df, hide_index=True, use_container_width=True)
        return
    # Newest first for the table.
    df = df[show_cols].iloc[::-1].reset_index(drop=True)
    st.dataframe(df, hide_index=True, use_container_width=True, height=320)


def _render_build_health(rows: list[dict]) -> None:
    if not rows:
        st.caption("No dataset-build events mirrored yet.")
        return

    # If the most recent ``build_end`` event reports overall_rc=0, the
    # most recent build cycle SUCCEEDED — any earlier `failed` rows in
    # the tail are historical and don't reflect the current state.
    # Render those as an info expander rather than red errors so the
    # page doesn't lie about the trainer being broken when it isn't.
    last_build_end = next(
        (r for r in reversed(rows) if r.get("status") == "build_end"), None
    )
    most_recent_ok = (
        last_build_end is not None
        and (last_build_end.get("overall_rc") in (0, "0", None))
    )

    failed = [r for r in rows if r.get("status") == "failed"]
    skipped = [r for r in rows if r.get("status") == "skipped"]

    if failed and most_recent_ok:
        # Historical context only — the current pipeline is healthy.
        with st.expander(
            f"ℹ️ {len(failed)} historical build failure(s) in the log "
            "(current cycle succeeded — these are resolved)"
        ):
            for row in failed[-5:]:
                family = row.get("family", "?")
                tail = (row.get("stderr_tail") or "").strip()
                st.markdown(f"- **{family}** ({row.get('ts', '?')}) — `{tail[:200]}`")
    elif failed:
        # Most recent cycle had failures — these are live issues.
        st.error(f"❌ {len(failed)} dataset build failure(s) in the recent log. "
                 "These block the manifests that depend on them.")
        for row in failed[-5:]:  # newest 5
            family = row.get("family", "?")
            tail = (row.get("stderr_tail") or "").strip()
            st.markdown(f"- **{family}** ({row.get('ts', '?')}) — `{tail[:200]}`")
    elif last_build_end is None and len(rows) > 0:
        # No build_end marker yet but builds are happening — building
        # right now (cycle in progress) or builds haven't completed.
        st.caption(f"Build cycle in progress — {len(rows)} event(s) so far.")
    else:
        st.success(
            f"✅ Most recent dataset-build cycle succeeded "
            f"({last_build_end.get('ts', '?')})."
        )

    if skipped:
        with st.expander(f"Skipped families ({len(skipped)})"):
            for row in skipped[-10:]:
                st.markdown(
                    f"- **{row.get('family', '?')}** ({row.get('ts', '?')}) — "
                    f"{row.get('detail', '?')}"
                )
    df = pd.DataFrame(rows)
    show_cols = [c for c in ("ts", "status", "family", "exit_code", "stderr_tail", "detail")
                 if c in df.columns]
    if show_cols:
        with st.expander(f"Full build log ({len(rows)} rows)"):
            st.dataframe(df[show_cols].iloc[::-1].reset_index(drop=True),
                         hide_index=True, use_container_width=True, height=240)


def _short_callable(qualname: str | None) -> str:
    """`ml.trainers.lightgbm.LightGBMClassifierTrainer` → `LightGBMClassifierTrainer`."""
    if not isinstance(qualname, str) or not qualname:
        return "—"
    return qualname.rsplit(".", 1)[-1]


def _render_model_card(model_id: str, rows: list[dict]) -> None:
    """One per-model card: deployment pill + linked strategy + about-this-model
    summary + latest run metrics + training history + stage history.

    The card consumes the enriched fields from `/api/bot/ml/registry`
    (PR #1391 in the bot repo): `deployment_bucket`, `linked_strategies`,
    `model_family`, `trainer`, `evaluator`, `dataset_ref`, `latest_run`.
    Falls back gracefully when the bot API hasn't been deployed with
    those fields yet — `_normalize_bucket` derives the bucket from the
    registry stage as a backstop.
    """
    latest = rows[-1]
    bucket = _normalize_bucket(latest)
    pill = _format_pill(bucket)
    stage = latest.get("target_deployment_stage") or latest.get("stage") or "—"
    family = latest.get("model_family") or latest.get("family") or "—"
    linked = latest.get("linked_strategies") or []

    with st.container(border=True):
        # Header — pill + model_id + linked strategy + registry stage
        head_l, head_r = st.columns([3, 1])
        with head_l:
            st.markdown(f"### {pill} · `{model_id}`")
            if linked:
                st.caption(f"**Used by:** {', '.join(linked)}")
            else:
                st.caption("**Used by:** — (no strategy references this model)")
        with head_r:
            st.metric("Registry stage", stage)

        # About — type / class / dataset / decision logic hints
        st.markdown("**About**")
        about_l, about_r = st.columns(2)
        with about_l:
            st.markdown(f"- **Family:** `{family}`")
            trainer = latest.get("trainer")
            if trainer:
                st.markdown(f"- **Trainer:** `{_short_callable(trainer)}`")
            evaluator = latest.get("evaluator")
            if evaluator:
                st.markdown(f"- **Evaluator:** `{_short_callable(evaluator)}`")
        with about_r:
            ds = latest.get("dataset_ref") or latest.get("dataset") or {}
            if isinstance(ds, dict) and ds:
                st.markdown(
                    f"- **Trained on:** `{ds.get('family')}/"
                    f"{ds.get('symbol_scope')}/{ds.get('timeframe')}/{ds.get('version')}`"
                )
            if latest.get("created_at"):
                st.markdown(f"- **First registered:** {latest['created_at']}")
            if latest.get("code_revision"):
                rev = str(latest["code_revision"])[:8]
                st.markdown(f"- **Code revision:** `{rev}`")

        notes = latest.get("notes")
        if notes:
            st.markdown(f"**Notes:** {notes}")

        # Latest run — metrics + run_id + timestamp.
        # Prefer the enriched `latest_run` field (PR #1391). Falls back
        # to the per-run endpoint /api/bot/ml/runs/{model_id}/{run_id}
        # for backward compat.
        latest_run = latest.get("latest_run")
        if isinstance(latest_run, dict) and latest_run:
            with st.expander("📊 Latest run metrics", expanded=True):
                rc1, rc2 = st.columns(2)
                rc1.caption(f"Run: `{latest_run.get('run_id', '—')}`")
                rc2.caption(f"At: {latest_run.get('at', '—')}")
                metrics = latest_run.get("metrics") or {}
                if metrics:
                    st.json(metrics)
                else:
                    st.caption("No metrics recorded for this run.")
        else:
            # Backward-compat: try the per-run endpoint.
            run_id = (
                latest.get("run_id")
                or (latest.get("metrics_path") or "").split("/")[-2]
                or None
            )
            if run_id:
                run_payload, run_err = _fetch(f"/api/bot/ml/runs/{model_id}/{run_id}")
                if run_err:
                    st.caption(f"Run metrics: not mirrored yet ({run_err})")
                else:
                    metrics = (run_payload or {}).get("metrics") or {}
                    if metrics:
                        with st.expander("📊 Latest run metrics", expanded=True):
                            st.json(metrics)

        # Training history — every recorded run with its metrics.
        runs = latest.get("runs") or []
        if isinstance(runs, list) and len(runs) > 1:
            with st.expander(f"📈 Training history ({len(runs)} runs)"):
                history_rows = []
                for r in runs:
                    history_rows.append({
                        "run_id": r.get("run_id"),
                        "at": r.get("at"),
                        **(r.get("metrics") or {}),
                    })
                st.dataframe(
                    pd.DataFrame(history_rows),
                    hide_index=True, use_container_width=True,
                )

        cfg = latest.get("trainer_config") or {}
        if cfg:
            with st.expander("⚙️ Trainer config"):
                st.json(cfg)

        # Stage-transition history (registry mutations over time).
        if len(rows) > 1:
            with st.expander(f"📜 Stage history ({len(rows)} rows)"):
                st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)


def _render_registry(registry_rows: list[dict]) -> None:
    if not registry_rows:
        st.info(
            "📭 **Model registry is empty.** No model has been promoted into "
            "`ml/registry-store/registry.jsonl` yet. This is expected on a "
            "trainer that has not completed a successful training cycle."
        )
        return

    # Group by model_id — the registry is append-only with one row per
    # stage-history event, so a single model may appear N times.
    by_model: dict[str, list[dict]] = {}
    for row in registry_rows:
        mid = row.get("model_id") or "?"
        by_model.setdefault(mid, []).append(row)

    # Roll-up counters for the operator's two-bucket view.
    bucket_counts = {"LIVE": 0, "SHADOW": 0, "OFFLINE": 0}
    for _mid, rows in by_model.items():
        bucket = _normalize_bucket(rows[-1])
        bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Models", len(by_model))
    c2.metric("🟢 LIVE", bucket_counts["LIVE"])
    c3.metric("🔵 SHADOW", bucket_counts["SHADOW"])
    c4.metric("⚫ OFFLINE", bucket_counts["OFFLINE"])
    st.caption(_BUCKET_LEGEND)

    # Render OFFLINE last so the operator sees the actively-deployed
    # models first.
    def _sort_key(item: tuple[str, list[dict]]) -> tuple[int, str]:
        bucket = _normalize_bucket(item[1][-1])
        order = {"LIVE": 0, "SHADOW": 1, "OFFLINE": 2}.get(bucket, 3)
        return (order, item[0])

    for model_id, rows in sorted(by_model.items(), key=_sort_key):
        _render_model_card(model_id, rows)


def page_models() -> None:
    st.header("Models & Training Center")

    # Graceful degradation (2026-05-18): a failed /status fetch used to
    # `return` and blank the whole page. Now we surface a warning and
    # render whatever subsections can fetch — operator still sees the
    # registry, cycle events, and build health even when one endpoint
    # is unreachable.
    status_payload, status_err = _fetch("/api/bot/ml/status")
    if status_err:
        st.warning(
            f"⚠️ Trainer status endpoint unreachable: {status_err}. "
            "Status banner skipped — the rest of the page will still render "
            "with whatever data the other endpoints can fetch."
        )
    else:
        _trainer_status_banner(status_payload or {})

    st.divider()

    # ── Cycle events ────────────────────────────────────────────────
    st.subheader("Cycle Events")
    cycle_payload, cycle_err = _fetch("/api/bot/ml/cycle?limit=100")
    if cycle_err:
        st.caption(f"Cycle log unavailable ({cycle_err}).")
    else:
        rows = (cycle_payload or {}).get("rows", [])
        _render_cycle_events(rows)

    # ── Per-manifest sessions ───────────────────────────────────────
    sess_payload, sess_err = _fetch("/api/bot/ml/sessions")
    if not sess_err:
        sessions = (sess_payload or {}).get("sessions", [])
        ok = [s for s in sessions if s.get("status") == "manifest_ok"]
        bad = [s for s in sessions if s.get("status") == "manifest_failed"]
        skipped = [s for s in sessions if s.get("status") == "manifest_skipped"]
        missing = [s for s in sessions if s.get("status") == "manifest_missing"]
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Manifest OK (recent)", len(ok))
        c2.metric("Manifest failed", len(bad))
        c3.metric("Manifest skipped", len(skipped))
        c4.metric("Manifest missing", len(missing))
        if bad:
            with st.expander(f"Recent failed manifests ({len(bad)})", expanded=True):
                for row in bad[-10:]:
                    st.error(
                        f"**{row.get('manifest', '?')}** "
                        f"(rc={row.get('exit_code', '?')}, {row.get('ts', '?')}) — "
                        f"`{(row.get('stderr_tail') or '').strip()[:240]}`"
                    )
        if skipped:
            # Skipped is not a failure — render as info, not red.
            # Common reason today: dataset has 0 rows (live trader hasn't
            # produced enough closed-trade history yet, or no health-review
            # answers exist for the review_journal family).
            with st.expander(f"Recently skipped manifests ({len(skipped)})"):
                for row in skipped[-10:]:
                    reason = row.get("reason") or "skipped"
                    detail = row.get("detail") or row.get("dataset_path") or ""
                    st.info(
                        f"**{row.get('manifest', '?')}** "
                        f"({row.get('ts', '?')}) — {reason}: `{detail}`"
                    )

    st.divider()

    # ── Dataset build health ────────────────────────────────────────
    st.subheader("Dataset Build Health")
    builds_payload, builds_err = _fetch("/api/bot/ml/builds?limit=100")
    if builds_err:
        st.caption(f"Build log unavailable ({builds_err}).")
    else:
        _render_build_health((builds_payload or {}).get("rows", []))

    # ── DB pull freshness ───────────────────────────────────────────
    pulls_payload, pulls_err = _fetch("/api/bot/ml/db_pulls?limit=20")
    if not pulls_err:
        pull_rows = (pulls_payload or {}).get("rows", [])
        last_done = next(
            (r for r in reversed(pull_rows)
             if r.get("status") == "sync_done" and r.get("overall_rc") == 0),
            None,
        )
        if last_done:
            st.caption(
                f"Last live-VM → trainer DB sync: **{last_done.get('ts', '?')}**"
            )
        elif pull_rows:
            st.caption("DB sync history present but no successful `sync_done` row.")

    st.divider()

    # ── Model registry ──────────────────────────────────────────────
    st.subheader("Model Registry")
    registry_payload, registry_err = _fetch("/api/bot/ml/registry")
    if registry_err:
        st.caption(f"Registry unavailable ({registry_err}).")
        return
    _render_registry((registry_payload or {}).get("rows", []))


# ── Backtesting ──────────────────────────────────────────────────────────────────

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
    m2.metric("Avg win rate",      fmt_pct(df["winRate"].mean()       if "winRate"      in df else None))
    m3.metric("Avg profit factor", f"{df['profitFactor'].mean():.2f}" if "profitFactor" in df else "—")
    m4.metric("Best PnL",  fmt_usd(df["totalPnl"].max() if "totalPnl" in df else None))
    m5.metric("Worst PnL", fmt_usd(df["totalPnl"].min() if "totalPnl" in df else None))

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
            d1.metric("Total Trades",  row.get("totalTrades", "—"))
            d2.metric("Win Rate",      fmt_pct(row.get("winRate")))
            d3.metric("Total PnL",    fmt_usd(row.get("totalPnl")))
            d4.metric("Profit Factor", f"{row.get('profitFactor', 0):.2f}")
            d5, d6, d7, d8 = st.columns(4)
            d5.metric("Winning",    row.get("winningTrades", "—"))
            d6.metric("Losing",     row.get("losingTrades",  "—"))
            d7.metric("Expectancy", fmt_usd(row.get("expectancy")))
            d8.metric("Max DD %",   fmt_pct(row.get("maxDrawdownPct")))


# ── Strategies ───────────────────────────────────────────────────────────────────

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

        st.subheader(f"{'\U0001f7e2' if enabled else '\U0001f534'} {name}")
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
    dispatch.get(page, page_overview)()

    time.sleep(POLL_INTERVAL_S)
    st.rerun()


if __name__ == "__main__":
    main()
