import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { getEndpointMetrics, EndpointMetric, describeError } from '../services/api';

const KNOWN_ENDPOINTS = [
  '/api/bot/stats',
  '/api/bot/logs',
  '/api/bot/positions',
  '/api/bot/signals',
];

function relativeTime(d: Date | null): string {
  if (!d) return 'never';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function statusOf(m: EndpointMetric | undefined): 'ok' | 'fail' | 'unknown' {
  if (!m) return 'unknown';
  if (m.lastOkAt && m.lastErrorAt) {
    return m.lastOkAt.getTime() >= m.lastErrorAt.getTime() ? 'ok' : 'fail';
  }
  if (m.lastOkAt) return 'ok';
  if (m.lastErrorAt) return 'fail';
  return 'unknown';
}

export default function Diagnostics() {
  // Re-render every second so "Last ok 12s ago" stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const all = getEndpointMetrics();
  const paths = Array.from(new Set([...KNOWN_ENDPOINTS, ...Object.keys(all)]));

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40">
      <div className="px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-gray-100">Endpoint diagnostics</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Per-endpoint status from this session. Useful when capturing screenshots of feed issues.
        </p>
      </div>
      <div className="divide-y divide-gray-800">
        {paths.map((path) => {
          const m = all[path];
          const status = statusOf(m);
          return (
            <div
              key={path}
              className="grid grid-cols-12 gap-2 px-4 py-2.5 text-xs items-center"
            >
              <div className="col-span-1 flex items-center justify-center">
                {status === 'ok' && <CheckCircle2 size={14} className="text-emerald-400" />}
                {status === 'fail' && <XCircle size={14} className="text-red-400" />}
                {status === 'unknown' && <Clock size={14} className="text-gray-600" />}
              </div>
              <code className="col-span-5 sm:col-span-4 text-gray-300 font-mono truncate">{path}</code>
              <div className="col-span-2 text-gray-400 text-right tabular-nums">
                {m?.lastMs != null ? `${m.lastMs}ms` : '—'}
              </div>
              <div className="col-span-4 sm:col-span-3 text-gray-500 truncate" title={m?.lastOkAt?.toISOString()}>
                ok {relativeTime(m?.lastOkAt ?? null)}
              </div>
              <div
                className="hidden sm:block sm:col-span-2 text-gray-500 truncate"
                title={m?.lastError?.message}
              >
                {m?.lastError ? describeError(m.lastError) : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
