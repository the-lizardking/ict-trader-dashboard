import { Signal } from '../types';
import { cn } from '../lib/utils';

interface StrategySignalsProps {
  signals: Signal[] | null;
  error?: { httpStatus: number; label?: string } | null;
}

interface PatternRow {
  pattern: string;
  count: number;
  lastSide: string;
  lastConfidence: number | null;
  lastTs: string;
}

function aggregateByPattern(signals: Signal[]): PatternRow[] {
  const byPattern = new Map<string, PatternRow>();
  // signals returned newest-last in the API; iterate forward so the last
  // entry per pattern sticks as "most recent". Skip rows with null/empty
  // pattern — the bot writer occasionally drops the field
  // (ict-trading-bot#556) and aggregating them under "unknown" produces
  // a misleading "unknown — conf 0.00" row.
  for (const s of signals) {
    if (!s.pattern) continue;
    const cur = byPattern.get(s.pattern);
    if (cur) {
      cur.count += 1;
      cur.lastSide = s.side;
      cur.lastConfidence = s.confidence;
      cur.lastTs = s.timestamp;
    } else {
      byPattern.set(s.pattern, {
        pattern: s.pattern,
        count: 1,
        lastSide: s.side,
        lastConfidence: s.confidence,
        lastTs: s.timestamp,
      });
    }
  }
  return Array.from(byPattern.values()).sort((a, b) => b.count - a.count);
}

function isShort(side: string) {
  const s = side.toLowerCase();
  return s === 'sell' || s === 'short';
}

export default function StrategySignals({ signals, error }: StrategySignalsProps) {
  if (signals === null) {
    if (error) {
      const hint = error.label || (error.httpStatus ? `HTTP ${error.httpStatus}` : 'Network error');
      return (
        <div className="metric-card">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">Active ICT Strategies</h3>
          <p className="text-xs text-red-300 py-4 text-center">Signals unavailable ({hint})</p>
        </div>
      );
    }
    return (
      <div className="metric-card">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Active ICT Strategies</h3>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 bg-gray-800/40 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="metric-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Active ICT Strategies</h3>
          <span className="text-xs text-gray-500">no signals</span>
        </div>
        <p className="text-xs text-gray-500 py-4 text-center">
          No recent signals in the audit log
        </p>
      </div>
    );
  }

  const patterns = aggregateByPattern(signals);

  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Active ICT Strategies</h3>
        <span className="text-xs text-gray-500">last {signals.length} signals</span>
      </div>
      <div className="space-y-2 max-h-56 overflow-y-auto">
        {patterns.map((p) => {
          const short = isShort(p.lastSide);
          return (
            <div
              key={p.pattern}
              className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    short ? 'bg-red-400' : 'bg-emerald-400',
                  )}
                />
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 truncate">{p.pattern}</p>
                  <p className="text-[10px] text-gray-500">
                    last: {short ? 'SHORT' : 'LONG'} · conf{' '}
                    {p.lastConfidence === null ? '—' : p.lastConfidence.toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-mono font-semibold text-gray-300">{p.count}</p>
                <p className="text-[10px] text-gray-500">signals</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
