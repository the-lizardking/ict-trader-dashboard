import { Position } from '../types';
import { cn } from '../lib/utils';

interface PositionsPanelProps {
  positions: Position[] | null;
  error?: { httpStatus: number; label?: string } | null;
}

function isShort(side: string) {
  const s = side.toLowerCase();
  return s === 'sell' || s === 'short';
}

function formatQty(qty: number) {
  if (Math.abs(qty) >= 1) return qty.toFixed(4);
  return qty.toFixed(6);
}

export default function PositionsPanel({ positions, error }: PositionsPanelProps) {
  if (positions === null) {
    if (error) {
      const hint = error.label || (error.httpStatus ? `HTTP ${error.httpStatus}` : 'Network error');
      return (
        <div className="metric-card">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">Open Positions</h3>
          <p className="text-xs text-red-300 py-4 text-center">Positions unavailable ({hint})</p>
        </div>
      );
    }
    return (
      <div className="metric-card">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Open Positions</h3>
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-8 bg-gray-800/40 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="metric-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">Open Positions</h3>
          <span className="text-xs text-gray-500">0 open</span>
        </div>
        <p className="text-xs text-gray-500 py-4 text-center">No open trades</p>
      </div>
    );
  }

  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Open Positions</h3>
        <span className="text-xs text-gray-500">{positions.length} open</span>
      </div>
      <div className="space-y-2 max-h-56 overflow-y-auto">
        {positions.map((p) => {
          const short = isShort(p.side);
          return (
            <div
              key={p.id}
              className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
                    short
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
                  )}
                >
                  {short ? 'SHORT' : 'LONG'}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 truncate">{p.symbol}</p>
                  <p className="text-[10px] text-gray-500 truncate">
                    {p.account} · {formatQty(p.qty)} @ {p.entryPrice}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p
                  className={cn(
                    'text-sm font-mono font-semibold',
                    p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
                  )}
                >
                  {p.unrealizedPnl >= 0 ? '+' : ''}${p.unrealizedPnl.toFixed(2)}
                </p>
                <p className="text-[10px] text-gray-500">unrealized</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
