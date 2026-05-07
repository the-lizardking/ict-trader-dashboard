import { LogEntry } from '../types';

const levelConfig = {
  error: { label: 'ERROR', className: 'bg-red-500/20 text-red-400 border border-red-500/30' },
  warn: { label: 'WARN', className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
  trade: { label: 'TRADE', className: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' },
  info: { label: 'INFO', className: 'bg-slate-500/20 text-slate-400 border border-slate-500/30' },
};

interface LogViewerProps {
  logs: LogEntry[];
}

export default function LogViewer({ logs }: LogViewerProps) {
  return (
    <div className="metric-card h-80 flex flex-col">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">Live Feed</h3>
      <div className="flex-1 overflow-y-auto space-y-1 font-mono text-xs">
        {logs.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No log entries</p>
        ) : (
          logs.map((entry) => {
            const config = levelConfig[entry.level] ?? levelConfig.info;
            return (
              <div key={entry.id} className="flex items-start gap-2 py-0.5">
                <span className="text-gray-500 shrink-0 w-16">{entry.timestamp.slice(11, 19)}</span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${config.className}`}>
                  {config.label}
                </span>
                <span className="text-gray-300 break-all">{entry.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
