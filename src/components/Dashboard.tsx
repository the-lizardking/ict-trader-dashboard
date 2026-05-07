import { useState, useEffect, useCallback } from 'react';
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
import { BotStats, LogEntry } from '../types';
import StatsGrid from './StatsGrid';
import EquityChart from './EquityChart';
import LogViewer from './LogViewer';
import { getMarketAnalysis } from '../services/geminiService';
import { cn } from '../lib/utils';

const BOT_API = import.meta.env.VITE_BOT_API_URL ?? '';

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

const ACTIVE_STRATEGIES = [
  { name: 'FVG Reversal v3', status: 'active', pnl: '+2.4%' },
  { name: 'London Open Killzone', status: 'active', pnl: '+1.1%' },
  { name: 'OTE Scalper', status: 'paused', pnl: '0.0%' },
  { name: 'Silver Bullet', status: 'active', pnl: '+0.8%' },
];

export default function Dashboard() {
  const [activeNav, setActiveNav] = useState('overview');
  const [stats, setStats] = useState<BotStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [statsRes, logsRes] = await Promise.all([
        fetch(`${BOT_API}/api/bot/stats`),
        fetch(`${BOT_API}/api/bot/logs`),
      ]);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
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

  const statusColor =
    stats?.status === 'running'
      ? 'text-emerald-400'
      : stats?.status === 'error'
      ? 'text-red-400'
      : 'text-amber-400';

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
            <span
              className={cn(
                'w-2 h-2 rounded-full',
                stats?.status === 'running' ? 'bg-emerald-400' : 'bg-amber-400'
              )}
            />
            <span className={cn('text-xs font-medium', statusColor)}>
              {stats
                ? stats.status.charAt(0).toUpperCase() + stats.status.slice(1)
                : 'Connecting…'}
            </span>
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
              <p className="text-xs text-gray-500">Symbol</p>
              <p className="text-sm font-semibold text-gray-100">BTCUSDT</p>
            </div>
            <div className="w-px h-8 bg-gray-800" />
            <div>
              <p className="text-xs text-gray-500">Daily Bias</p>
              <p className="text-sm font-semibold text-emerald-400">Bullish</p>
            </div>
            <div className="w-px h-8 bg-gray-800" />
            <div>
              <p className="text-xs text-gray-500">Volatility</p>
              <p className="text-sm font-semibold text-amber-400">Medium</p>
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
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-600/30 transition-colors">
              <AlertTriangle size={13} />
              FORCED STOP
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5 space-y-4">
          <StatsGrid stats={stats} />
          <EquityChart />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="metric-card">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">Active ICT Strategies</h3>
              <div className="space-y-2">
                {ACTIVE_STRATEGIES.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full',
                          s.status === 'active' ? 'bg-emerald-400' : 'bg-gray-600'
                        )}
                      />
                      <span className="text-sm text-gray-300">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 capitalize">{s.status}</span>
                      <span
                        className={cn(
                          'text-sm font-mono font-semibold',
                          s.pnl.startsWith('+') ? 'text-emerald-400' : 'text-gray-400'
                        )}
                      >
                        {s.pnl}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="metric-card">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">Trading Conditions</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Spread</span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full w-1/4 bg-emerald-500 rounded-full" />
                    </div>
                    <span className="text-xs text-gray-400 w-8 text-right">Low</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Volatility Index</span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full w-1/2 bg-amber-500 rounded-full" />
                    </div>
                    <span className="text-xs text-gray-400 w-8 text-right">Med</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Session</span>
                  <span className="text-xs text-blue-400 font-medium">London Open</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Market Phase</span>
                  <span className="text-xs text-gray-300">Accumulation</span>
                </div>
              </div>
            </div>
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
