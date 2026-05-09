import { useMemo, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Filter,
  Layers,
  X,
} from 'lucide-react';
import { Position, Signal } from '../types';
import { cn } from '../lib/utils';

interface ModelsTabProps {
  signals: Signal[] | null;
  positions: Position[] | null;
}

type StatusKey = 'active' | 'idle' | 'quiet';

interface PatternRow {
  pattern: string;
  count: number;
  lastSignal: Signal;
  lastTs: number;
  symbols: Set<string>;
  // Last 5 signals on this pattern, newest first.
  recent: Signal[];
}

// Recency thresholds for the status pill (option 1 from S-062).
// Tunable. The bot's default poll cadence is ~10s; "active" means we've
// seen something this trading half-hour.
const ACTIVE_MS = 30 * 60 * 1000; // 30 min
const IDLE_MS = 4 * 60 * 60 * 1000; // 4 hours

function statusOf(lastTs: number, now: number): StatusKey {
  const age = now - lastTs;
  if (age <= ACTIVE_MS) return 'active';
  if (age <= IDLE_MS) return 'idle';
  return 'quiet';
}

const STATUS_STYLE: Record<StatusKey, { dot: string; pill: string; label: string }> = {
  active: {
    dot: 'bg-emerald-400',
    pill: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    label: 'active',
  },
  idle: {
    dot: 'bg-amber-400',
    pill: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    label: 'idle',
  },
  quiet: {
    dot: 'bg-gray-500',
    pill: 'bg-gray-700/40 text-gray-400 border-gray-700',
    label: 'quiet',
  },
};

function relativeTime(ts: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function isShort(side: string): boolean {
  const s = side.toLowerCase();
  return s === 'sell' || s === 'short';
}

function aggregatePatterns(signals: Signal[]): PatternRow[] {
  // Skip null/empty/literal "unknown" pattern rows — same rule as
  // StrategySignals (ict-trading-bot#556 contract).
  const map = new Map<string, PatternRow>();
  for (const s of signals) {
    if (!s.pattern || s.pattern.toLowerCase() === 'unknown') continue;
    const ts = new Date(s.timestamp).getTime();
    if (!isFinite(ts)) continue;
    const cur = map.get(s.pattern);
    if (!cur) {
      map.set(s.pattern, {
        pattern: s.pattern,
        count: 1,
        lastSignal: s,
        lastTs: ts,
        symbols: new Set([s.symbol]),
        recent: [s],
      });
    } else {
      cur.count += 1;
      cur.symbols.add(s.symbol);
      // Keep recent[] newest-first; assume input is newest-last so we
      // unshift into recent and trim.
      cur.recent.unshift(s);
      if (cur.recent.length > 5) cur.recent.length = 5;
      if (ts > cur.lastTs) {
        cur.lastTs = ts;
        cur.lastSignal = s;
      }
    }
  }
  // Newest-first by last fired.
  return Array.from(map.values()).sort((a, b) => b.lastTs - a.lastTs);
}

function summariseRecent(row: PatternRow, now: number): string {
  // Build a 1-line "what it's finding" sentence from the last few signals,
  // newest first. Fall back to a count-only sentence if metadata is too thin.
  const head = row.recent[0];
  if (!head) return 'No recent activity.';
  const dir = isShort(head.side) ? 'SHORT' : 'LONG';
  const ts = new Date(head.timestamp).getTime();
  const ago = isFinite(ts) ? relativeTime(ts, now) : '—';
  const conf =
    head.confidence != null ? ` (conf ${head.confidence.toFixed(2)})` : '';
  const price = head.price != null ? ` @ ${head.price.toFixed(2)}` : '';
  const tail =
    row.recent.length > 1
      ? ` · ${row.recent.length - 1} more in window`
      : '';
  return `${dir} ${head.symbol}${price}${conf} — ${ago}${tail}`;
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

export default function ModelsTab({ signals, positions }: ModelsTabProps) {
  const [symbolFilter, setSymbolFilter] = useState<string | null>(null);
  const [patternFilter, setPatternFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Pin "now" once per render so all status pills + relative timestamps
  // agree with each other for that paint.
  const now = Date.now();

  const list = signals ?? [];
  const rows = useMemo(() => aggregatePatterns(list), [list]);

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const s of list) set.add(s.symbol);
    return Array.from(set).sort();
  }, [list]);

  const patternIds = useMemo(() => rows.map((r) => r.pattern), [rows]);

  const filteredSignals = useMemo(() => {
    return list
      .filter((s) => (symbolFilter ? s.symbol === symbolFilter : true))
      .filter((s) => (patternFilter ? s.pattern === patternFilter : true))
      .slice()
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
  }, [list, symbolFilter, patternFilter]);

  const activeCount = rows.filter((r) => statusOf(r.lastTs, now) === 'active')
    .length;

  // Loading skeleton — `signals === null` means we haven't received the first
  // poll yet. After the first poll, an empty array is rendered as "no signals".
  if (signals === null) {
    return (
      <div className="space-y-4">
        <div className="metric-card animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/3 mb-3" />
          <div className="h-3 bg-gray-700 rounded w-2/3" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="metric-card animate-pulse h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="space-y-4">
        <Header
          activeCount={0}
          totalPatterns={0}
          totalSignals={0}
          openPositions={positions?.length ?? 0}
        />
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-8 text-center">
          <Layers size={24} className="text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-300">No signals in the audit log yet.</p>
          <p className="text-xs text-gray-500 mt-1">
            Patterns will appear here as the bot publishes them to /api/bot/signals.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header
        activeCount={activeCount}
        totalPatterns={rows.length}
        totalSignals={list.length}
        openPositions={positions?.length ?? 0}
      />

      {/* Pattern roster */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2 px-1">
          Pattern roster
        </h3>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200">
            Signals are flowing but none carry a usable <code>pattern</code> field
            (ict-trading-bot#556). Roster will populate once the bot writer
            includes pattern on each audit row.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {rows.map((row) => (
              <PatternCard key={row.pattern} row={row} now={now} />
            ))}
          </div>
        )}
      </section>

      {/* Live signals snapshot */}
      <section>
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-xs uppercase tracking-wider text-gray-500">
            Live signals snapshot
          </h3>
          <span className="text-[10px] text-gray-500 tabular-nums">
            {filteredSignals.length} of {list.length}
          </span>
        </div>

        <FilterChips
          label="Symbol"
          options={symbols}
          selected={symbolFilter}
          onSelect={setSymbolFilter}
        />
        <FilterChips
          label="Pattern"
          options={patternIds}
          selected={patternFilter}
          onSelect={setPatternFilter}
        />

        <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden mt-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-900/60 border-b border-gray-800">
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2 font-medium w-6"></th>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Symbol</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium">Pattern</th>
                  <th className="px-3 py-2 font-medium text-right">Conf</th>
                  <th className="px-3 py-2 font-medium text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredSignals.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                      No signals match the selected filters.
                    </td>
                  </tr>
                )}
                {filteredSignals.map((s) => {
                  const expanded = expandedId === s.id;
                  const short = isShort(s.side);
                  return (
                    <SignalRow
                      key={s.id}
                      signal={s}
                      short={short}
                      expanded={expanded}
                      onToggle={() => setExpandedId(expanded ? null : s.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Header({
  activeCount,
  totalPatterns,
  totalSignals,
  openPositions,
}: {
  activeCount: number;
  totalPatterns: number;
  totalSignals: number;
  openPositions: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <Layers size={16} className="text-blue-400 shrink-0" />
        <h1 className="text-base font-semibold text-gray-100 truncate">Models</h1>
        <span className="text-[10px] text-gray-500 hidden sm:inline">
          per-strategy view of what the system is finding
        </span>
      </div>
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-gray-500 shrink-0">
        <span className="hidden sm:inline">
          <span className="text-emerald-400 tabular-nums">{activeCount}</span> active
        </span>
        <span className="hidden sm:inline">
          <span className="text-gray-200 tabular-nums">{totalPatterns}</span> patterns
        </span>
        <span>
          <span className="text-gray-200 tabular-nums">{totalSignals}</span> signals
        </span>
        <span>
          <span className="text-gray-200 tabular-nums">{openPositions}</span> open
        </span>
      </div>
    </div>
  );
}

function PatternCard({ row, now }: { row: PatternRow; now: number }) {
  const status = statusOf(row.lastTs, now);
  const sty = STATUS_STYLE[status];
  return (
    <div className="metric-card">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-100 font-mono truncate">
              {row.pattern}
            </p>
            <span
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider border',
                sty.pill,
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', sty.dot)} />
              {sty.label}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            last fired{' '}
            <span className="text-gray-300">{relativeTime(row.lastTs, now)}</span>{' '}
            · {Array.from(row.symbols).slice(0, 3).join(', ')}
            {row.symbols.size > 3 ? ` +${row.symbols.size - 3}` : ''}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-mono font-semibold text-gray-200 tabular-nums">
            {row.count}
          </p>
          <p className="text-[10px] text-gray-500">signals</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed mt-2">
        {summariseRecent(row, now)}
      </p>

      <div className="mt-2 pt-2 border-t border-gray-800/60 grid grid-cols-2 gap-2 text-[10px]">
        <WinRateBadge />
        <div className="text-right">
          <span className="text-gray-500">avg conf </span>
          <span className="text-gray-300 font-mono tabular-nums">
            {avgConf(row.recent)}
          </span>
        </div>
      </div>
    </div>
  );
}

function avgConf(signals: Signal[]): string {
  const known = signals.filter((s) => s.confidence != null) as (Signal & {
    confidence: number;
  })[];
  if (known.length === 0) return '—';
  const sum = known.reduce((acc, s) => acc + s.confidence, 0);
  return (sum / known.length).toFixed(2);
}

function WinRateBadge() {
  // Win rate per pattern requires the closed-trades endpoint
  // (ict-trading-bot#557) so we can attribute realised PnL back to the
  // signal that opened the trade. Render an empty-state placeholder until
  // that lands rather than fabricating a number from the audit log.
  return (
    <div className="text-left" title="Needs ict-trading-bot#557 closed-trades endpoint">
      <span className="text-gray-500">7d win rate </span>
      <span className="text-gray-600">—</span>
    </div>
  );
}

function FilterChips({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (v: string | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2">
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-500 mr-1">
        <Filter size={10} />
        {label}
      </span>
      {options.map((opt) => {
        const active = selected === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(active ? null : opt)}
            className={cn(
              'px-2 py-0.5 rounded-full text-[10px] border transition-colors font-mono',
              active
                ? 'bg-blue-600/20 text-blue-200 border-blue-500/40'
                : 'bg-gray-800/40 text-gray-400 border-gray-700 hover:bg-gray-800',
            )}
          >
            {opt}
          </button>
        );
      })}
      {selected && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300"
        >
          <X size={10} />
          clear
        </button>
      )}
    </div>
  );
}

function SignalRow({
  signal,
  short,
  expanded,
  onToggle,
}: {
  signal: Signal;
  short: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="hover:bg-gray-800/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-gray-500">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </td>
        <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
          {formatTimestamp(signal.timestamp)}
        </td>
        <td className="px-3 py-2 font-mono text-gray-200">{signal.symbol}</td>
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
        <td className="px-3 py-2 font-mono text-gray-400 truncate max-w-[10rem]">
          {signal.pattern || <span className="text-gray-600">—</span>}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-300">
          {signal.confidence != null ? signal.confidence.toFixed(2) : '—'}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-300">
          {signal.price != null ? signal.price.toFixed(2) : '—'}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-900/40">
          <td colSpan={7} className="px-3 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
              <Field label="Signal id" value={signal.id} mono />
              <Field
                label="ISO timestamp"
                value={signal.timestamp}
                mono
              />
              <Field label="Side (raw)" value={signal.side} mono />
              <Field
                label="Pattern"
                value={signal.pattern ?? '—'}
                mono
              />
              <Field
                label="Confidence"
                value={
                  signal.confidence != null ? signal.confidence.toFixed(4) : '—'
                }
                mono
              />
              <Field
                label="Price"
                value={signal.price != null ? signal.price.toFixed(4) : '—'}
                mono
              />
            </div>
            <p className="text-[10px] text-gray-600 mt-2 inline-flex items-center gap-1">
              <Activity size={10} />
              Raw row from /api/bot/signals — useful when comparing the bot's audit
              log against the dashboard's render.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p
        className={cn(
          'text-gray-200 truncate',
          mono && 'font-mono',
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
