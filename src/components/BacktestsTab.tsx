import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Filter, RefreshCw } from 'lucide-react';
import { BacktestRun } from '../types';
import { getBacktests, BotApiError, describeError } from '../services/api';
import { cn } from '../lib/utils';

const POLL_MS = 30_000;
const DEFAULT_LIMIT = 50;

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  // Bot returns YYYY-MM-DD; render as-is so the column stays narrow.
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

function formatMetric(
  v: number | null | undefined,
  digits: number,
  suffix = '',
): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits) + suffix;
}

function pnlClass(v: number | null | undefined): string {
  if (v == null) return 'text-gray-400';
  return v >= 0 ? 'text-emerald-400' : 'text-red-400';
}

export default function BacktestsTab() {
  const [runs, setRuns] = useState<BacktestRun[] | null>(null);
  const [error, setError] = useState<BotApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const [strategyFilter, setStrategyFilter] = useState<string>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const cancelledRef = useRef(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      // Always fetch unfiltered + filter client-side so the
      // strategy-dropdown roster reflects everything currently in
      // the table (the bot's exact-match filter would hide it).
      const data = await getBacktests(DEFAULT_LIMIT);
      if (cancelledRef.current) return;
      setRuns(data);
      setError(null);
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
    fetchRuns();
    const id = setInterval(fetchRuns, POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [fetchRuns]);

  const strategies = useMemo(() => {
    if (!runs) return [];
    const set = new Set<string>();
    for (const r of runs) if (r.strategy) set.add(r.strategy);
    return Array.from(set).sort();
  }, [runs]);

  const filtered = useMemo(() => {
    if (!runs) return [];
    if (strategyFilter === 'all') return runs;
    return runs.filter((r) => r.strategy === strategyFilter);
  }, [runs, strategyFilter]);

  const summary = useMemo(() => {
    if (filtered.length === 0) return null;
    const totalPnl = filtered.reduce(
      (acc, r) => acc + (r.totalPnl ?? 0),
      0,
    );
    const totalTrades = filtered.reduce(
      (acc, r) => acc + (r.totalTrades ?? 0),
      0,
    );
    return {
      runs: filtered.length,
      totalTrades,
      totalPnl,
    };
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FlaskConical size={16} className="text-blue-400 shrink-0" />
          <h1 className="text-base font-semibold text-gray-100 truncate">
            Backtests
          </h1>
          <span
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30"
            title="Backed by /api/bot/backtests — populated by the M5 /test consumer"
          >
            M5
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors',
              filtersOpen
                ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                : 'bg-gray-800/60 text-gray-300 border-gray-700 hover:bg-gray-800',
            )}
          >
            <Filter size={12} />
            Filters
          </button>
          <button
            type="button"
            onClick={fetchRuns}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-gray-800/60 text-gray-300 border border-gray-700 hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 sm:p-4">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-gray-500 max-w-xs">
            Strategy
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All</option>
              {strategies.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="metric-card">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              Runs
            </p>
            <p className="text-lg font-semibold text-gray-100 mt-0.5">
              {summary.runs}
            </p>
          </div>
          <div className="metric-card">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              Total trades (across runs)
            </p>
            <p className="text-lg font-semibold text-gray-100 mt-0.5 tabular-nums">
              {summary.totalTrades}
            </p>
          </div>
          <div className="metric-card">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              Aggregate PnL
            </p>
            <p
              className={cn(
                'text-lg font-semibold mt-0.5 tabular-nums',
                pnlClass(summary.totalPnl),
              )}
            >
              {summary.totalPnl >= 0 ? '+' : ''}
              {summary.totalPnl.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200">
          Failed to load backtests ({describeError(error)}). The bot may be
          offline, or the `/api/bot/backtests` endpoint is not yet deployed
          on this VM.
        </div>
      )}

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-900/60 border-b border-gray-800">
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 font-medium">Strategy</th>
                <th className="px-3 py-2 font-medium">Window</th>
                <th className="px-3 py-2 font-medium text-right">Trades</th>
                <th className="px-3 py-2 font-medium text-right">Win %</th>
                <th className="px-3 py-2 font-medium text-right">PF</th>
                <th className="px-3 py-2 font-medium text-right">Expectancy</th>
                <th className="px-3 py-2 font-medium text-right">Sharpe</th>
                <th className="px-3 py-2 font-medium text-right">Max DD %</th>
                <th className="px-3 py-2 font-medium text-right">Total PnL</th>
                <th className="px-3 py-2 font-medium text-right">id</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {runs === null && !error && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-gray-500">
                    Loading backtests…
                  </td>
                </tr>
              )}
              {runs !== null && filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-gray-500">
                    {runs.length === 0
                      ? 'No backtests yet. Run /test <strategy> in Telegram to populate.'
                      : 'No runs match the current filters.'}
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
                    {formatTimestamp(r.createdAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-200">
                    {r.strategy ?? <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                    {formatDate(r.startDate)}
                    <span className="text-gray-600 mx-1">→</span>
                    {formatDate(r.endDate)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-300 font-mono tabular-nums">
                    {r.totalTrades}
                    {r.totalTrades > 0 && (
                      <div className="text-[10px] text-gray-500 font-sans">
                        <span className="text-emerald-400">{r.winningTrades}</span>
                        <span className="text-gray-600"> / </span>
                        <span className="text-red-400">{r.losingTrades}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-200">
                    {formatMetric(r.winRate, 1, '%')}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-200">
                    {formatMetric(r.profitFactor, 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-200">
                    {formatMetric(r.expectancy, 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-200">
                    {formatMetric(r.sharpeRatio, 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-300">
                    {formatMetric(r.maxDrawdownPct, 2, '%')}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right font-mono tabular-nums',
                      pnlClass(r.totalPnl),
                    )}
                  >
                    {r.totalPnl != null
                      ? `${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(2)}`
                      : '—'}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono text-[10px] text-gray-500"
                    title="Pull the full row from trade_journal.db::backtest_results by this id"
                  >
                    #{r.id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-gray-500">
        Showing the most recent {DEFAULT_LIMIT} runs from{' '}
        <code className="text-gray-400">backtest_results</code>. The full row
        for each run (config blob, % metrics, win/loss extremes) lives in{' '}
        <code className="text-gray-400">trade_journal.db</code>; query by the{' '}
        <code className="text-gray-400">id</code> shown in the rightmost
        column.
      </p>
    </div>
  );
}
