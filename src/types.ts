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

/**
 * One row from the bot's `backtest_results` table — the M5 strategy-test
 * consumer writes one per `/test <strategy>` invocation. Surfaced via
 * `GET /api/bot/backtests` (M5 P4) for the Backtests tab.
 *
 * The bot returns headline metrics only; the full row (config blob,
 * total_pnl_pct, avg_win/loss, largest_win/loss) lives in
 * `trade_journal.db::backtest_results` and can be pulled by `id`.
 *
 * **Wire-shape note:** the bot serialises `id` as a string (matching the
 * `trades_closed` and `positions` endpoints) — not a number. Every
 * count column (`totalTrades` / `winningTrades` / `losingTrades`) is
 * nullable: an aborted backtest can land in the table with NULL counts.
 */
export interface BacktestRun {
  id: string;
  strategy: string | null;
  runDate: string | null;
  startDate: string | null;
  endDate: string | null;
  totalTrades: number | null;
  winningTrades: number | null;
  losingTrades: number | null;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  sharpeRatio: number | null;
  maxDrawdownPct: number | null;
  totalPnl: number | null;
  createdAt: string | null;
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

/**
 * One liquidity zone from /api/bot/liquidity (S-064). The bot serialises
 * pools the strategy layer detects into a wire-stable shape: side
 * (buy = equal highs / BSL; sell = equal lows / SSL), the level price,
 * how many times it was touched, the first / last touch ISO timestamps,
 * and whether price has since swept through the level (with the sweep
 * timestamp).
 */
export interface LiquidityZone {
  side: 'buy' | 'sell';
  price: number;
  touches: number;
  first_touch: string | null;
  last_touch: string | null;
  swept: boolean;
  sweep_time: string | null;
}

export interface LiquiditySweep {
  side: 'buy' | 'sell';
  price: number;
  swept_at: string;
}

/**
 * Response shape for /api/bot/liquidity?symbol=X (S-064). Fields are
 * always present even on the empty path so the dashboard doesn't have
 * to branch on missing keys.
 */
export interface LiquidityResponse {
  symbol: string;
  as_of: string | null;
  equal_highs: LiquidityZone[];
  equal_lows: LiquidityZone[];
  recent_sweeps: LiquiditySweep[];
  available_symbols?: string[];
}

/**
 * Subset of /api/bot/config (S-064) the Settings tab consumes. Field
 * names follow the bot's wire shape — re-using server names instead of
 * camelCasing to keep the dashboard a thin viewer.
 */
export interface BotAccount {
  id: string;
  type?: string;
  exchange?: string;
  market_type?: string;
  yaml_mode?: string;
  strategies?: string[];
  enabled?: boolean;
  risk?: Record<string, number | string>;
}

export interface BotStrategyConfig {
  enabled?: boolean;
  risk_pct?: number;
  timeframe?: string;
  symbols?: string[];
  // Strategy params are open-ended; allow any safe scalar / list.
  [key: string]: unknown;
}

export interface BotConfigResponse {
  as_of: string;
  trading_mode: {
    halted: boolean;
    live_per_account: Record<string, boolean>;
    note: string;
  };
  accounts: BotAccount[];
  strategies: Record<string, BotStrategyConfig>;
}
