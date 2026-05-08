import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  TrendingUp,
  Droplets,
  Clock,
  BookOpen,
  BarChart2,
  Settings,
  RefreshCw,
  Bot,
  AlertTriangle,
  Sparkles,
  X,
} from 'lucide-react';
import { BotStats, LogEntry, Position, Signal, EquityPoint } from '../types';
import StatsGrid from './StatsGrid';
import EquityChart from './EquityChart';
import LogViewer from './LogViewer';
import PositionsPanel from './PositionsPanel';
import StrategySignals from './StrategySignals';
import { getDashboardSnapshot } from '../services/api';
import { getMarketAnalysis } from '../services/geminiService';
import { cn } from '../lib/utils';

const POLL_INTERVAL_MS = 10_000;
const EQUITY_BUFFER_MAX = 60;

const NAV_SECTIONS = [
  {
    label: 'Market Analysis',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'smc', label: 'SMC Concepts', icon: TrendingUp },
      { id: 'liquidity', label: 'Liquidity Maps', icon: Droplets },
      { id: 'time-price', label: 'Time & Price', icon: Clock },
    ],
  },
  {
    label: 'Trading Log',
    items: [
      { id: 'journals', label: 'Journals', icon: BookOpen },
      { id: 'performance', label: 'Performance', icon: BarChart2 },
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

export default function Dashboard() {
  const [activeNav, setActiveNav] = useState('overview');
  const [stats, setStats] = useState<BotStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  const lastEquitySampleRef = useRef<number | null>(null);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const snapshot = await getDashboardSnapshot();
      setStats(snapshot.stats);
      setLogs(snapshot.logs);
      setPositions(snapshot.positions);
      setSignals(snapshot.signals);
      setConnectionError(false);

      // Append a point to the rolling equity buffer; collapse duplicate
      // values so a flat PnL doesn't grow the buffer faster than necessary.
      const totalPnL = snapshot.stats.totalPnL;
      if (lastEquitySampleRef.current !== totalPnL) {
        lastEquitySampleRef.current = totalPnL;
        setEquityHistory((prev) => {
          const next = [
            ...prev,
            { time: formatTime(new Date()), equity: totalPnL },
          ];
          return next.length > EQUITY_BUFFER_MAX
            ? next.slice(next.length - EQUITY_BUFFER_MAX)
            : next;
        });
      }
    } catch (error) {
      console.error('Error fetching dashboard snapshot:', error);
      setConnectionError(true);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleAiAnalysis = async () => {
    setIsAiLoading(true);
    setShowAiModal(true);
    try {
      const logText = logs
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

  const statusLabel = connectionError
    ? 'Offline'
    : stats
    ? stats.status.charAt(0).toUpperCase() + stats.status.slice(1)
    : 'Connecting…';

  const statusColor = connectionError
    ? 'text-red-400'
    : stats?.status === 'running'
    ? 'text-emerald-400'
    : stats?.status === 'error'
    ? 'text-red-400'
    : 'text-amber-400';

  const statusDotColor = connectionError
    ? 'bg-red-400'
    : stats?.status === 'running'
    ? 'bg-emerald-400'
    : 'bg-amber-400';

  const openSymbols = positions ? Array.from(new Set(positions.map((p) => p.symbol))).join(', ') : '';

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#0a0e1a' }}>
      {/* Sidebar */}
      <aside
        className="w-56 shrink-0 flex flex-col border-r border-gray-800"
        style={{ backgroundColor: '#0d1117' }}
      >
        <div className="flex items-center gap-2 px-4 py-5 border-b border-gray-800">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <Bot size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-gray-100">ICT Trader</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
                {section.label}
              </p>
              {section.items.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveNav(id)}
                  className={cn('sidebar-link', activeNav === id && 'sidebar-link-active')}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-800">
          <div className="flex items-center gap-2">
            <span className={cn('w-2 h-2 rounded-full', statusDotColor)} />
            <span className={cn('text-xs font-medium', statusColor)}>{statusLabel}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header
          className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-800"
          style={{ backgroundColor: '#0d1117' }}
        >
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-gray-500">Open Positions</p>
              <p className="text-sm font-semibold text-gray-100">
                {positions === null ? '—' : positions.length}
              </p>
            </div>
            <div className="w-px h-8 bg-gray-800" />
            <div>
              <p className="text-xs text-gray-500">Symbols</p>
              <p className="text-sm font-semibold text-gray-100">
                {openSymbols || '—'}
              </p>
            </div>
            <div className="w-px h-8 bg-gray-800" />
            <div>
              <p className="text-xs text-gray-500">Recent Signals</p>
              <p className="text-sm font-semibold text-gray-100">
                {signals === null ? '—' : signals.length}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {stats && (
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
                  stats.datasource === 'live'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                )}
              >
                {stats.datasource}
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={handleAiAnalysis}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              <Sparkles size={13} />
              AI Analysis
            </button>
            <button
              disabled
              title="Wire to bot /halt endpoint in a follow-up"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-red-600/20 text-red-400 border border-red-600/30 opacity-60 cursor-not-allowed"
            >
              <AlertTriangle size={13} />
              FORCED STOP
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5 space-y-4">
          {connectionError && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-300">
              Cannot reach bot API. Check the Vercel rewrite, the bot service on
              the VPS, and the browser console for details.
            </div>
          )}
          <StatsGrid stats={stats} />
          <EquityChart data={equityHistory} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StrategySignals signals={signals} />
            <PositionsPanel positions={positions} />
          </div>

          <LogViewer logs={logs} />
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
