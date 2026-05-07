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
