import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { ClosedTrade, EquityPoint, PnlHistoryPoint } from '../types';
import {
  BotApiError,
  describeError,
  getClosedTrades,
  getPnlHistory,
} from '../services/api';
import { cn } from '../lib/utils';

const POLL_MS = 60_000;
type Window = 30 | 90;

interface PerformanceTabProps {
  /** localStorage-backed in-session buffer used as a fallback when the bot
   *  history endpoint is unreachable. Read-only. */
  fallbackEquity: EquityPoint[];
}

interface DailyRow {
  date: string;
  pnl: number;
  cumulative: number;
  drawdown: number;
  trades: number | null;
  wins: number | null;
  losses: number | null;
}

interface Summary {
  totalPnl: number;
  maxDrawdown: number;
  sharpe: number | null;
  winLossRatio: number | null;
  positiveDays: number;
  negativeDays: number;
}

function normalise(points: PnlHistoryPoint[]): DailyRow[] {
  if (points.length === 0) return [];
  // Bot returns oldest → newest by spec; sort defensively.
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const rows: DailyRow[] = [];
  let running = 0;
  let peak = -Infinity;
  for (const p of sorted) {
    const pnl = Number.isFinite(p.pnl) ? p.pnl : 0;
    // Trust the bot's running total when it provides one (handles deposits /
    // withdrawals correctly); otherwise sum the daily P&L ourselves.
    if (typeof p.cumulativePnl === 'number' && Number.isFinite(p.cumulativePnl)) {
      running = p.cumulativePnl;
    } else {
      running += pnl;
    }
    if (running > peak) peak = running;
    const drawdown = running - peak;
    rows.push({
      date: p.date,
      pnl,
      cumulative: running,
      drawdown,
      trades: p.trades ?? null,
      wins: p.wins ?? null,
      losses: p.losses ?? null,
    });
  }
  return rows;
}

function computeSummary(rows: DailyRow[]): Summary {
  if (rows.length === 0) {
    return {
      totalPnl: 0,
      maxDrawdown: 0,
      sharpe: null,
      winLossRatio: null,
      positiveDays: 0,
      negativeDays: 0,
    };
  }
  const totalPnl = rows[rows.length - 1].cumulative - (rows[0].cumulative - rows[0].pnl);
  const maxDrawdown = rows.reduce((mn, r) => Math.min(mn, r.drawdown), 0);

  // Sharpe: annualised, assuming daily samples. Crypto trades 365 days/yr.
  // Returns rf=0 — we don't model a risk-free rate for this internal tool.
  let sharpe: number | null = null;
  if (rows.length >= 2) {
    const mean = rows.reduce((s, r) => s + r.pnl, 0) / rows.length;
    const variance =
      rows.reduce((s, r) => s + (r.pnl - mean) * (r.pnl - mean), 0) / (rows.length - 1);
    const stddev = Math.sqrt(variance);
    sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(365) : null;
  }

  // Win/loss ratio: prefer per-day trade counts when populated, else fall
  // back to "positive vs negative day" classification.
  const haveTradeCounts = rows.some((r) => r.wins !== null || r.losses !== null);
  let winLossRatio: number | null = null;
  if (haveTradeCounts) {
    const totalWins = rows.reduce((s, r) => s + (r.wins ?? 0), 0);
    const totalLosses = rows.reduce((s, r) => s + (r.losses ?? 0), 0);
    winLossRatio = totalLosses > 0 ? totalWins / totalLosses : null;
  }

  const positiveDays = rows.filter((r) => r.pnl > 0).length;
  const negativeDays = rows.filter((r) => r.pnl < 0).length;
  if (winLossRatio === null && negativeDays > 0) {
    winLossRatio = positiveDays / negativeDays;
  }

  return {
    totalPnl,
    maxDrawdown,
    sharpe,
    winLossRatio,
    positiveDays,
    negativeDays,
  };
}

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${v.toFixed(2)}`;
}

function fmtRatio(v: number | null): string {
  return v === null ? '—' : v.toFixed(2);
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface StrategyAgg {
  pattern: string;
  trades: number;
  totalPnl: number;
  wins: number;
}

function aggregateByStrategy(trades: ClosedTrade[]): StrategyAgg[] {
  const map = new Map<string, StrategyAgg>();
  for (const t of trades) {
    if (!t.pattern) continue;
    const cur = map.get(t.pattern);
    if (!cur) {
      map.set(t.pattern, {
        pattern: t.pattern,
        trades: 1,
        totalPnl: t.realizedPnl,
        wins: t.realizedPnl > 0 ? 1 : 0,
      });
    } else {
      cur.trades += 1;
      cur.totalPnl += t.realizedPnl;
      if (t.realizedPnl > 0) cur.wins += 1;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalPnl - a.totalPnl);
}

export default function PerformanceTab({ fallbackEquity }: PerformanceTabProps) {
  const [windowDays, setWindowDays] = useState<Window>(30);
  const [history, setHistory] = useState<PnlHistoryPoint[] | null>(null);
  const [historyErr, setHistoryErr] = useState<BotApiError | null>(null);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[] | null>(null);
  const [closedErr, setClosedErr] = useState<BotApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const cancelledRef = useRef(false);

  const fetchAll = useCallback(
    async (days: Window) => {
      setLoading(true);
      const [h, c] = await Promise.allSettled([getPnlHistory(days), getClosedTrades(200)]);
      if (cancelledRef.current) return;
      if (h.status === 'fulfilled') {
        setHistory(h.value);
        setHistoryErr(null);
      } else {
        setHistory((prev) => prev); // keep last good
        setHistoryErr(
          h.reason instanceof BotApiError
            ? h.reason
            : new BotApiError('?', 0, String(h.reason), 'network'),
        );
      }
      if (c.status === 'fulfilled') {
        setClosedTrades(c.value);
        setClosedErr(null);
      } else {
        setClosedErr(
          c.reason instanceof BotApiError
            ? c.reason
            : new BotApiError('?', 0, String(c.reason), 'network'),
        );
      }
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    cancelledRef.current = false;
    fetchAll(windowDays);
    const id = setInterval(() => fetchAll(windowDays), POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [fetchAll, windowDays]);

  const rows = useMemo(() => normalise(history ?? []), [history]);
  const summary = useMemo(() => computeSummary(rows), [rows]);
  const strategyRows = useMemo(
    () => aggregateByStrategy(closedTrades ?? []),
    [closedTrades],
  );

  const usingFallback = history === null && historyErr !== null;
  const hasStrategyData = strategyRows.length > 0;

  return (
    <div className="space-y-4">
      <Header
        windowDays={windowDays}
        onWindowChange={setWindowDays}
        loading={loading}
        onRefresh={() => fetchAll(windowDays)}
        summary={summary}
        showSummary={rows.length > 0}
      />

      {historyErr && rows.length === 0 && (
        <FallbackNotice err={historyErr} />
      )}

      {history === null && !historyErr ? (
        <SkeletonChart />
      ) : rows.length > 0 ? (
        <DailyAndCumulativeChart rows={rows} />
      ) : (
        <FallbackEquityChart points={fallbackEquity} hasError={!!historyErr} />
      )}

      {rows.length > 0 && <DrawdownChart rows={rows} />}

      <StrategyBreakdown
        rows={strategyRows}
        loading={closedTrades === null && !closedErr}
        error={closedErr}
        hasData={hasStrategyData}
      />

      {usingFallback && (
        <p className="text-[11px] text-gray-500 px-1">
          Showing in-session equity buffer ({fallbackEquity.length} points). Daily
          history will populate once the bot's <code>/api/pnl/history</code>{' '}
          endpoint is reachable.
        </p>
      )}
    </div>
  );
}

function Header({
  windowDays,
  onWindowChange,
  loading,
  onRefresh,
  summary,
  showSummary,
}: {
  windowDays: Window;
  onWindowChange: (w: Window) => void;
  loading: boolean;
  onRefresh: () => void;
  summary: Summary;
  showSummary: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart2 size={16} className="text-blue-400 shrink-0" />
          <h1 className="text-base font-semibold text-gray-100 truncate">Performance</h1>
          <span className="text-[10px] text-gray-500 hidden sm:inline">
            daily P&amp;L, drawdown, per-strategy attribution
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex rounded-md border border-gray-700 bg-gray-900/60 overflow-hidden text-xs">
            {([30, 90] as Window[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onWindowChange(d)}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  windowDays === d
                    ? 'bg-blue-600/20 text-blue-200'
                    : 'text-gray-400 hover:text-gray-200',
                )}
              >
                {d}d
              </button>
            ))}
          </div>
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
      {showSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label={`${windowDays}d P&L`}
            value={fmtUsd(summary.totalPnl)}
            valueClass={summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
            icon={summary.totalPnl >= 0 ? TrendingUp : TrendingDown}
          />
          <SummaryCard
            label="Max drawdown"
            value={fmtUsd(summary.maxDrawdown)}
            valueClass="text-red-400"
            icon={TrendingDown}
          />
          <SummaryCard
            label="Sharpe (ann.)"
            value={summary.sharpe === null ? '—' : summary.sharpe.toFixed(2)}
            valueClass="text-gray-100"
            icon={BarChart2}
          />
          <SummaryCard
            label="Win / loss"
            value={fmtRatio(summary.winLossRatio)}
            sub={`${summary.positiveDays}↑ / ${summary.negativeDays}↓ days`}
            valueClass="text-gray-100"
            icon={BarChart2}
          />
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  valueClass,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
        <Icon className="text-gray-600" size={14} />
      </div>
      <p className={cn('text-xl font-semibold tabular-nums', valueClass ?? 'text-gray-100')}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function FallbackNotice({ err }: { err: BotApiError }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
      Daily P&amp;L history unavailable ({describeError(err)}). Showing the
      in-session equity buffer instead — daily bars, drawdown, and Sharpe will
      populate once <code>/api/pnl/history</code> is reachable.
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="metric-card animate-pulse">
      <div className="h-4 bg-gray-700 rounded w-1/3 mb-3" />
      <div className="h-[220px] bg-gray-800/60 rounded" />
    </div>
  );
}

function DailyAndCumulativeChart({ rows }: { rows: DailyRow[] }) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Daily P&amp;L &amp; cumulative</h3>
        <span className="text-[10px] text-gray-500">{rows.length} days</span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={rows} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatDateLabel}
            minTickGap={20}
          />
          <YAxis
            yAxisId="bar"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <YAxis
            yAxisId="line"
            orientation="right"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#111827',
              border: '1px solid #1f2937',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#9ca3af' }}
            labelFormatter={(label: string) => formatDateLabel(label)}
            formatter={(value: number, name: string) => {
              const label = name === 'pnl' ? 'Daily' : 'Cumulative';
              return [fmtUsd(value), label];
            }}
          />
          <Bar yAxisId="bar" dataKey="pnl" radius={[2, 2, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.date} fill={r.pnl >= 0 ? '#10b981' : '#ef4444'} />
            ))}
          </Bar>
          <Line
            yAxisId="line"
            type="monotone"
            dataKey="cumulative"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function DrawdownChart({ rows }: { rows: DailyRow[] }) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Drawdown</h3>
        <span className="text-[10px] text-gray-500">peak-to-trough, USD</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={rows} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatDateLabel}
            minTickGap={20}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#111827',
              border: '1px solid #1f2937',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#9ca3af' }}
            labelFormatter={(label: string) => formatDateLabel(label)}
            formatter={(value: number) => [fmtUsd(value), 'Drawdown']}
          />
          <Area
            type="monotone"
            dataKey="drawdown"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#ddGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function FallbackEquityChart({
  points,
  hasError,
}: {
  points: EquityPoint[];
  hasError: boolean;
}) {
  if (points.length < 2) {
    return (
      <div className="metric-card">
        <h3 className="text-sm font-semibold text-gray-200 mb-2">Equity (in-session)</h3>
        <div className="h-[200px] flex flex-col items-center justify-center gap-2 text-gray-500">
          <BarChart2 size={20} className="text-gray-600" />
          <p className="text-xs">
            {hasError
              ? 'No bot history and not enough in-session samples yet.'
              : 'Collecting equity points (one per refresh tick).'}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Equity (in-session)</h3>
        <span className="text-[10px] text-gray-500">{points.length} points · fallback</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={points} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="fallbackGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="time"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={30}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={['dataMin', 'dataMax']}
            width={48}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#111827',
              border: '1px solid #1f2937',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: number) => [fmtUsd(v), 'Total P&L']}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#fallbackGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function StrategyBreakdown({
  rows,
  loading,
  error,
  hasData,
}: {
  rows: StrategyAgg[];
  loading: boolean;
  error: BotApiError | null;
  hasData: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs uppercase tracking-wider text-gray-500 px-1">
        Per-strategy breakdown
      </h3>
      {loading ? (
        <div className="metric-card animate-pulse h-32" />
      ) : !hasData ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-5 text-xs text-gray-400">
          {error ? (
            <>
              Closed trades unavailable ({describeError(error)}). Per-strategy
              attribution will populate once the bot exposes{' '}
              <code>/api/bot/trades/closed</code> with pattern metadata
              (ict-trading-bot#557).
            </>
          ) : (
            <>
              No pattern-attributed trades in the closed-trades feed yet. Rows will
              populate as the bot ships closed trades carrying a{' '}
              <code>pattern</code> field (ict-trading-bot#557).
            </>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-900/60 border-b border-gray-800">
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2 font-medium">Pattern</th>
                  <th className="px-3 py-2 font-medium text-right">Trades</th>
                  <th className="px-3 py-2 font-medium text-right">Win rate</th>
                  <th className="px-3 py-2 font-medium text-right">Total P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {rows.map((r) => {
                  const winRate = r.trades > 0 ? (r.wins / r.trades) * 100 : 0;
                  const pnlClass = r.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400';
                  return (
                    <tr key={r.pattern} className="hover:bg-gray-800/30">
                      <td className="px-3 py-2 font-mono text-gray-200">{r.pattern}</td>
                      <td className="px-3 py-2 text-right text-gray-300 tabular-nums">
                        {r.trades}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-300 tabular-nums">
                        {winRate.toFixed(1)}%
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-mono tabular-nums',
                          pnlClass,
                        )}
                      >
                        {fmtUsd(r.totalPnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
