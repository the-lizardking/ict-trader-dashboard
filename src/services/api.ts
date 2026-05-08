import { BotStats, LogEntry, Position, Signal } from '../types';

const BOT_API = import.meta.env.VITE_BOT_API_URL ?? '';

export class BotApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'BotApiError';
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${BOT_API}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new BotApiError(path, res.status, `HTTP ${res.status} on ${path}`);
  }
  return (await res.json()) as T;
}

export const getStats = (): Promise<BotStats> => fetchJson<BotStats>('/api/bot/stats');
export const getLogs = (): Promise<LogEntry[]> => fetchJson<LogEntry[]>('/api/bot/logs');
export const getPositions = (): Promise<Position[]> => fetchJson<Position[]>('/api/bot/positions');
export const getSignals = (): Promise<Signal[]> => fetchJson<Signal[]>('/api/bot/signals');

export interface DashboardSnapshot {
  stats: BotStats;
  logs: LogEntry[];
  positions: Position[];
  signals: Signal[];
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [stats, logs, positions, signals] = await Promise.all([
    getStats(),
    getLogs(),
    getPositions(),
    getSignals(),
  ]);
  return { stats, logs, positions, signals };
}
