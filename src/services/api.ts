import {
  BotConfigResponse,
  BotStats,
  ClosedTrade,
  LiquidityResponse,
  LogEntry,
  PnlHistoryPoint,
  Position,
  Signal,
} from '../types';

const BOT_API = import.meta.env.VITE_BOT_API_URL ?? '';
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_000;
const RETRY_ATTEMPTS = 1; // total tries = 1 + RETRY_ATTEMPTS

export class BotApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly httpStatus: number,
    message: string,
    /**
     * Coarse classification so the UI can show a useful hint. 'timeout'
     * means our AbortController fired; 'network' means fetch itself
     * threw (DNS, connection refused, TLS, etc.); 'http' means the
     * server responded with a non-2xx; 'parse' means JSON decode failed.
     */
    public readonly kind: 'http' | 'timeout' | 'network' | 'parse' = 'http',
  ) {
    super(message);
    this.name = 'BotApiError';
  }
}

export interface EndpointMetric {
  /** Last fetch latency in ms (last attempt, success or failure). */
  lastMs: number | null;
  lastOkAt: Date | null;
  lastErrorAt: Date | null;
  lastError: BotApiError | null;
  okCount: number;
  errorCount: number;
}

const metrics: Map<string, EndpointMetric> = new Map();

function getOrInitMetric(path: string): EndpointMetric {
  let m = metrics.get(path);
  if (!m) {
    m = { lastMs: null, lastOkAt: null, lastErrorAt: null, lastError: null, okCount: 0, errorCount: 0 };
    metrics.set(path, m);
  }
  return m;
}

/** Snapshot of all per-endpoint metrics, keyed by path. Read-only copy. */
export function getEndpointMetrics(): Record<string, EndpointMetric> {
  const out: Record<string, EndpointMetric> = {};
  metrics.forEach((m, k) => {
    out[k] = { ...m };
  });
  return out;
}

async function fetchOnce<T>(path: string, timeoutMs: number): Promise<T> {
  const url = `${BOT_API}${path}`;
  const ctrl = new AbortController();
  const m = getOrInitMetric(path);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const startedAt = performance.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) {
      throw new BotApiError(path, res.status, `HTTP ${res.status} on ${path}`, 'http');
    }
    try {
      const json = (await res.json()) as T;
      m.lastMs = Math.round(performance.now() - startedAt);
      m.lastOkAt = new Date();
      m.okCount += 1;
      return json;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BotApiError(path, res.status, `Bad JSON from ${path}: ${msg}`, 'parse');
    }
  } catch (err) {
    m.lastMs = Math.round(performance.now() - startedAt);
    m.lastErrorAt = new Date();
    m.errorCount += 1;
    if (err instanceof BotApiError) {
      m.lastError = err;
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const wrapped = timedOut
      ? new BotApiError(path, 0, `Timed out after ${timeoutMs}ms on ${path}`, 'timeout')
      : new BotApiError(path, 0, msg, 'network');
    m.lastError = wrapped;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetchOnce<T>(path, timeoutMs);
    } catch (err) {
      lastErr = err;
      // Only retry on transient network / timeout. HTTP 4xx/5xx and parse
      // errors are sticky — retrying just hides the real cause.
      const isTransient =
        err instanceof BotApiError && (err.kind === 'network' || err.kind === 'timeout');
      if (!isTransient || attempt === RETRY_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw lastErr;
}

export const getStats = (): Promise<BotStats> => fetchJson<BotStats>('/api/bot/stats');
export const getLogs = (): Promise<LogEntry[]> => fetchJson<LogEntry[]>('/api/bot/logs');
export const getPositions = (): Promise<Position[]> => fetchJson<Position[]>('/api/bot/positions');
export const getSignals = (): Promise<Signal[]> => fetchJson<Signal[]>('/api/bot/signals');

/**
 * Daily P&L history for the Performance tab. The bot endpoint was JWT-gated
 * in older builds; S-063 dropped the gate on the read-only path so the SPA
 * can hit it without a session. If the gate is still in place (or the bot is
 * rolling), the call surfaces as a 401 / network error and PerformanceTab
 * falls back to the localStorage equity buffer.
 */
export const getPnlHistory = (days: number): Promise<PnlHistoryPoint[]> =>
  fetchJson<PnlHistoryPoint[]>(`/api/pnl/history?days=${days}`);

/**
 * Per-symbol liquidity zones for the Liquidity Maps tab (S-064).
 * The bot endpoint reads runtime_logs/liquidity_state.json which the
 * pipeline writes per tick. Empty / missing file → 200 with empty
 * arrays, so the consumer doesn't have to special-case "no data".
 */
export const getLiquidity = (
  symbol?: string,
  limit = 25,
): Promise<LiquidityResponse> => {
  const params = new URLSearchParams();
  if (symbol) params.set('symbol', symbol);
  params.set('limit', String(limit));
  return fetchJson<LiquidityResponse>(`/api/bot/liquidity?${params.toString()}`);
};

/**
 * Read-only effective config view for the Settings tab (S-064).
 * The bot endpoint redacts secrets server-side.
 */
export const getBotConfig = (): Promise<BotConfigResponse> =>
  fetchJson<BotConfigResponse>('/api/bot/config');

/**
 * Closed trades for the Journals tab. The bot endpoint
 * (`/api/bot/trades/closed`) shipped via ict-trading-bot#557 (closed
 * 2026-05-09). The 404 fallback below is a deprecated transitional
 * path — when it fires today, the bot is misconfigured (e.g. the
 * `ict-web-api` service is down or the deploy is stale) and the
 * derived rows are misleading rather than helpful. We log a
 * deprecation warning so a regression in production is observable
 * via the browser console + Sentry rather than silently rendering
 * fabricated rows.
 */
export async function getClosedTrades(limit = 50): Promise<ClosedTrade[]> {
  try {
    return await fetchJson<ClosedTrade[]>(`/api/bot/trades/closed?limit=${limit}`);
  } catch (err) {
    const recoverable =
      err instanceof BotApiError &&
      (err.httpStatus === 404 || err.kind === 'parse' || err.kind === 'http');
    if (!recoverable) throw err;
    // Bot is supposed to expose /api/bot/trades/closed (#557 closed
    // 2026-05-09). If we end up here, something's wrong upstream; log
    // a deprecation warning so the regression is observable.
    // eslint-disable-next-line no-console
    console.warn(
      '[deprecated] /api/bot/trades/closed unreachable — falling back to ' +
      'deriveClosedTradesFromLogs(). This path is best-effort and will be ' +
      'removed once we confirm the bot endpoint is reachable from production.',
    );
    const logs = await getLogs();
    return deriveClosedTradesFromLogs(logs, limit);
  }
}

/**
 * @deprecated Best-effort parse of trade-level audit log entries into
 *   ClosedTrade rows. Used only as a transitional fallback while
 *   `/api/bot/trades/closed` (ict-trading-bot#557) is unreachable;
 *   when it fires today the bot is misconfigured and the derived
 *   rows are unreliable (no qty, no entry price, fabricated
 *   `account: 'unknown'`). Plan: remove once Vercel logs confirm
 *   the fallback hasn't fired in production for one full week.
 */
export function deriveClosedTradesFromLogs(logs: LogEntry[], limit = 50): ClosedTrade[] {
  const out: ClosedTrade[] = [];
  for (const l of logs) {
    if (l.level !== 'trade') continue;
    const closedMatch = /clos(?:ed|ing)\b/i.test(l.message);
    if (!closedMatch) continue;
    const symMatch = l.message.match(/\b([A-Z]{2,10}USDT?|[A-Z]{2,10}-PERP|[A-Z]{2,10}\/[A-Z]{2,10})\b/);
    const sideMatch = l.message.match(/\b(long|short|buy|sell)\b/i);
    const pnlMatch = l.message.match(/(?:pnl|p&l|profit|loss)[^\-+\d]*([\-+]?\d+(?:\.\d+)?)/i);
    const priceMatch = l.message.match(/(?:at|@|price)\s*\$?(\d+(?:\.\d+)?)/i);
    const realizedPnl = pnlMatch ? parseFloat(pnlMatch[1]) : 0;
    const exitPrice = priceMatch ? parseFloat(priceMatch[1]) : 0;
    out.push({
      id: l.id,
      account: 'unknown',
      symbol: symMatch?.[1] ?? '—',
      side: sideMatch?.[1].toLowerCase() ?? '—',
      pattern: null,
      qty: 0,
      entryPrice: 0,
      exitPrice,
      realizedPnl,
      realizedPnlPct: null,
      openedAt: l.timestamp,
      closedAt: l.timestamp,
      closeReason: null,
      derivedFromLogs: true,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export interface SectionResult<T> {
  data: T | null;
  error: BotApiError | null;
}

export interface DashboardSnapshot {
  stats: SectionResult<BotStats>;
  logs: SectionResult<LogEntry[]>;
  positions: SectionResult<Position[]>;
  signals: SectionResult<Signal[]>;
  /** True when every section failed — i.e. the bot is unreachable. */
  allFailed: boolean;
}

function settle<T>(p: PromiseSettledResult<T>): SectionResult<T> {
  if (p.status === 'fulfilled') return { data: p.value, error: null };
  const err =
    p.reason instanceof BotApiError
      ? p.reason
      : new BotApiError(
          '?',
          0,
          p.reason instanceof Error ? p.reason.message : String(p.reason),
          'network',
        );
  return { data: null, error: err };
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [stats, logs, positions, signals] = await Promise.allSettled([
    getStats(),
    getLogs(),
    getPositions(),
    getSignals(),
  ]);
  const result = {
    stats: settle(stats),
    logs: settle(logs),
    positions: settle(positions),
    signals: settle(signals),
    allFailed: false,
  };
  result.allFailed =
    !!result.stats.error &&
    !!result.logs.error &&
    !!result.positions.error &&
    !!result.signals.error;
  return result;
}

/** UI-friendly description of a fetch failure ("Timed out", "Network error", "HTTP 502"...). */
export function describeError(err: BotApiError | null | undefined): string {
  if (!err) return '';
  if (err.kind === 'timeout') return 'Timed out';
  if (err.kind === 'network') return 'Network error';
  if (err.kind === 'parse') return 'Bad response';
  return err.httpStatus ? `HTTP ${err.httpStatus}` : 'Error';
}
