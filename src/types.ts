export interface Trade {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  status: 'open' | 'closed';
  timestamp: string;
}

export interface BotStats {
  pnl24h: number;
  totalPnL: number;
  openTrades: number;
  winRate: number;
  status: 'running' | 'paused' | 'stopped' | 'error';
  datasource: 'live' | 'mock';
  vmHealth: {
    cpu: number;
    memory: number;
    disk: number;
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
  pattern: string;
  confidence: number;
  price: number;
}

export interface EquityPoint {
  time: string;
  equity: number;
}
