import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickData,
  CandlestickSeriesPartialOptions,
  createChart,
  CrosshairMode,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineStyle,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import { Activity, RefreshCw, TrendingDown, TrendingUp, Wifi, WifiOff } from 'lucide-react';
import { Position, Signal } from '../types';
import { cn } from '../lib/utils';

const TIMEFRAMES = [
  { id: '1', label: '1m', seconds: 60 },
  { id: '5', label: '5m', seconds: 300 },
  { id: '15', label: '15m', seconds: 900 },
  { id: '60', label: '1h', seconds: 3600 },
] as const;

type TimeframeId = (typeof TIMEFRAMES)[number]['id'];

// Bybit public REST is browser-CORS-friendly for /v5/market/* — no proxy
// required. WebSocket stream gives us per-tick kline updates so the
// in-flight candle redraws without waiting on poll cadence.
const BYBIT_REST = 'https://api.bybit.com/v5/market/kline';
const BYBIT_WS = 'wss://stream.bybit.com/v5/public/linear';

interface BybitKlineRow {
  // [start, open, high, low, close, volume, turnover]
  // All strings on the wire — Bybit's v5 schema.
  0: string; 1: string; 2: string; 3: string; 4: string; 5: string; 6: string;
}

interface BybitKlineResponse {
  retCode: number;
  retMsg?: string;
  result?: { list?: BybitKlineRow[] };
}

interface BybitWsKlineMessage {
  topic?: string;
  type?: string;
  data?: Array<{
    start: number;
    end: number;
    interval: string;
    open: string;
    close: string;
    high: string;
    low: string;
    volume: string;
    confirm: boolean;
    timestamp: number;
  }>;
}

function parseRow(row: BybitKlineRow): CandlestickData<UTCTimestamp> {
  return {
    time: Math.floor(parseInt(row[0], 10) / 1000) as UTCTimestamp,
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
  };
}

async function fetchHistory(symbol: string, interval: TimeframeId, limit = 500): Promise<CandlestickData<UTCTimestamp>[]> {
  const url = `${BYBIT_REST}?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
  const json = (await res.json()) as BybitKlineResponse;
  if (json.retCode !== 0) throw new Error(`Bybit retCode ${json.retCode}: ${json.retMsg ?? 'unknown'}`);
  const rows = json.result?.list ?? [];
  // Bybit returns newest-first; lightweight-charts wants oldest-first.
  return rows.map(parseRow).sort((a, b) => (a.time as number) - (b.time as number));
}

const CANDLE_OPTIONS: CandlestickSeriesPartialOptions = {
  upColor: '#10b981',
  downColor: '#ef4444',
  borderUpColor: '#10b981',
  borderDownColor: '#ef4444',
  wickUpColor: '#10b981',
  wickDownColor: '#ef4444',
};

interface LiveChartProps {
  positions: Position[] | null;
  signals: Signal[] | null;
  /** Symbols the dashboard knows about (from positions + bot config). */
  symbols: string[];
}

interface PositionLineRefs {
  entry: IPriceLine;
  tp: IPriceLine | null;
  sl: IPriceLine | null;
}

export default function LiveChart({ positions, signals, symbols }: LiveChartProps) {
  const [symbol, setSymbol] = useState<string>(symbols[0] ?? 'BTCUSDT');
  const [timeframe, setTimeframe] = useState<TimeframeId>('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const [lastPrice, setLastPrice] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const priceLinesRef = useRef<Map<string, PositionLineRefs>>(new Map());

  // Latch the first available symbol once positions land.
  useEffect(() => {
    if (symbols.length > 0 && !symbols.includes(symbol)) {
      setSymbol(symbols[0]);
    }
  }, [symbols, symbol]);

  // Create the chart once; tear down on unmount.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: '#0d1117' },
        textColor: '#9ca3af',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(75, 85, 99, 0.15)' },
        horzLines: { color: 'rgba(75, 85, 99, 0.15)' },
      },
      rightPriceScale: { borderColor: 'rgba(75, 85, 99, 0.4)' },
      timeScale: {
        borderColor: 'rgba(75, 85, 99, 0.4)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addCandlestickSeries(CANDLE_OPTIONS);
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current.clear();
    };
  }, []);

  // Load history + open WS whenever symbol/timeframe changes.
  useEffect(() => {
    let cancelled = false;
    const series = seriesRef.current;
    if (!series) return;
    setLoading(true);
    setError(null);
    setLastPrice(null);
    // Tear down any previous WS before opening a new one — guards against
    // double-subscriptions when the user flips symbols quickly.
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    fetchHistory(symbol, timeframe)
      .then((rows) => {
        if (cancelled) return;
        series.setData(rows);
        if (rows.length > 0) setLastPrice(rows[rows.length - 1].close);
        chartRef.current?.timeScale().fitContent();
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    setWsStatus('connecting');
    const ws = new WebSocket(BYBIT_WS);
    wsRef.current = ws;
    ws.onopen = () => {
      if (cancelled) return;
      setWsStatus('open');
      ws.send(JSON.stringify({ op: 'subscribe', args: [`kline.${timeframe}.${symbol}`] }));
    };
    ws.onmessage = (evt) => {
      if (cancelled || !seriesRef.current) return;
      try {
        const msg = JSON.parse(evt.data) as BybitWsKlineMessage;
        const data = msg.data;
        if (!Array.isArray(data)) return;
        for (const k of data) {
          const candle: CandlestickData<UTCTimestamp> = {
            time: Math.floor(k.start / 1000) as UTCTimestamp,
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
          };
          seriesRef.current.update(candle);
          setLastPrice(candle.close);
        }
      } catch {
        /* malformed frame — drop it */
      }
    };
    ws.onerror = () => {
      if (cancelled) return;
      setWsStatus('closed');
    };
    ws.onclose = () => {
      if (cancelled) return;
      setWsStatus('closed');
    };

    return () => {
      cancelled = true;
      ws.close();
    };
  }, [symbol, timeframe]);

  // Reconcile position price-lines whenever positions or symbol change.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const lines = priceLinesRef.current;
    const wantedIds = new Set<string>();
    const symbolPositions = (positions ?? []).filter((p) => p.symbol === symbol);

    for (const p of symbolPositions) {
      wantedIds.add(p.id);
      const short = isShort(p.side);
      const entryColor = short ? '#fb7185' : '#34d399';
      const existing = lines.get(p.id);
      if (existing) {
        series.removePriceLine(existing.entry);
        if (existing.tp) series.removePriceLine(existing.tp);
        if (existing.sl) series.removePriceLine(existing.sl);
      }
      const entry = series.createPriceLine({
        price: p.entryPrice,
        color: entryColor,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${short ? 'SHORT' : 'LONG'} @ ${fmtPrice(p.entryPrice)}`,
      });
      let tp: IPriceLine | null = null;
      let sl: IPriceLine | null = null;
      if (p.takeProfit != null && Number.isFinite(p.takeProfit)) {
        tp = series.createPriceLine({
          price: p.takeProfit,
          color: '#22d3ee',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `TP ${fmtPrice(p.takeProfit)}`,
        });
      }
      if (p.stopLoss != null && Number.isFinite(p.stopLoss)) {
        sl = series.createPriceLine({
          price: p.stopLoss,
          color: '#f59e0b',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `SL ${fmtPrice(p.stopLoss)}`,
        });
      }
      lines.set(p.id, { entry, tp, sl });
    }
    // Drop lines for positions that disappeared (closed).
    for (const [id, refs] of lines.entries()) {
      if (!wantedIds.has(id)) {
        series.removePriceLine(refs.entry);
        if (refs.tp) series.removePriceLine(refs.tp);
        if (refs.sl) series.removePriceLine(refs.sl);
        lines.delete(id);
      }
    }
  }, [positions, symbol]);

  // Reconcile signal markers whenever signals or symbol change.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const markers: SeriesMarker<Time>[] = [];
    for (const s of signals ?? []) {
      if (s.symbol !== symbol) continue;
      const ts = Date.parse(s.timestamp);
      if (!Number.isFinite(ts)) continue;
      const short = isShort(s.side);
      markers.push({
        time: Math.floor(ts / 1000) as UTCTimestamp,
        position: short ? 'aboveBar' : 'belowBar',
        color: short ? '#ef4444' : '#10b981',
        shape: short ? 'arrowDown' : 'arrowUp',
        text: s.pattern ?? (short ? 'SHORT' : 'LONG'),
        size: 1,
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    series.setMarkers(markers);
  }, [signals, symbol]);

  const symbolPositions = useMemo(
    () => (positions ?? []).filter((p) => p.symbol === symbol),
    [positions, symbol],
  );
  const unrealizedSum = symbolPositions.reduce((acc, p) => acc + (p.unrealizedPnl ?? 0), 0);

  const reload = useCallback(() => {
    // Bump symbol state to itself isn't enough — the effect deps must change.
    // The simplest reload path is to fetch history again and reset.
    if (!seriesRef.current) return;
    setLoading(true);
    setError(null);
    fetchHistory(symbol, timeframe)
      .then((rows) => {
        seriesRef.current?.setData(rows);
        if (rows.length > 0) setLastPrice(rows[rows.length - 1].close);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [symbol, timeframe]);

  return (
    <div className="metric-card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-gray-800">
        <div className="flex items-center gap-2 min-w-0">
          <Activity size={14} className="text-blue-400 shrink-0" />
          <h3 className="text-sm font-semibold text-gray-100">Live Chart</h3>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-gray-900/60 text-gray-200 border border-gray-700 rounded-md px-2 py-1 text-xs font-mono"
            aria-label="Symbol"
          >
            {symbols.length === 0 && <option value={symbol}>{symbol}</option>}
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="hidden sm:flex items-center gap-0.5 bg-gray-900/60 rounded-md p-0.5 border border-gray-700">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.id}
                type="button"
                onClick={() => setTimeframe(tf.id)}
                className={cn(
                  'px-2 py-0.5 text-[11px] rounded font-medium transition-colors',
                  timeframe === tf.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-200',
                )}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          {lastPrice !== null && (
            <span className="font-mono text-gray-100 tabular-nums">{fmtPrice(lastPrice)}</span>
          )}
          {symbolPositions.length > 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-1 font-mono tabular-nums',
                unrealizedSum >= 0 ? 'text-emerald-400' : 'text-red-400',
              )}
              title={`Unrealized PnL across ${symbolPositions.length} open ${symbolPositions.length === 1 ? 'position' : 'positions'} on ${symbol}`}
            >
              {unrealizedSum >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {unrealizedSum >= 0 ? '+' : ''}${unrealizedSum.toFixed(2)}
            </span>
          )}
          <span className="inline-flex items-center gap-1" title={`WebSocket ${wsStatus}`}>
            {wsStatus === 'open' ? (
              <Wifi size={11} className="text-emerald-400" />
            ) : (
              <WifiOff size={11} className={wsStatus === 'connecting' ? 'text-amber-400' : 'text-gray-500'} />
            )}
            <span className="hidden md:inline text-gray-500">{wsStatus}</span>
          </span>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-gray-400 hover:text-gray-200 disabled:opacity-50"
            aria-label="Reload chart"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-500/30">
          Chart error: {error}. Bybit public feed will retry automatically.
        </div>
      )}
      <div ref={containerRef} className="w-full" style={{ height: 360 }} />
      <ChartLegend positions={symbolPositions} />
    </div>
  );
}

function ChartLegend({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <div className="px-3 sm:px-4 py-2 border-t border-gray-800 text-[10px] text-gray-500">
        No open positions on this symbol. Buy/sell signal markers shown above.
      </div>
    );
  }
  return (
    <div className="px-3 sm:px-4 py-2 border-t border-gray-800 text-[10px] text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1">
      {positions.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block w-2 h-2 rounded-full',
              isShort(p.side) ? 'bg-red-400' : 'bg-emerald-400',
            )}
          />
          <span className="font-mono">{p.account}</span>
          <span>·</span>
          <span className="font-mono">{fmtPrice(p.entryPrice)}</span>
          {p.takeProfit != null && (
            <span className="text-cyan-400">TP {fmtPrice(p.takeProfit)}</span>
          )}
          {p.stopLoss != null && (
            <span className="text-amber-400">SL {fmtPrice(p.stopLoss)}</span>
          )}
          <span
            className={cn(
              'font-mono',
              p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
            )}
          >
            {p.unrealizedPnl >= 0 ? '+' : ''}${p.unrealizedPnl.toFixed(2)}
          </span>
        </span>
      ))}
    </div>
  );
}

function isShort(side: string): boolean {
  const s = side.toLowerCase();
  return s === 'sell' || s === 'short';
}

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toFixed(1);
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(4);
}
