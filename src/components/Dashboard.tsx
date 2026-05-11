import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Layers,
  Droplets,
  Clock,
  BookOpen,
  FlaskConical,
  BarChart2,
  Settings,
  RefreshCw,
  Bot,
  AlertTriangle,
  CloudOff,
  Sparkles,
  Menu,
  Workflow,
  HeartPulse,
  X,
} from 'lucide-react';
import { BotStats, LogEntry, Position, Signal, EquityPoint } from '../types';
import StatsGrid from './StatsGrid';
import EquityChart from './EquityChart';
import LiveChart from './LiveChart';
import LogViewer from './LogViewer';
import PositionsPanel from './PositionsPanel';
import StrategySignals from './StrategySignals';
import Diagnostics from './Diagnostics';
// Tab components are lazy-loaded so the initial bundle only ships the
// Overview-tab dependencies (the default landing view). Each tab's
// chunk is fetched on first navigation; subsequent visits hit the
// browser's module cache. This drops the entry chunk below Vite's
// 500 kB warning threshold and lets recharts / framer-motion / Gemini
// SDK split into their own vendor chunks (see vite.config.ts).
const BacktestsTab = lazy(() => import('./BacktestsTab'));
const JournalsTab = lazy(() => import('./JournalsTab'));
const ModelsTab = lazy(() => import('./ModelsTab'));
const TimePriceTab = lazy(() => import('./TimePriceTab'));
const PerformanceTab = lazy(() => import('./PerformanceTab'));
const LiquidityMapsTab = lazy(() => import('./LiquidityMapsTab'));
const SettingsTab = lazy(() => import('./SettingsTab'));
const SystemHealthTab = lazy(() => import('./SystemHealthTab'));
const TradeProcessTab = lazy(() => import('./TradeProcessTab'));
import { getDashboardSnapshot, describeError, BotApiError, getBotConfig } from '../services/api';
import { getMarketAnalysis } from '../services/geminiService';
import { cn } from '../lib/utils';

const POLL_INTERVAL_MS = 10_000;
// After a fully-failed tick, retry sooner so the dashboard recovers
// quickly when the bot comes back rather than waiting the full poll
// interval. Capped at the regular cadence.
const POLL_RETRY_MS = 3_000;
const EQUITY_BUFFER_MAX = 60;
// localStorage key for the rolling equity buffer. Bumped if the entry
// shape changes so old payloads are ignored on rehydrate.
const EQUITY_STORAGE_KEY = 'ict-equity-buffer-v1';

function loadEquityBuffer(): EquityPoint[] {
  try {
    const raw = localStorage.getItem(EQUITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: EquityPoint[] = [];
    for (const p of parsed) {
      if (
        p &&
        typeof p === 'object' &&
        typeof p.time === 'string' &&
        typeof p.equity === 'number' &&
        Number.isFinite(p.equity)
      ) {
        out.push({ time: p.time, equity: p.equity });
      }
    }
    return out.length > EQUITY_BUFFER_MAX ? out.slice(out.length - EQUITY_BUFFER_MAX) : out;
  } catch {
    return [];
  }
}

function saveEquityBuffer(points: EquityPoint[]): void {
  try {
    localStorage.setItem(EQUITY_STORAGE_KEY, JSON.stringify(points));
  } catch {
    /* private mode / quota — best effort */
  }
}

const NAV_SECTIONS = [
  {
    label: 'Market Analysis',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'models', label: 'Models', icon: Layers },
      { id: 'liquidity', label: 'Liquidity Maps', icon: Droplets },
      { id: 'time-price', label: 'Time & Price', icon: Clock },
      { id: 'trade-process', label: 'Trade Process', icon: Workflow },
    ],
  },
  {
    label: 'Trading Log',
    items: [
      { id: 'journals', label: 'Journals', icon: BookOpen },
      { id: 'backtests', label: 'Backtests', icon: FlaskConical },
      { id: 'performance', label: 'Performance', icon: BarChart2 },
      { id: 'system-health', label: 'System Health', icon: HeartPulse },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface SectionErr {
  httpStatus: number;
  message: string;
  label: string;
}

function toErr(e: BotApiError | null): SectionErr | null {
  if (!e) return null;
  return { httpStatus: e.httpStatus, message: e.message, label: describeError(e) };
}

function relativeTime(from: Date, now: Date): string {
  const sec = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function OfflinePanel({
  kind,
  httpStatus,
  lastSeen,
  onRetry,
  retrying,
}: {
  kind: string;
  httpStatus: number;
  lastSeen: Date | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  const detail = httpStatus ? `${kind} (HTTP ${httpStatus})` : kind;
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <CloudOff size={20} className="text-red-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-red-200">Bot offline</h2>
          <p className="text-xs text-red-300/90 mt-1">
            The trading bot's API is not responding. Live data is paused until it
            comes back. The dashboard will reconnect automatically.
          </p>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="text-gray-500">Reason</dt>
              <dd className="text-gray-300 truncate" title={detail}>{detail}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-500">Last seen</dt>
              <dd className="text-gray-300">
                {lastSeen ? relativeTime(lastSeen, new Date()) : 'never this session'}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-red-600/20 hover:bg-red-600/30 text-red-200 border border-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={12} className={retrying ? 'animate-spin' : ''} />
              {retrying ? 'Retrying…' : 'Retry now'}
            </button>
            <span className="text-[10px] text-gray-500">auto-retry every 3s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabLoadingFallback({ label }: { label: string }) {
  // Suspense fallback for the lazy-loaded tabs. The chunk fetch is
  // typically <50 ms so this rarely flashes; we still want a stable
  // placeholder so the tab area doesn't collapse to zero height
  // mid-transition. Each tab manages its own data-loading state
  // after its module mounts.
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 px-1 py-2">
      <RefreshCw size={12} className="animate-spin" />
      <span>Loading {label}…</span>
    </div>
  );
}

function DiagnosticsToggle() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-gray-500 hover:text-gray-300 underline-offset-2 hover:underline"
      >
        {open ? 'Hide diagnostics' : 'Show diagnostics'}
      </button>
      {open && (
        <div className="mt-2">
          <Diagnostics />
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [activeNav, setActiveNav] = useState('overview');
  const [stats, setStats] = useState<BotStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>(() => loadEquityBuffer());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [configSymbols, setConfigSymbols] = useState<string[]>([]);

  // Per-section error state. null = healthy on last poll.
  const [statsErr, setStatsErr] = useState<SectionErr | null>(null);
  const [logsErr, setLogsErr] = useState<SectionErr | null>(null);
  const [positionsErr, setPositionsErr] = useState<SectionErr | null>(null);
  const [signalsErr, setSignalsErr] = useState<SectionErr | null>(null);
  // True when the bot is fully unreachable (every endpoint failed this tick).
  const [allFailed, setAllFailed] = useState(false);

  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  // Sidebar visibility — mobile-first: hidden by default on small screens,
  // visible on lg+. Tracked separately for desktop collapse vs mobile drawer
  // because they animate differently.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopNavCollapsed, setDesktopNavCollapsed] = useState(false);

  // Seed from the persisted buffer's last entry so we don't push a duplicate
  // sample on first poll after a refresh when totalPnL hasn't moved yet.
  const lastEquitySampleRef = useRef<number | null>(
    equityHistory.length > 0 ? equityHistory[equityHistory.length - 1].equity : null,
  );
  const lastFailedRef = useRef<boolean>(false);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const snap = await getDashboardSnapshot();

      // Only overwrite known-good slices on success — keep the last
      // good payload visible when a single endpoint flaps.
      if (snap.stats.data) setStats(snap.stats.data);
      if (snap.logs.data) setLogs(snap.logs.data);
      if (snap.positions.data) setPositions(snap.positions.data);
      if (snap.signals.data) setSignals(snap.signals.data);

      setStatsErr(toErr(snap.stats.error));
      setLogsErr(toErr(snap.logs.error));
      setPositionsErr(toErr(snap.positions.error));
      setSignalsErr(toErr(snap.signals.error));
      setAllFailed(snap.allFailed);
      lastFailedRef.current = snap.allFailed;

      if (!snap.allFailed) {
        setLastSuccessAt(new Date());
      }

      const totalPnL = snap.stats.data?.totalPnL;
      if (totalPnL !== undefined && lastEquitySampleRef.current !== totalPnL) {
        lastEquitySampleRef.current = totalPnL;
        setEquityHistory((prev) => {
          const appended = [...prev, { time: formatTime(new Date()), equity: totalPnL }];
          const next =
            appended.length > EQUITY_BUFFER_MAX
              ? appended.slice(appended.length - EQUITY_BUFFER_MAX)
              : appended;
          saveEquityBuffer(next);
          return next;
        });
      }
    } catch (error) {
      // getDashboardSnapshot uses allSettled and never throws, but guard anyway.
      console.error('Unexpected error fetching dashboard snapshot:', error);
      setAllFailed(true);
      lastFailedRef.current = true;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      await fetchData();
      if (cancelled) return;
      // After a full-blackout tick, retry sooner so the dashboard
      // recovers quickly when the bot comes back; otherwise stay on the
      // regular cadence.
      const delay = lastFailedRef.current ? POLL_RETRY_MS : POLL_INTERVAL_MS;
      timer = setTimeout(tick, delay);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchData]);

  // Pull the strategies' configured symbols once so the chart selector
  // doesn't hardcode 'BTCUSDT'. Best-effort: failure here just leaves the
  // selector populated by the live positions feed.
  useEffect(() => {
    let cancelled = false;
    getBotConfig()
      .then((cfg) => {
        if (cancelled) return;
        const set = new Set<string>();
        for (const strat of Object.values(cfg.strategies ?? {})) {
          const syms = (strat as { symbols?: unknown }).symbols;
          if (Array.isArray(syms)) {
            for (const s of syms) {
              if (typeof s === 'string' && s.trim()) set.add(s.trim().toUpperCase());
            }
          }
        }
        setConfigSymbols(Array.from(set).sort());
      })
      .catch(() => {
        /* best effort — selector falls back to positions */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Union of (live position symbols, configured strategy symbols). The
  // chart needs symbols ASAP — using configSymbols alone would hide live
  // symbols not yet in config, so we union both sources.
  const chartSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const p of positions ?? []) {
      if (p.symbol) set.add(p.symbol);
    }
    for (const s of configSymbols) set.add(s);
    if (set.size === 0) set.add('BTCUSDT');
    return Array.from(set).sort();
  }, [positions, configSymbols]);

  const handleAiAnalysis = async () => {
    setIsAiLoading(true);
    setShowAiModal(true);
    try {
      const logText = (logs ?? [])
        .map((l) => `[${l.timestamp}] ${l.level.toUpperCase()}: ${l.message}`)
        .join('\n');
      const analysis = await getMarketAnalysis(logText || 'No recent logs available.');
      setAiAnalysis(analysis);
    } catch {
      setAiAnalysis('Failed to generate analysis. Check your Gemini API key.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const anyError = statsErr || logsErr || positionsErr || signalsErr;

  const statusLabel = allFailed
    ? 'Offline'
    : stats
    ? stats.status.charAt(0).toUpperCase() + stats.status.slice(1)
    : 'Connecting…';

  const statusColor = allFailed
    ? 'text-red-400'
    : stats?.status === 'running'
    ? 'text-emerald-400'
    : stats?.status === 'error'
    ? 'text-red-400'
    : 'text-amber-400';

  const statusDotColor = allFailed
    ? 'bg-red-400'
    : stats?.status === 'running'
    ? 'bg-emerald-400'
    : 'bg-amber-400';

  const openSymbols = positions ? Array.from(new Set(positions.map((p) => p.symbol))).join(', ') : '';

  const closeMobileNav = () => setMobileNavOpen(false);

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between gap-2 px-4 py-5 border-b border-gray-800">
        <div className={cn('flex items-center gap-2', desktopNavCollapsed && 'lg:justify-center lg:w-full')}>
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Bot size={14} className="text-white" />
          </div>
          <span className={cn('text-sm font-semibold text-gray-100', desktopNavCollapsed && 'lg:hidden')}>
            ICT Trader
          </span>
        </div>
        {/* Mobile close */}
        <button
          onClick={closeMobileNav}
          className="lg:hidden text-gray-400 hover:text-gray-100 p-1"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p
              className={cn(
                'px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-600',
                desktopNavCollapsed && 'lg:hidden',
              )}
            >
              {section.label}
            </p>
            {section.items.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  setActiveNav(id);
                  closeMobileNav();
                }}
                title={desktopNavCollapsed ? label : undefined}
                className={cn(
                  'sidebar-link',
                  activeNav === id && 'sidebar-link-active',
                  desktopNavCollapsed && 'lg:justify-center',
                )}
              >
                <Icon size={15} />
                <span className={cn(desktopNavCollapsed && 'lg:hidden')}>{label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-gray-800">
        <div className={cn('flex items-center gap-2', desktopNavCollapsed && 'lg:justify-center')}>
          <span className={cn('w-2 h-2 rounded-full shrink-0', statusDotColor)} />
          <span className={cn('text-xs font-medium', statusColor, desktopNavCollapsed && 'lg:hidden')}>
            {statusLabel}
          </span>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#0a0e1a' }}>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex shrink-0 flex-col border-r border-gray-800 transition-[width] duration-200',
          desktopNavCollapsed ? 'lg:w-16' : 'lg:w-56',
        )}
        style={{ backgroundColor: '#0d1117' }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer + backdrop */}
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMobileNav}
              className="lg:hidden fixed inset-0 bg-black/60 z-40"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.2 }}
              className="lg:hidden fixed top-0 left-0 bottom-0 w-64 max-w-[80vw] flex flex-col border-r border-gray-800 z-50"
              style={{ backgroundColor: '#0d1117' }}
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header
          className="shrink-0 flex items-center justify-between gap-3 px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-800"
          style={{ backgroundColor: '#0d1117' }}
        >
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden text-gray-300 hover:text-white p-1.5 rounded-md hover:bg-gray-800 shrink-0"
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            {/* Desktop collapse toggle */}
            <button
              onClick={() => setDesktopNavCollapsed((v) => !v)}
              className="hidden lg:inline-flex text-gray-400 hover:text-gray-200 p-1.5 rounded-md hover:bg-gray-800"
              aria-label={desktopNavCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Menu size={16} />
            </button>

            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-gray-500">Open Positions</p>
              <p className="text-xs sm:text-sm font-semibold text-gray-100">
                {positions === null ? '—' : positions.length}
              </p>
            </div>
            <div className="hidden sm:block w-px h-8 bg-gray-800" />
            <div className="hidden sm:block min-w-0">
              <p className="text-xs text-gray-500">Symbols</p>
              <p className="text-sm font-semibold text-gray-100 truncate max-w-[14rem]">
                {openSymbols || '—'}
              </p>
            </div>
            <div className="hidden md:block w-px h-8 bg-gray-800" />
            <div className="hidden md:block">
              <p className="text-xs text-gray-500">Recent Signals</p>
              <p className="text-sm font-semibold text-gray-100">
                {signals === null ? '—' : signals.length}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {lastSuccessAt && (
              <span
                className="hidden md:inline text-[10px] text-gray-500"
                title={`Last successful update at ${lastSuccessAt.toLocaleTimeString()}`}
              >
                updated {formatTime(lastSuccessAt)}
              </span>
            )}
            {stats && (
              <span
                className={cn(
                  'hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
                  stats.datasource === 'live'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
                )}
              >
                {stats.datasource}
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={isRefreshing}
              aria-label="Refresh"
              className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={handleAiAnalysis}
              className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              <Sparkles size={13} />
              <span className="hidden sm:inline">AI Analysis</span>
            </button>
            <button
              disabled
              title="Wire to bot /halt endpoint in a follow-up"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-red-600/20 text-red-400 border border-red-600/30 opacity-60 cursor-not-allowed"
            >
              <AlertTriangle size={13} />
              FORCED STOP
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
          {allFailed ? (
            <>
              <OfflinePanel
                kind={statsErr?.label || 'Network error'}
                httpStatus={statsErr?.httpStatus ?? 0}
                lastSeen={lastSuccessAt}
                onRetry={fetchData}
                retrying={isRefreshing}
              />
              <Diagnostics />
            </>
          ) : activeNav === 'journals' ? (
            <Suspense fallback={<TabLoadingFallback label="Journals" />}>
              <JournalsTab />
            </Suspense>
          ) : activeNav === 'backtests' ? (
            <Suspense fallback={<TabLoadingFallback label="Backtests" />}>
              <BacktestsTab />
            </Suspense>
          ) : activeNav === 'models' ? (
            <Suspense fallback={<TabLoadingFallback label="Models" />}>
              <ModelsTab signals={signals} positions={positions} />
            </Suspense>
          ) : activeNav === 'liquidity' ? (
            <Suspense fallback={<TabLoadingFallback label="Liquidity Maps" />}>
              <LiquidityMapsTab />
            </Suspense>
          ) : activeNav === 'time-price' ? (
            <Suspense fallback={<TabLoadingFallback label="Time & Price" />}>
              <TimePriceTab signals={signals} />
            </Suspense>
          ) : activeNav === 'trade-process' ? (
            <Suspense fallback={<TabLoadingFallback label="Trade Process" />}>
              <TradeProcessTab />
            </Suspense>
          ) : activeNav === 'performance' ? (
            <Suspense fallback={<TabLoadingFallback label="Performance" />}>
              <PerformanceTab fallbackEquity={equityHistory} />
            </Suspense>
          ) : activeNav === 'settings' ? (
            <Suspense fallback={<TabLoadingFallback label="Settings" />}>
              <SettingsTab />
            </Suspense>
          ) : activeNav === 'system-health' ? (
            <Suspense fallback={<TabLoadingFallback label="System Health" />}>
              <SystemHealthTab vmHealth={stats?.vmHealth ?? null} botStatus={stats?.status ?? null} />
            </Suspense>
          ) : (
            <>
              {anyError && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                  Some bot endpoints are returning errors — affected panels are flagged below. Other data is still live.
                </div>
              )}
              <StatsGrid stats={stats} error={stats ? null : statsErr} />
              <LiveChart positions={positions} signals={signals} symbols={chartSymbols} />
              <EquityChart data={equityHistory} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <StrategySignals signals={signals} error={signals ? null : signalsErr} />
                <PositionsPanel positions={positions} error={positions ? null : positionsErr} />
              </div>

              <LogViewer logs={logs} error={logs ? null : logsErr} />

              <DiagnosticsToggle />
            </>
          )}
        </main>
      </div>

      {/* AI Analysis Modal */}
      <AnimatePresence>
        {showAiModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowAiModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl rounded-xl border border-gray-700 shadow-2xl"
              style={{ backgroundColor: '#111827' }}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-blue-400" />
                  <span className="text-sm font-semibold text-gray-100">AI Market Analysis</span>
                </div>
                <button
                  onClick={() => setShowAiModal(false)}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 max-h-96 overflow-y-auto">
                {isAiLoading ? (
                  <div className="flex items-center gap-3 py-8 justify-center">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-gray-400">Analyzing market conditions…</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {aiAnalysis}
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
