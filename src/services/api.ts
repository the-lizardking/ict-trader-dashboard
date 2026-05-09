import { BotStats, ClosedTrade, LogEntry, Position, Signal } from '../types';

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
 * Closed trades for the Journals tab. The bot endpoint is tracked on
 * ict-trading-bot#557 and may not exist yet — when it 404s we fall
 * back to deriving rows from the audit log so the tab still renders.
 */
export async function getClosedTrades(limit = 50): Promise<ClosedTrade[]> {
  try {
    return await fetchJson<ClosedTrade[]>(`/api/bot/trades/closed?limit=${limit}`);
  } catch (err) {
    const recoverable =
      err instanceof BotApiError &&
      (err.httpStatus === 404 || err.kind === 'parse' || err.kind === 'http');
    if (!recoverable) throw err;
    // Endpoint not deployed yet — derive a best-effort view from logs.
    const logs = await getLogs();
    return deriveClosedTradesFromLogs(logs, limit);
  }
}

/**
 * Best-effort parse of trade-level audit log entries into ClosedTrade rows.
 * Only used while the bot doesn't expose /api/bot/trades/closed (#557).
 * Many fields will be missing — UI must handle nulls gracefully.
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
