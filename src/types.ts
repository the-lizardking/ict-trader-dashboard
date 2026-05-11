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
  /**
   * Score assigned to this trade during the most recent /health-review
   * (layer-2) run. Null until the bot adds a per-trade scoring hook to the
   * health-check pipeline (queued follow-up — see PR thread). The dashboard
   * renders an em-dash for null so the column lights up automatically once
   * the bot starts populating it.
   */
  healthCheckScore?: number | null;
  /** Optional summary attached to the health-check score (e.g. "TP hit cleanly"). */
  healthCheckNote?: string | null;
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
 * **Wire-shape note:** the bot serialises `id` as a string (matching
 * the `trades_closed` and `positions` endpoints — see
 * ict-trading-bot#699). Count columns
 * (`totalTrades` / `winningTrades` / `losingTrades`) are coerced to
 * `0` server-side via `_coerce_int(...) or 0` in the bot's
 * `_row_to_wire` — they are non-nullable on the wire.
 */
export interface BacktestRun {
  id: string;
  strategy: string | null;
  runDate: string | null;
  startDate: string | null;
  endDate: string | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
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
  // stopLoss / takeProfit / pattern were added to the bot's /api/bot/positions
  // response so the overview chart can overlay TP/SL lines and the positions
  // table can show the active pattern. null on older bot builds — renderers
  // must treat null as "not provided".
  stopLoss?: number | null;
  takeProfit?: number | null;
  pattern?: string | null;
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

/**
 * /api/bot/health/latest — the most recent health snapshot
 * (artifacts/health/latest.json on the VM).
 */
export interface HealthSnapshot {
  status: 'OK' | 'WARNING' | 'ERROR' | string;
  summary: string | null;
  action_required: string | null;
  timestamp: string | null;
  model: string | null;
  checks: Record<string, { status: string | null; note: string | null } | null>;
  error?: { message: string; type: string } | null;
}

export interface HealthLatestResponse {
  present: boolean;
  path: string;
  snapshot: HealthSnapshot | null;
}

export interface HealthHistoryEntry {
  file: string;
  timestamp: string;
  payload_timestamp: string | null;
  status: string | null;
  summary: string | null;
  action_required: string | null;
  model: string | null;
  checks: Record<string, string | null>;
  payload?: HealthSnapshot;
}

export interface HealthHistoryResponse {
  present: boolean;
  dir: string;
  hours: number;
  snapshots: HealthHistoryEntry[];
}

export interface ServiceState {
  unit: string;
  state: string | null;
  sub_state: string | null;
  active_enter_iso: string | null;
}

export interface HealthServicesResponse {
  systemctl_available: boolean;
  services: ServiceState[];
}

/**
 * /api/bot/trades/scores — model-prediction scores joined to each trade's
 * open→close window. `scores` is empty when no shadow predictions landed
 * during the trade window (or the audit log is missing).
 */
export interface TradeShadowScore {
  model_id: string;
  stage: string;
  count: number;
  score_first: number | null;
  score_last: number | null;
  score_min: number | null;
  score_max: number | null;
  score_mean: number | null;
  first_ts: string | null;
  last_ts: string | null;
}

export interface TradeScoreEntry {
  trade_id: string;
  symbol: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  scores: TradeShadowScore[];
}

export interface TradeScoresResponse {
  log_present: boolean;
  log_path: string;
  shadow_record_count: number;
  trades: TradeScoreEntry[];
}
