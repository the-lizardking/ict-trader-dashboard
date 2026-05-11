import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Filter, RefreshCw, StickyNote, X } from 'lucide-react';
import { ClosedTrade, TradeScoreEntry, TradeShadowScore } from '../types';
import {
  getClosedTrades,
  getTradeScores,
  BotApiError,
  describeError,
} from '../services/api';
import { cn } from '../lib/utils';

const POLL_MS = 30_000;
const NOTE_PREFIX = 'journal-note:';

type SortKey = 'closedAt' | 'realizedPnl';
type SortDir = 'asc' | 'desc';

function loadNote(id: string): string {
  try {
    return localStorage.getItem(NOTE_PREFIX + id) ?? '';
  } catch {
    return '';
  }
}

function saveNote(id: string, value: string): void {
  try {
    if (value.trim() === '') localStorage.removeItem(NOTE_PREFIX + id);
    else localStorage.setItem(NOTE_PREFIX + id, value);
  } catch {
    /* private mode / quota — best effort */
  }
}

function formatDuration(openedAt: string, closedAt: string): string {
  const o = new Date(openedAt).getTime();
  const c = new Date(closedAt).getTime();
  if (!isFinite(o) || !isFinite(c) || c <= o) return '—';
  const sec = Math.floor((c - o) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr % 24}h`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isShort(side: string): boolean {
  const s = side.toLowerCase();
  return s === 'sell' || s === 'short';
}

export default function JournalsTab() {
  const [trades, setTrades] = useState<ClosedTrade[] | null>(null);
  const [error, setError] = useState<BotApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [scores, setScores] = useState<TradeScoreEntry[] | null>(null);
  const [scoresErr, setScoresErr] = useState<BotApiError | null>(null);
  const [shadowLogPresent, setShadowLogPresent] = useState<boolean | null>(null);

  const [symbolFilter, setSymbolFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<'all' | 'long' | 'short'>('all');
  const [patternFilter, setPatternFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('closedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const cancelledRef = useRef(false);

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getClosedTrades(100);
      if (cancelledRef.current) return;
      setTrades(data);
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof BotApiError ? err : new BotApiError('?', 0, String(err), 'network'));
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    fetchTrades();
    const id = setInterval(fetchTrades, POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [fetchTrades]);

  // Pull per-trade shadow-prediction scores in parallel so the column
  // can render alongside the rest of the row. The bot keys scores by
  // trade_id; we build a map for O(1) lookup at render time.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getTradeScores(100, true)
        .then((resp) => {
          if (cancelled) return;
          setScores(resp.trades);
          setShadowLogPresent(resp.log_present);
          setScoresErr(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setScoresErr(
            err instanceof BotApiError ? err : new BotApiError('?', 0, String(err), 'network'),
          );
        });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const scoresByTradeId = useMemo(() => {
    const m = new Map<string, TradeShadowScore[]>();
    for (const t of scores ?? []) m.set(t.trade_id, t.scores);
    return m;
  }, [scores]);

  const patterns = useMemo(() => {
    if (!trades) return [];
    const set = new Set<string>();
    for (const t of trades) if (t.pattern) set.add(t.pattern);
    return Array.from(set).sort();
  }, [trades]);

  const filtered = useMemo(() => {
    if (!trades) return [];
    const sym = symbolFilter.trim().toUpperCase();
    const fromTs = fromDate ? new Date(fromDate).getTime() : null;
    const toTs = toDate ? new Date(toDate).getTime() + 86_400_000 : null; // inclusive of "to" day
    return trades
      .filter((t) => {
        if (sym && !t.symbol.toUpperCase().includes(sym)) return false;
        if (sideFilter !== 'all') {
          const s = t.side.toLowerCase();
          if (sideFilter === 'long' && !(s === 'buy' || s === 'long')) return false;
          if (sideFilter === 'short' && !(s === 'sell' || s === 'short')) return false;
        }
        if (patternFilter !== 'all' && t.pattern !== patternFilter) return false;
        if (fromTs || toTs) {
          const ts = new Date(t.closedAt).getTime();
          if (fromTs && ts < fromTs) return false;
          if (toTs && ts > toTs) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const av = sortKey === 'realizedPnl' ? a.realizedPnl : new Date(a.closedAt).getTime();
        const bv = sortKey === 'realizedPnl' ? b.realizedPnl : new Date(b.closedAt).getTime();
        return sortDir === 'asc' ? av - bv : bv - av;
      });
  }, [trades, symbolFilter, sideFilter, patternFilter, fromDate, toDate, sortKey, sortDir]);

  const summary = useMemo(() => {
    if (filtered.length === 0) return null;
    const totalPnl = filtered.reduce((sum, t) => sum + t.realizedPnl, 0);
    const wins = filtered.filter((t) => t.realizedPnl > 0).length;
    const winRate = (wins / filtered.length) * 100;
    return { totalPnl, wins, losses: filtered.length - wins, winRate };
  }, [filtered]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const startEditNote = (id: string) => {
    setEditingNoteId(id);
    setNoteDraft(loadNote(id));
  };

  const commitNote = () => {
    if (editingNoteId) saveNote(editingNoteId, noteDraft);
    setEditingNoteId(null);
    setNoteDraft('');
  };

  const cancelNote = () => {
    setEditingNoteId(null);
    setNoteDraft('');
  };

  const clearFilters = () => {
    setSymbolFilter('');
    setSideFilter('all');
    setPatternFilter('all');
    setFromDate('');
    setToDate('');
  };

  const isFallback = trades?.some((t) => t.derivedFromLogs) ?? false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen size={16} className="text-blue-400 shrink-0" />
          <h1 className="text-base font-semibold text-gray-100 truncate">Trade Journal</h1>
          {isFallback && (
            <span
              className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30"
              title="Bot endpoint /api/bot/trades/closed not deployed yet — rows derived from audit log (best effort, missing fields)"
            >
              fallback
            </span>
          )}
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
            onClick={fetchTrades}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-gray-800/60 text-gray-300 border border-gray-700 hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-gray-500">
            Symbol
            <input
              type="text"
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              placeholder="BTC"
              className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-gray-500">
            Side
            <select
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value as 'all' | 'long' | 'short')}
              className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All</option>
              <option value="long">Long / Buy</option>
              <option value="short">Short / Sell</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-gray-500">
            Pattern
            <select
              value={patternFilter}
              onChange={(e) => setPatternFilter(e.target.value)}
              className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All</option>
              {patterns.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-gray-500">
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-gray-500">
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </label>
          <div className="col-span-2 sm:col-span-3 lg:col-span-5 flex justify-end">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="metric-card">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Trades</p>
            <p className="text-lg font-semibold text-gray-100 mt-0.5">{filtered.length}</p>
          </div>
          <div className="metric-card">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Win rate</p>
            <p className="text-lg font-semibold text-gray-100 mt-0.5">{summary.winRate.toFixed(1)}%</p>
          </div>
          <div className="metric-card">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Wins / Losses</p>
            <p className="text-lg font-semibold text-gray-100 mt-0.5 tabular-nums">
              <span className="text-emerald-400">{summary.wins}</span>
              <span className="text-gray-600"> / </span>
              <span className="text-red-400">{summary.losses}</span>
            </p>
          </div>
          <div className="metric-card">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Total PnL</p>
            <p
              className={cn(
                'text-lg font-semibold mt-0.5 tabular-nums',
                summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
              )}
            >
              {summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200">
          Failed to load closed trades ({describeError(error)}). The fallback is also unavailable —
          check the bot connection or try refreshing.
        </div>
      )}

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-900/60 border-b border-gray-800">
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('closedAt')}
                    className="inline-flex items-center gap-1 hover:text-gray-200"
                  >
                    Closed
                    {sortKey === 'closedAt' &&
                      (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">Symbol</th>
                <th className="px-3 py-2 font-medium">Side</th>
                <th className="px-3 py-2 font-medium">Pattern</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Entry → Exit</th>
                <th className="px-3 py-2 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('realizedPnl')}
                    className="inline-flex items-center gap-1 hover:text-gray-200"
                  >
                    PnL
                    {sortKey === 'realizedPnl' &&
                      (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th
                  className="px-3 py-2 font-medium"
                  title="Shadow-model prediction scores recorded between the trade's open and close"
                >
                  Model scores
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  title="Per-trade score assigned by the most recent /health-review run. Populated by an upcoming bot-side hook."
                >
                  HC score
                </th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {trades === null && !error && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-gray-500">
                    Loading closed trades…
                  </td>
                </tr>
              )}
              {trades !== null && filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-gray-500">
                    {trades.length === 0
                      ? 'No closed trades yet. The journal will populate as positions close.'
                      : 'No trades match the current filters.'}
                  </td>
                </tr>
              )}
              {filtered.map((t) => {
                const short = isShort(t.side);
                const pnlClass = t.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400';
                const note = loadNote(t.id);
                return (
                  <tr key={t.id} className="hover:bg-gray-800/30">
                    <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
                      {formatTimestamp(t.closedAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-200">{t.symbol}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase',
                          short
                            ? 'bg-red-500/15 text-red-300'
                            : 'bg-emerald-500/15 text-emerald-300',
                        )}
                      >
                        {short ? 'short' : 'long'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-400 truncate max-w-[10rem]">
                      {t.pattern || <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300 font-mono tabular-nums">
                      {t.qty || <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300 font-mono tabular-nums whitespace-nowrap">
                      {t.entryPrice ? t.entryPrice.toFixed(2) : '—'}
                      <span className="text-gray-600 mx-1">→</span>
                      {t.exitPrice ? t.exitPrice.toFixed(2) : '—'}
                    </td>
                    <td className={cn('px-3 py-2 text-right font-mono tabular-nums', pnlClass)}>
                      {t.realizedPnl >= 0 ? '+' : ''}${t.realizedPnl.toFixed(2)}
                      {t.realizedPnlPct != null && (
                        <div className="text-[10px] text-gray-500 font-sans">
                          {(t.realizedPnlPct * 100).toFixed(2)}%
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {formatDuration(t.openedAt, t.closedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <ScoresCell scores={scoresByTradeId.get(t.id) ?? null} />
                    </td>
                    <td className="px-3 py-2">
                      <HealthCheckScoreCell
                        score={t.healthCheckScore ?? null}
                        note={t.healthCheckNote ?? null}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => startEditNote(t.id)}
                        className={cn(
                          'inline-flex items-center gap-1 text-xs hover:text-gray-200',
                          note ? 'text-blue-300' : 'text-gray-500',
                        )}
                        title={note || 'Add a note'}
                      >
                        <StickyNote size={12} />
                        {note ? 'view' : 'add'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {scoresErr && (
        <p className="text-[10px] text-amber-300 px-1">
          Model scores unavailable ({describeError(scoresErr)})
        </p>
      )}
      {shadowLogPresent === false && !scoresErr && (
        <p className="text-[10px] text-gray-500 px-1">
          Shadow-predictions log not present on the bot — model scores column will be empty.
        </p>
      )}

      {editingNoteId && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={cancelNote}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-gray-700 shadow-2xl"
            style={{ backgroundColor: '#111827' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <StickyNote size={14} className="text-blue-400" />
                <span className="text-sm font-semibold text-gray-100">Trade note</span>
              </div>
              <button onClick={cancelNote} className="text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="What did you learn from this trade?"
                rows={5}
                autoFocus
                className="w-full rounded-md bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-blue-500 resize-none"
              />
              <p className="text-[10px] text-gray-500 mt-2">
                Notes are stored locally in your browser only.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-700">
              <button
                onClick={cancelNote}
                className="px-3 py-1.5 rounded-md text-xs text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={commitNote}
                className="px-3 py-1.5 rounded-md text-xs bg-blue-600 hover:bg-blue-500 text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoresCell({ scores }: { scores: TradeShadowScore[] | null }) {
  if (scores === null) return <span className="text-gray-600 text-[10px]">…</span>;
  if (scores.length === 0) return <span className="text-gray-600 text-[10px]">—</span>;
  return (
    <div className="flex flex-wrap gap-1 max-w-[16rem]">
      {scores.map((s) => {
        const last = s.score_last ?? s.score_mean;
        const tone = scoreTone(last);
        return (
          <span
            key={`${s.model_id}-${s.stage}`}
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border',
              tone,
            )}
            title={
              `${s.model_id} (${s.stage})\n` +
              `count: ${s.count}\n` +
              (s.score_first !== null ? `first: ${s.score_first.toFixed(3)}\n` : '') +
              (s.score_last !== null ? `last: ${s.score_last.toFixed(3)}\n` : '') +
              (s.score_mean !== null ? `mean: ${s.score_mean.toFixed(3)}\n` : '') +
              (s.score_min !== null && s.score_max !== null
                ? `range: ${s.score_min.toFixed(3)} → ${s.score_max.toFixed(3)}`
                : '')
            }
          >
            <span className="font-mono">{shortenModelId(s.model_id)}</span>
            <span className="tabular-nums">{last !== null ? last.toFixed(2) : '—'}</span>
          </span>
        );
      })}
    </div>
  );
}

function scoreTone(score: number | null): string {
  if (score === null || !Number.isFinite(score)) {
    return 'border-gray-700 bg-gray-800/40 text-gray-400';
  }
  if (score >= 0.7) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (score >= 0.4) return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-red-500/40 bg-red-500/10 text-red-300';
}

function HealthCheckScoreCell({ score, note }: { score: number | null; note: string | null }) {
  if (score === null || !Number.isFinite(score)) {
    return (
      <span
        className="text-gray-600 text-[10px]"
        title="No /health-review score recorded for this trade yet. Bot-side scoring hook is a queued follow-up."
      >
        —
      </span>
    );
  }
  const tone = scoreTone(score);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border tabular-nums',
        tone,
      )}
      title={note ?? `Health-check score: ${score.toFixed(2)}`}
    >
      {score.toFixed(2)}
    </span>
  );
}

function shortenModelId(id: string): string {
  // Drop a common "-shadow-vN" suffix for compactness but keep the
  // distinguishing prefix. Falls through to the raw id if the heuristic
  // doesn't match.
  return id.replace(/-shadow(?:-v\d+)?$/i, '');
}
