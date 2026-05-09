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
