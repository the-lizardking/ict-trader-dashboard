import { BotStats } from '../types';
import { TrendingUp, Activity, Cpu, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

interface StatsGridProps {
  stats: BotStats | null;
  error?: { httpStatus: number; message: string; label?: string } | null;
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  valueClass,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  valueClass?: string;
}) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">{title}</span>
        <Icon className="text-gray-600" size={16} />
      </div>
      <p className={cn('text-2xl font-semibold', valueClass ?? 'text-gray-100')}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function StatsGrid({ stats, error }: StatsGridProps) {
  if (!stats) {
    if (error) {
      const hint = error.label || (error.httpStatus ? `HTTP ${error.httpStatus}` : 'Network error');
      return (
        <div className="metric-card border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-2 text-red-300 text-xs">
            <AlertCircle size={14} />
            <span>Stats unavailable ({hint})</span>
          </div>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="metric-card animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-2/3 mb-4" />
            <div className="h-7 bg-gray-700 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const pnl24hClass = stats.pnl24h >= 0 ? 'text-emerald-400' : 'text-red-400';
  const statusClass =
    stats.status === 'running'
      ? 'text-emerald-400'
      : stats.status === 'error'
      ? 'text-red-400'
      : 'text-amber-400';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        title="24h Performance"
        value={`${stats.pnl24h >= 0 ? '+' : ''}$${stats.pnl24h.toFixed(2)}`}
        sub={`Total: $${stats.totalPnL.toFixed(2)}`}
        icon={TrendingUp}
        valueClass={pnl24hClass}
      />
      <StatCard
        title="Active Orders"
        value={String(stats.openTrades)}
        sub={`Win rate: ${stats.winRate.toFixed(1)}%`}
        icon={Activity}
      />
      <StatCard
        title="Bot Status"
        value={stats.status.charAt(0).toUpperCase() + stats.status.slice(1)}
        sub={`Source: ${stats.datasource}`}
        icon={AlertCircle}
        valueClass={statusClass}
      />
      <StatCard
        title="Infrastructure"
        value={`${stats.vmHealth.cpu.toFixed(0)}%`}
        sub={`RAM: ${stats.vmHealth.memory.toFixed(0)}%  Disk: ${stats.vmHealth.disk.toFixed(0)}%`}
        icon={Cpu}
      />
    </div>
  );
}
