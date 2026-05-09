export interface ClosedTrade {
  id: string;
  account: string;
  symbol: string;
  side: 'buy' | 'sell' | 'long' | 'short' | string;
  pattern?: string | null;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  realizedPnlPct?: number | null;
  openedAt: string;
  closedAt: string;
  closeReason?: 'tp' | 'sl' | 'manual' | 'reconciler' | 'other' | string | null;
  /** When true, the row was derived client-side from /api/bot/logs because the
   *  bot has no /api/bot/trades/closed endpoint yet. Best-effort, missing fields. */
  derivedFromLogs?: boolean;
}

export interface BotStats {
  pnl24h: number;
  totalPnL: number;
  openTrades: number;
  winRate: number;
  status: 'running' | 'paused' | 'stopped' | 'error';
  datasource: 'live' | 'mock';
  // Per-field nullable: bot returns null for any reading whose
  // psutil sample failed (ict-trading-bot#556). Render `—` for null,
  // a real `0%` for an actual zero measurement.
  vmHealth: {
    cpu: number | null;
    memory: number | null;
    disk: number | null;
  };
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'trade';
  message: string;
}

export interface Position {
  id: string;
  account: string;
  symbol: string;
  side: 'buy' | 'sell' | 'long' | 'short' | string;
  qty: number;
  entryPrice: number;
  unrealizedPnl: number;
  openedAt: string;
}

export interface Signal {
  id: string;
  timestamp: string;
  symbol: string;
  side: 'buy' | 'sell' | 'long' | 'short' | string;
  // pattern / confidence / price are null when the bot writer didn't
  // populate them on the originating audit row (ict-trading-bot#556).
  // Renderers must skip rows with null pattern rather than fall through
  // to "unknown".
  pattern: string | null;
  confidence: number | null;
  price: number | null;
}

export interface EquityPoint {
  time: string;
  equity: number;
}

/**
 * One row from `/api/pnl/history?days=N`. The bot returns one entry per
 * UTC trading day in the requested window (oldest → newest).
 *
 * `cumulativePnl` is "running total at end-of-day" if the bot supplies it;
 * otherwise the dashboard derives it client-side. `trades / wins / losses`
 * are optional — older bot builds may not populate them, in which case the
 * win-loss ratio in the header strip falls back to "—".
 */
export interface PnlHistoryPoint {
  date: string;
  pnl: number;
  cumulativePnl?: number | null;
  trades?: number | null;
  wins?: number | null;
  losses?: number | null;
}
