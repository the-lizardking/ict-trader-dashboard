import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Droplets, RefreshCw, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { LiquidityResponse, LiquidityZone } from '../types';
import { BotApiError, describeError, getLiquidity } from '../services/api';
import { cn } from '../lib/utils';

const POLL_MS = 30_000;
const DEFAULT_LIMIT = 25;
const FALLBACK_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

export default function LiquidityMapsTab() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [data, setData] = useState<LiquidityResponse | null>(null);
  const [error, setError] = useState<BotApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);

  const fetchOnce = useCallback(async (sym: string | null) => {
    setLoading(true);
    try {
      const resp = await getLiquidity(sym ?? undefined, DEFAULT_LIMIT);
      if (cancelledRef.current) return;
      setData(resp);
      setError(null);
      // First poll: if the bot picked a default symbol for us, latch
      // it so the dropdown reflects what's being shown.
      if (sym === null && resp.symbol) {
        setSymbol(resp.symbol);
      }
    } catch (err) {
      if (cancelledRef.current) return;
      setError(
        err instanceof BotApiError
          ? err
          : new BotApiError('?', 0, String(err), 'network'),
      );
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    fetchOnce(symbol);
    const id = setInterval(() => fetchOnce(symbol), POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [fetchOnce, symbol]);

  const symbolOptions = useMemo(() => {
    const fromBot = data?.available_symbols ?? [];
    if (fromBot.length > 0) return fromBot;
    return FALLBACK_SYMBOLS;
  }, [data?.available_symbols]);

  const equalHighs = data?.equal_highs ?? [];
  const equalLows = data?.equal_lows ?? [];
  const sweeps = data?.recent_sweeps ?? [];
  const isEmpty =
    data !== null &&
    equalHighs.length === 0 &&
    equalLows.length === 0 &&
    sweeps.length === 0;

  return (
    <div className="space-y-4">
      <Header
        symbol={symbol ?? data?.symbol ?? ''}
        symbolOptions={symbolOptions}
        onSymbolChange={setSymbol}
        loading={loading}
        onRefresh={() => fetchOnce(symbol)}
        asOf={data?.as_of ?? null}
      />

      {error && data === null && <ErrorNotice err={error} />}

      {data === null && !error ? (
        <SkeletonStack />
      ) : isEmpty ? (
        <EmptyState symbol={symbol ?? data?.symbol ?? ''} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <ZoneCard
            title="Equal highs (BSL)"
            subtitle="Buy-side liquidity — stops clustered above"
            zones={equalHighs}
            accent="emerald"
          />
          <ZoneCard
            title="Equal lows (SSL)"
            subtitle="Sell-side liquidity — stops clustered below"
            zones={equalLows}
            accent="red"
          />
        </div>
      )}

      {sweeps.length > 0 && <RecentSweeps sweeps={sweeps} />}
    </div>
  );
}

function Header({
  symbol,
  symbolOptions,
  onSymbolChange,
  loading,
  onRefresh,
  asOf,
}: {
  symbol: string;
  symbolOptions: string[];
  onSymbolChange: (s: string) => void;
  loading: boolean;
  onRefresh: () => void;
  asOf: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <Droplets size={16} className="text-blue-400 shrink-0" />
        <h1 className="text-base font-semibold text-gray-100 truncate">
          Liquidity Maps
        </h1>
        <span className="text-[10px] text-gray-500 hidden sm:inline">
          equal highs / lows · recent sweeps
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <select
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value)}
          className="bg-gray-900/60 text-gray-200 border border-gray-700 rounded-md px-2 py-1.5 text-xs"
          aria-label="Symbol"
        >
          {/* If the bot hasn't told us the active symbol yet, render an
              empty option so the select doesn't blink to the first item. */}
          {symbol === '' && <option value="">—</option>}
          {symbolOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {asOf && (
          <span className="text-[10px] text-gray-500 hidden md:inline tabular-nums">
            {formatAsOf(asOf)}
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-gray-800/60 text-gray-300 border border-gray-700 hover:bg-gray-800 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
    </div>
  );
}

function ZoneCard({
  title,
  subtitle,
  zones,
  accent,
}: {
  title: string;
  subtitle: string;
  zones: LiquidityZone[];
  accent: 'emerald' | 'red';
}) {
  const accentClass =
    accent === 'emerald'
      ? 'text-emerald-400 border-emerald-500/30'
      : 'text-red-400 border-red-500/30';
  const Icon = accent === 'emerald' ? TrendingUp : TrendingDown;
  return (
    <div className="metric-card">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
            <Icon size={14} className={accentClass.split(' ')[0]} />
            {title}
          </h3>
          <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-gray-500 shrink-0">
          {zones.length} zone{zones.length === 1 ? '' : 's'}
        </span>
      </div>
      {zones.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-xs text-gray-500">
          No zones detected.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-gray-800 text-[10px] uppercase tracking-wider text-gray-500">
              <tr className="text-left">
                <th className="px-1 py-1.5 font-medium">Price</th>
                <th className="px-1 py-1.5 font-medium text-right">Touches</th>
                <th className="px-1 py-1.5 font-medium">Last touch</th>
                <th className="px-1 py-1.5 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {zones.map((z) => (
                <tr key={`${z.side}-${z.price}-${z.first_touch}`} className="hover:bg-gray-800/30">
                  <td className="px-1 py-1.5 font-mono tabular-nums text-gray-200">
                    {fmtPrice(z.price)}
                  </td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-gray-300">
                    {z.touches}
                  </td>
                  <td className="px-1 py-1.5 text-gray-400 tabular-nums">
                    {fmtRelative(z.last_touch)}
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    {z.swept ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] text-amber-300"
                        title={
                          z.sweep_time
                            ? `Swept ${fmtRelative(z.sweep_time)}`
                            : 'Swept'
                        }
                      >
                        <Zap size={10} />
                        Swept
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-400">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecentSweeps({ sweeps }: { sweeps: { side: 'buy' | 'sell'; price: number; swept_at: string }[] }) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wider text-gray-500 px-1 mb-2">
        Recent sweeps
      </h3>
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60 border-b border-gray-800 text-[10px] uppercase tracking-wider text-gray-500">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium text-right">Level</th>
              <th className="px-3 py-2 font-medium">Swept</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {sweeps.map((s, i) => (
              <tr key={`${s.swept_at}-${i}`} className="hover:bg-gray-800/30">
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] font-medium',
                      s.side === 'buy' ? 'text-emerald-400' : 'text-red-400',
                    )}
                  >
                    {s.side === 'buy' ? 'BSL ↑' : 'SSL ↓'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-200">
                  {fmtPrice(s.price)}
                </td>
                <td className="px-3 py-2 text-gray-400 tabular-nums">
                  {fmtRelative(s.swept_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyState({ symbol }: { symbol: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-8 text-center">
      <Droplets size={20} className="text-gray-600 mx-auto mb-2" />
      <p className="text-xs text-gray-400">
        No liquidity zones detected for{' '}
        <span className="font-mono text-gray-200">{symbol || '—'}</span> yet.
      </p>
      <p className="text-[10px] text-gray-500 mt-1">
        Zones populate as the pipeline runs detection on each tick — give it a
        few minutes after a fresh bot deploy.
      </p>
    </div>
  );
}

function ErrorNotice({ err }: { err: BotApiError }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
      Liquidity zones unavailable ({describeError(err)}). Will retry every
      30 s — usually means the bot or its <code>/api/bot/liquidity</code>{' '}
      endpoint is rolling.
    </div>
  );
}

function SkeletonStack() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="metric-card animate-pulse h-48" />
      <div className="metric-card animate-pulse h-48" />
    </div>
  );
}

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '—';
  // Crypto prices range wildly; pick precision based on magnitude.
  if (v >= 1000) return v.toFixed(1);
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

function formatAsOf(iso: string): string {
  return `as of ${fmtRelative(iso)}`;
}
