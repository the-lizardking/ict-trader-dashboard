import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Cpu,
  HeartPulse,
  RefreshCw,
  Server,
} from 'lucide-react';
import {
  BotApiError,
  describeError,
  getHealthHistory,
  getHealthLatest,
  getHealthServices,
} from '../services/api';
import {
  HealthHistoryEntry,
  HealthHistoryResponse,
  HealthLatestResponse,
  HealthServicesResponse,
} from '../types';
import { cn } from '../lib/utils';

const POLL_MS = 30_000;

interface SystemHealthTabProps {
  vmHealth: { cpu: number | null; memory: number | null; disk: number | null } | null;
  botStatus: string | null;
}

export default function SystemHealthTab({ vmHealth, botStatus }: SystemHealthTabProps) {
  const [latest, setLatest] = useState<HealthLatestResponse | null>(null);
  const [history, setHistory] = useState<HealthHistoryResponse | null>(null);
  const [services, setServices] = useState<HealthServicesResponse | null>(null);
  const [latestErr, setLatestErr] = useState<BotApiError | null>(null);
  const [historyErr, setHistoryErr] = useState<BotApiError | null>(null);
  const [servicesErr, setServicesErr] = useState<BotApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [latestRes, historyRes, servicesRes] = await Promise.allSettled([
      getHealthLatest(),
      getHealthHistory(24),
      getHealthServices(),
    ]);
    if (cancelledRef.current) return;
    if (latestRes.status === 'fulfilled') {
      setLatest(latestRes.value);
      setLatestErr(null);
    } else {
      setLatestErr(toErr(latestRes.reason));
    }
    if (historyRes.status === 'fulfilled') {
      setHistory(historyRes.value);
      setHistoryErr(null);
    } else {
      setHistoryErr(toErr(historyRes.reason));
    }
    if (servicesRes.status === 'fulfilled') {
      setServices(servicesRes.value);
      setServicesErr(null);
    } else {
      setServicesErr(toErr(servicesRes.reason));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [load]);

  const snap = latest?.snapshot ?? null;
  const checks = snap?.checks ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeartPulse size={16} className="text-blue-400" />
          <h1 className="text-base font-semibold text-gray-100">System Health</h1>
          {snap?.timestamp && (
            <span className="text-[10px] text-gray-500">
              last snapshot {formatRelative(snap.timestamp)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-gray-800/60 text-gray-300 border border-gray-700 hover:bg-gray-800 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <SummaryStrip
        snap={snap}
        latestErr={latestErr}
        vmHealth={vmHealth}
        botStatus={botStatus}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ServicesPanel services={services} error={servicesErr} />
        <ChecksPanel checks={checks} present={latest?.present ?? false} error={latestErr} />
      </div>

      <SnapshotDetailPanel snap={snap} present={latest?.present ?? false} error={latestErr} />

      <HistoryPanel history={history} error={historyErr} />
    </div>
  );
}

function SummaryStrip({
  snap,
  latestErr,
  vmHealth,
  botStatus,
}: {
  snap: HealthSnapshotLite | null;
  latestErr: BotApiError | null;
  vmHealth: { cpu: number | null; memory: number | null; disk: number | null } | null;
  botStatus: string | null;
}) {
  const statusTone = toneForStatus(snap?.status ?? null);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="metric-card">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Health</p>
        <p className={cn('text-lg font-semibold mt-0.5', statusTone.text)}>
          {latestErr ? '—' : snap?.status ?? '—'}
        </p>
        <p className="text-[10px] text-gray-500 mt-1 line-clamp-2" title={snap?.summary ?? ''}>
          {latestErr
            ? `Snapshot unavailable (${describeError(latestErr)})`
            : snap?.summary ?? 'No snapshot available'}
        </p>
      </div>
      <div className="metric-card">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Bot Status</p>
        <p className="text-lg font-semibold text-gray-100 mt-0.5">
          {botStatus ? botStatus.charAt(0).toUpperCase() + botStatus.slice(1) : '—'}
        </p>
        <p className="text-[10px] text-gray-500 mt-1">from /api/bot/stats</p>
      </div>
      <div className="metric-card">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">VM Resources</p>
        {vmHealth ? (
          <>
            <p className="text-lg font-semibold text-gray-100 mt-0.5 tabular-nums">
              CPU {fmtPct(vmHealth.cpu)}
            </p>
            <p className="text-[10px] text-gray-500 mt-1">
              RAM {fmtPct(vmHealth.memory)} · Disk {fmtPct(vmHealth.disk)}
            </p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold text-gray-500 mt-0.5">—</p>
            <p className="text-[10px] text-gray-500 mt-1">no VM telemetry</p>
          </>
        )}
      </div>
      <div className="metric-card">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Action Required</p>
        <p
          className={cn(
            'text-xs mt-1 line-clamp-3',
            snap?.action_required ? 'text-amber-300' : 'text-gray-500',
          )}
          title={snap?.action_required ?? ''}
        >
          {snap?.action_required ?? 'No action required'}
        </p>
      </div>
    </div>
  );
}

function ServicesPanel({
  services,
  error,
}: {
  services: HealthServicesResponse | null;
  error: BotApiError | null;
}) {
  return (
    <section className="metric-card">
      <div className="flex items-center gap-2 mb-3">
        <Server size={14} className="text-blue-400" />
        <h3 className="text-sm font-semibold text-gray-200">Services</h3>
      </div>
      {error ? (
        <p className="text-xs text-red-300">
          Services unavailable ({describeError(error)})
        </p>
      ) : services === null ? (
        <SkeletonRows n={2} />
      ) : !services.systemctl_available ? (
        <p className="text-xs text-gray-500">
          systemctl not available on this host — service states cannot be queried.
        </p>
      ) : services.services.length === 0 ? (
        <p className="text-xs text-gray-500">No services reported.</p>
      ) : (
        <ul className="space-y-2">
          {services.services.map((s) => {
            const ok = (s.state ?? '').toLowerCase() === 'active';
            return (
              <li
                key={s.unit}
                className="flex items-center justify-between gap-2 px-2 py-2 rounded-md border border-gray-800 bg-gray-900/40"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs text-gray-200 truncate">{s.unit}</p>
                  <p className="text-[10px] text-gray-500">
                    {s.sub_state ?? '—'}
                    {s.active_enter_iso ? ` · since ${s.active_enter_iso}` : ''}
                  </p>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase',
                    ok
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-red-500/15 text-red-300 border border-red-500/30',
                  )}
                >
                  {ok ? <CheckCircle2 size={10} /> : <CircleAlert size={10} />}
                  {s.state ?? 'unknown'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ChecksPanel({
  checks,
  present,
  error,
}: {
  checks: Record<string, { status: string | null; note: string | null } | null>;
  present: boolean;
  error: BotApiError | null;
}) {
  const entries = Object.entries(checks);
  return (
    <section className="metric-card">
      <div className="flex items-center gap-2 mb-3">
        <Cpu size={14} className="text-blue-400" />
        <h3 className="text-sm font-semibold text-gray-200">Latest Health Checks</h3>
      </div>
      {error ? (
        <p className="text-xs text-red-300">
          Snapshot unavailable ({describeError(error)})
        </p>
      ) : !present ? (
        <p className="text-xs text-gray-500">
          No snapshot at <code>artifacts/health/latest.json</code> yet.
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-gray-500">Snapshot present but contains no per-check rows.</p>
      ) : (
        <div className="overflow-y-auto max-h-80 pr-1">
          <ul className="space-y-1.5">
            {entries.map(([name, data]) => {
              const status = data?.status ?? null;
              const tone = toneForStatus(status);
              return (
                <li
                  key={name}
                  className="flex items-start gap-2 px-2 py-2 rounded-md border border-gray-800 bg-gray-900/30"
                >
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0',
                      tone.badge,
                    )}
                  >
                    {tone.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-200">{name}</p>
                    <p className="text-[10px] text-gray-400 break-words">
                      {data?.note ?? '—'}
                    </p>
                  </div>
                  <span className={cn('text-[10px] uppercase tracking-wider shrink-0', tone.text)}>
                    {status ?? '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function SnapshotDetailPanel({
  snap,
  present,
  error,
}: {
  snap: HealthSnapshotLite | null;
  present: boolean;
  error: BotApiError | null;
}) {
  const [expanded, setExpanded] = useState(false);
  if (error || !present || !snap) return null;
  return (
    <section className="metric-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <h3 className="text-sm font-semibold text-gray-200">Snapshot summary</h3>
        </div>
        <span className="text-[10px] text-gray-500">{snap.model ?? '—'}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 text-xs text-gray-300">
          <p>
            <span className="text-gray-500">Summary: </span>
            {snap.summary ?? '—'}
          </p>
          {snap.action_required && (
            <p>
              <span className="text-gray-500">Action required: </span>
              <span className="text-amber-300">{snap.action_required}</span>
            </p>
          )}
          {snap.error && (
            <p>
              <span className="text-gray-500">Error: </span>
              <span className="text-red-300">
                {snap.error.type}: {snap.error.message}
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function HistoryPanel({
  history,
  error,
}: {
  history: HealthHistoryResponse | null;
  error: BotApiError | null;
}) {
  const [openFile, setOpenFile] = useState<string | null>(null);
  const rows = history?.snapshots ?? [];
  const counts = useMemo(() => {
    const out = { OK: 0, WARNING: 0, ERROR: 0, OTHER: 0 };
    for (const r of rows) {
      const s = (r.status ?? '').toUpperCase();
      if (s === 'OK') out.OK += 1;
      else if (s === 'WARNING') out.WARNING += 1;
      else if (s === 'ERROR') out.ERROR += 1;
      else out.OTHER += 1;
    }
    return out;
  }, [rows]);

  return (
    <section className="metric-card">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <HeartPulse size={14} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-200">Last 24h snapshots</h3>
          <span className="text-[10px] text-gray-500">
            {rows.length} {rows.length === 1 ? 'snapshot' : 'snapshots'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-emerald-400">OK {counts.OK}</span>
          <span className="text-amber-300">WARN {counts.WARNING}</span>
          <span className="text-red-400">ERR {counts.ERROR}</span>
          {counts.OTHER > 0 && <span className="text-gray-400">other {counts.OTHER}</span>}
        </div>
      </div>
      {error ? (
        <p className="text-xs text-red-300">
          History unavailable ({describeError(error)})
        </p>
      ) : history === null ? (
        <SkeletonRows n={4} />
      ) : !history.present ? (
        <p className="text-xs text-gray-500">
          No <code>artifacts/health/</code> directory found on the VM.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">No snapshots in the last 24 hours.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-gray-800 text-[10px] uppercase tracking-wider text-gray-500">
              <tr className="text-left">
                <th className="px-2 py-1.5 font-medium">When</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5 font-medium">Summary</th>
                <th className="px-2 py-1.5 font-medium text-right">Checks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((r) => (
                <HistoryRow
                  key={r.file}
                  entry={r}
                  open={openFile === r.file}
                  onToggle={() => setOpenFile((curr) => (curr === r.file ? null : r.file))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HistoryRow({
  entry,
  open,
  onToggle,
}: {
  entry: HealthHistoryEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const tone = toneForStatus(entry.status);
  const checkRows = Object.entries(entry.checks ?? {});
  return (
    <>
      <tr className="hover:bg-gray-800/30 cursor-pointer" onClick={onToggle}>
        <td className="px-2 py-2 text-gray-300 whitespace-nowrap tabular-nums">
          {formatRelative(entry.timestamp)}
        </td>
        <td className="px-2 py-2">
          <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold', tone.text)}>
            {tone.icon}
            {entry.status ?? '—'}
          </span>
        </td>
        <td className="px-2 py-2 text-gray-400 truncate max-w-[28rem]" title={entry.summary ?? ''}>
          {entry.summary ?? '—'}
        </td>
        <td className="px-2 py-2 text-right text-gray-500">{checkRows.length}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="px-3 py-2 bg-gray-900/40">
            {entry.action_required && (
              <p className="text-[11px] text-amber-300 mb-2">
                <span className="text-gray-500">Action: </span>
                {entry.action_required}
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
              {checkRows.map(([name, status]) => {
                const t = toneForStatus(status);
                return (
                  <div
                    key={name}
                    className={cn(
                      'flex items-center justify-between gap-2 px-2 py-1 rounded border text-[10px]',
                      t.cardBorder,
                    )}
                  >
                    <span className="text-gray-300">{name}</span>
                    <span className={cn('uppercase', t.text)}>{status ?? '—'}</span>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-8 bg-gray-800/30 rounded animate-pulse" />
      ))}
    </div>
  );
}

interface HealthSnapshotLite {
  status: string | null;
  summary: string | null;
  action_required: string | null;
  timestamp: string | null;
  model: string | null;
  error?: { message: string; type: string } | null;
}

function toErr(reason: unknown): BotApiError {
  if (reason instanceof BotApiError) return reason;
  return new BotApiError('?', 0, reason instanceof Error ? reason.message : String(reason), 'network');
}

function fmtPct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(0)}%`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

interface Tone {
  text: string;
  badge: string;
  cardBorder: string;
  icon: React.ReactNode;
}

function toneForStatus(status: string | null): Tone {
  const s = (status ?? '').toLowerCase();
  if (s === 'ok') {
    return {
      text: 'text-emerald-400',
      badge: 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400',
      cardBorder: 'border-emerald-500/20 bg-emerald-500/5',
      icon: <CheckCircle2 size={11} />,
    };
  }
  if (s === 'warning' || s === 'warn') {
    return {
      text: 'text-amber-300',
      badge: 'bg-amber-500/15 border border-amber-500/30 text-amber-300',
      cardBorder: 'border-amber-500/20 bg-amber-500/5',
      icon: <AlertTriangle size={11} />,
    };
  }
  if (s === 'error' || s === 'err') {
    return {
      text: 'text-red-400',
      badge: 'bg-red-500/15 border border-red-500/30 text-red-400',
      cardBorder: 'border-red-500/20 bg-red-500/5',
      icon: <CircleAlert size={11} />,
    };
  }
  return {
    text: 'text-gray-400',
    badge: 'bg-gray-700/30 border border-gray-700 text-gray-400',
    cardBorder: 'border-gray-800 bg-gray-900/30',
    icon: <CircleAlert size={11} />,
  };
}
