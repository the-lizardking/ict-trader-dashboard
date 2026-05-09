import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldAlert,
} from 'lucide-react';
import { BotAccount, BotConfigResponse, BotStrategyConfig } from '../types';
import { BotApiError, describeError, getBotConfig } from '../services/api';
import { cn } from '../lib/utils';

const POLL_MS = 60_000;

export default function SettingsTab() {
  const [config, setConfig] = useState<BotConfigResponse | null>(null);
  const [error, setError] = useState<BotApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await getBotConfig();
      if (cancelledRef.current) return;
      setConfig(resp);
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
    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [fetchOnce]);

  return (
    <div className="space-y-4">
      <Header loading={loading} onRefresh={fetchOnce} asOf={config?.as_of ?? null} />
      <ReadOnlyBanner />

      {error && config === null && <ErrorNotice err={error} />}

      {config === null && !error ? (
        <SkeletonStack />
      ) : config ? (
        <>
          <ModeStrip
            halted={config.trading_mode.halted}
            livePerAccount={config.trading_mode.live_per_account}
            note={config.trading_mode.note}
          />
          <AccountsSection
            accounts={config.accounts}
            livePerAccount={config.trading_mode.live_per_account}
          />
          <StrategiesSection strategies={config.strategies} />
        </>
      ) : null}
    </div>
  );
}

function Header({
  loading,
  onRefresh,
  asOf,
}: {
  loading: boolean;
  onRefresh: () => void;
  asOf: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <SettingsIcon size={16} className="text-blue-400 shrink-0" />
        <h1 className="text-base font-semibold text-gray-100 truncate">Settings</h1>
        <span className="text-[10px] text-gray-500 hidden sm:inline">
          read-only effective config
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {asOf && (
          <span className="text-[10px] text-gray-500 hidden md:inline tabular-nums">
            as of {fmtIsoShort(asOf)}
          </span>
        )}
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
  );
}

function ReadOnlyBanner() {
  return (
    <div className="rounded-md border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-xs text-blue-200 flex items-start gap-2">
      <Lock size={14} className="text-blue-300 shrink-0 mt-0.5" />
      <div>
        <strong>Read-only.</strong> The bot exposes config but no mutating
        controls yet. Halt, start, restart, and live/dry toggles ship in
        S-065 (gated behind a session + per-action confirm token). Strategy
        parameter editing is Tier 3 — never via this surface.
      </div>
    </div>
  );
}

function ModeStrip({
  halted,
  livePerAccount,
  note,
}: {
  halted: boolean;
  livePerAccount: Record<string, boolean>;
  note: string;
}) {
  const liveCount = Object.values(livePerAccount).filter(Boolean).length;
  const dryCount = Object.values(livePerAccount).filter((v) => !v).length;
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill
            tone={halted ? 'amber' : 'emerald'}
            icon={halted ? AlertTriangle : CheckCircle2}
            label={halted ? 'Halted' : 'Running'}
          />
          {liveCount > 0 && (
            <Pill tone="emerald" icon={CheckCircle2} label={`${liveCount} live`} />
          )}
          {dryCount > 0 && (
            <Pill tone="gray" icon={ShieldAlert} label={`${dryCount} dry-run`} />
          )}
          {Object.keys(livePerAccount).length === 0 && (
            <Pill tone="gray" icon={ShieldAlert} label="no runtime snapshot" />
          )}
        </div>
      </div>
      <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">{note}</p>
    </div>
  );
}

function AccountsSection({
  accounts,
  livePerAccount,
}: {
  accounts: BotAccount[];
  livePerAccount: Record<string, boolean>;
}) {
  if (accounts.length === 0) {
    return (
      <SectionShell title="Accounts">
        <p className="text-xs text-gray-500">No accounts configured.</p>
      </SectionShell>
    );
  }
  return (
    <SectionShell title="Accounts">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60 border-b border-gray-800 text-[10px] uppercase tracking-wider text-gray-500">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Exchange</th>
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-3 py-2 font-medium">Strategies</th>
              <th className="px-3 py-2 font-medium">Yaml mode</th>
              <th className="px-3 py-2 font-medium">Runtime mode</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {accounts.map((a) => {
              const runtimeLive = livePerAccount[a.id];
              return (
                <tr key={a.id} className="hover:bg-gray-800/30">
                  <td className="px-3 py-2 font-mono text-gray-200">{a.id}</td>
                  <td className="px-3 py-2 text-gray-300">{a.exchange ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-300">{a.market_type ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-300">
                    {(a.strategies ?? []).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <YamlModeChip mode={a.yaml_mode ?? 'live'} />
                  </td>
                  <td className="px-3 py-2">
                    {runtimeLive === undefined ? (
                      <span className="text-[10px] text-gray-500">no snapshot</span>
                    ) : runtimeLive ? (
                      <Pill tone="emerald" icon={CheckCircle2} label="live" small />
                    ) : (
                      <Pill tone="gray" icon={ShieldAlert} label="dry" small />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {accounts.some((a) => a.risk) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {accounts.map((a) =>
            a.risk ? (
              <div
                key={`risk-${a.id}`}
                className="rounded-md border border-gray-800 bg-gray-900/60 p-3"
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  {a.id} · risk caps
                </p>
                <KvList obj={a.risk} />
              </div>
            ) : null,
          )}
        </div>
      )}
    </SectionShell>
  );
}

function StrategiesSection({
  strategies,
}: {
  strategies: Record<string, BotStrategyConfig>;
}) {
  const entries = Object.entries(strategies);
  if (entries.length === 0) {
    return (
      <SectionShell title="Strategies">
        <p className="text-xs text-gray-500">No strategies configured.</p>
      </SectionShell>
    );
  }
  return (
    <SectionShell title="Strategies">
      <div className="space-y-2">
        {entries.map(([name, cfg]) => (
          <details
            key={name}
            className="rounded-md border border-gray-800 bg-gray-900/60 group"
            open
          >
            <summary className="cursor-pointer px-3 py-2 text-xs flex items-center justify-between gap-2 list-none">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-gray-200">{name}</span>
                {cfg.enabled === true ? (
                  <Pill tone="emerald" icon={CheckCircle2} label="enabled" small />
                ) : cfg.enabled === false ? (
                  <Pill tone="gray" icon={ShieldAlert} label="disabled" small />
                ) : null}
              </div>
              <span className="text-[10px] text-gray-500 group-open:hidden">
                expand
              </span>
            </summary>
            <div className="px-3 pb-3 pt-1">
              <KvList obj={cfg as Record<string, unknown>} skipKeys={['enabled']} />
            </div>
          </details>
        ))}
      </div>
    </SectionShell>
  );
}

function SectionShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs uppercase tracking-wider text-gray-500 px-1">
        {title}
      </h3>
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
        <div className="p-3">{children}</div>
      </div>
    </section>
  );
}

function KvList({
  obj,
  skipKeys = [],
}: {
  obj: Record<string, unknown>;
  skipKeys?: string[];
}) {
  const entries = Object.entries(obj).filter(([k]) => !skipKeys.includes(k));
  if (entries.length === 0) {
    return <p className="text-[10px] text-gray-500">No fields.</p>;
  }
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-gray-500">{k}</dt>
          <dd className="font-mono text-gray-200 break-all">{fmtValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function YamlModeChip({ mode }: { mode: string }) {
  const live = mode.toLowerCase() === 'live';
  return (
    <Pill
      tone={live ? 'emerald' : 'gray'}
      icon={live ? CheckCircle2 : ShieldAlert}
      label={mode}
      small
    />
  );
}

function Pill({
  tone,
  icon: Icon,
  label,
  small = false,
}: {
  tone: 'emerald' | 'amber' | 'gray';
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  small?: boolean;
}) {
  const toneClass = {
    emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    gray: 'bg-gray-700/30 text-gray-300 border-gray-700',
  }[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border rounded-full',
        small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
        toneClass,
      )}
    >
      <Icon size={small ? 10 : 12} />
      {label}
    </span>
  );
}

function ErrorNotice({ err }: { err: BotApiError }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
      Bot config unavailable ({describeError(err)}). Retrying every minute.
    </div>
  );
}

function SkeletonStack() {
  return (
    <div className="space-y-4">
      <div className="metric-card animate-pulse h-16" />
      <div className="metric-card animate-pulse h-32" />
      <div className="metric-card animate-pulse h-32" />
    </div>
  );
}

function fmtIsoShort(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return v.map((x) => fmtValue(x)).join(', ');
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
