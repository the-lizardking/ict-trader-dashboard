import { BotStats, LogEntry, Position, Signal } from '../types';

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

async function fetchOnce<T>(path: string, timeoutMs: number): Promise<T> {
  const url = `${BOT_API}${path}`;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) {
      throw new BotApiError(path, res.status, `HTTP ${res.status} on ${path}`, 'http');
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BotApiError(path, res.status, `Bad JSON from ${path}: ${msg}`, 'parse');
    }
  } catch (err) {
    if (err instanceof BotApiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (timedOut) {
      throw new BotApiError(path, 0, `Timed out after ${timeoutMs}ms on ${path}`, 'timeout');
    }
    throw new BotApiError(path, 0, msg, 'network');
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
