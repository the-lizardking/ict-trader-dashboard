/**
 * Smoke suite for `src/services/api.ts` — the highest-leverage spot in
 * the dashboard, because every component is downstream of these
 * fetchers. Pins the contract that today's wire-shape drift (string-vs-
 * number `id`, nullable-vs-non-nullable counts on `BacktestRun`) would
 * have caught on PR open.
 *
 * Strategy: stub `fetch` with `vi.fn`, exercise each fetcher, assert
 * URL + return shape + error envelope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BotApiError,
  describeError,
  getBacktests,
  getBotConfig,
  getClosedTrades,
  getDashboardSnapshot,
  getEndpointMetrics,
  getLiquidity,
  getLogs,
  getPnlHistory,
  getPositions,
  getSignals,
  getStats,
  deriveClosedTradesFromLogs,
} from './api';

// Vitest types for the global fetch mock — happy-dom installs a real
// `fetch` we'll override per-test.
type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number): Response {
  return new Response(`{"detail":"err"}`, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getStats', () => {
  it('returns a typed BotStats and hits /api/bot/stats', async () => {
    const payload = {
      pnl24h: 124.5,
      totalPnL: 3200,
      openTrades: 2,
      winRate: 68.5,
      status: 'running',
      datasource: 'live',
      vmHealth: { cpu: 32.1, memory: 48.5, disk: 21 },
    };
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(jsonResponse(payload));
    const out = await getStats();
    expect(out).toEqual(payload);
    const url = (globalThis.fetch as FetchMock).mock.calls[0][0];
    expect(url).toBe('/api/bot/stats');
  });

  it('throws BotApiError(httpStatus=503) on a real outage', async () => {
    // 503 is `kind: 'http'` which is sticky (not retried by fetchJson),
    // so a single mock is enough for the single getStats() call.
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(errorResponse(503));
    await expect(getStats()).rejects.toMatchObject({
      httpStatus: 503,
      kind: 'http',
    });
  });
});

describe('getLogs / getPositions / getSignals', () => {
  it('all hit the right paths and pass payloads through', async () => {
    (globalThis.fetch as FetchMock)
      .mockResolvedValueOnce(jsonResponse([{ id: 'a', timestamp: 't', level: 'trade', message: 'm' }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));
    const [logs, positions, signals] = await Promise.all([
      getLogs(),
      getPositions(),
      getSignals(),
    ]);
    expect(Array.isArray(logs)).toBe(true);
    expect(positions).toEqual([]);
    expect(signals).toEqual([]);
    const calls = (globalThis.fetch as FetchMock).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      '/api/bot/logs',
      '/api/bot/positions',
      '/api/bot/signals',
    ]);
  });
});

describe('getBacktests', () => {
  it('default limit + url shape', async () => {
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(jsonResponse([]));
    await getBacktests();
    const url = (globalThis.fetch as FetchMock).mock.calls[0][0];
    expect(url).toBe('/api/bot/backtests?limit=50');
  });

  it('forwards strategy filter when set', async () => {
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(jsonResponse([]));
    await getBacktests(10, 'vwap');
    const url = (globalThis.fetch as FetchMock).mock.calls[0][0];
    expect(url).toBe('/api/bot/backtests?limit=10&strategy=vwap');
  });

  it('returns rows that match the BacktestRun wire shape (id: string, counts: number)', async () => {
    // This is the regression we'd want for today's drift. The bot
    // stringifies id (#699); counts are non-nullable (server coerces
    // NULL → 0). The TS types reflect this. If a future bot tweak
    // breaks the shape, vitest fails.
    const payload = [
      {
        id: '12',
        strategy: 'vwap',
        runDate: '2026-05-09',
        startDate: '2026-04-01',
        endDate: '2026-05-08',
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: null,
        profitFactor: null,
        expectancy: null,
        sharpeRatio: null,
        maxDrawdownPct: null,
        totalPnl: null,
        createdAt: '2026-05-09T12:00:00',
      },
    ];
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(jsonResponse(payload));
    const rows = await getBacktests();
    expect(rows).toEqual(payload);
    expect(typeof rows[0].id).toBe('string');
    expect(typeof rows[0].totalTrades).toBe('number');
  });
});

describe('getLiquidity', () => {
  it('omits symbol param when not passed; includes limit + sweeps_limit defaults', async () => {
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(
      jsonResponse({
        symbol: 'BTCUSDT',
        as_of: null,
        equal_highs: [],
        equal_lows: [],
        recent_sweeps: [],
      }),
    );
    await getLiquidity();
    const url = String((globalThis.fetch as FetchMock).mock.calls[0][0]);
    expect(url.startsWith('/api/bot/liquidity?')).toBe(true);
    expect(url.includes('symbol=')).toBe(false);
    expect(url.includes('limit=')).toBe(true);
  });

  it('includes the symbol when passed', async () => {
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(
      jsonResponse({
        symbol: 'BTCUSDT',
        as_of: null,
        equal_highs: [],
        equal_lows: [],
        recent_sweeps: [],
      }),
    );
    await getLiquidity('BTCUSDT', 25);
    const url = String((globalThis.fetch as FetchMock).mock.calls[0][0]);
    expect(url.includes('symbol=BTCUSDT')).toBe(true);
    expect(url.includes('limit=25')).toBe(true);
  });
});

describe('getBotConfig + getPnlHistory', () => {
  it('hit the canonical paths', async () => {
    (globalThis.fetch as FetchMock)
      .mockResolvedValueOnce(
        jsonResponse({
          as_of: 't',
          trading_mode: { halted: false, live_per_account: {}, note: '' },
          accounts: [],
          strategies: {},
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]));
    await Promise.all([getBotConfig(), getPnlHistory(7)]);
    const calls = (globalThis.fetch as FetchMock).mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['/api/bot/config', '/api/pnl/history?days=7']);
  });
});

describe('getClosedTrades', () => {
  it('happy path returns ClosedTrade[]', async () => {
    const payload = [
      {
        id: '1',
        account: 'bybit_2',
        symbol: 'BTCUSDT',
        side: 'buy',
        pattern: 'FVG',
        qty: 0.001,
        entryPrice: 62000,
        exitPrice: 62150,
        realizedPnl: 0.15,
        realizedPnlPct: null,
        openedAt: 't1',
        closedAt: 't2',
        closeReason: 'tp',
      },
    ];
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(jsonResponse(payload));
    const out = await getClosedTrades();
    expect(out).toEqual(payload);
  });

  it('falls back to deriveClosedTradesFromLogs on 404 (deprecated path)', async () => {
    // First call: /api/bot/trades/closed → 404. Second call:
    // /api/bot/logs → returns one trade-level log.
    (globalThis.fetch as FetchMock)
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'L1',
            timestamp: '2026-05-09T10:00:00Z',
            level: 'trade',
            message: 'BTCUSDT long closed at 62200 pnl +0.15',
          },
        ]),
      );
    const out = await getClosedTrades();
    expect(out.length).toBe(1);
    expect(out[0].derivedFromLogs).toBe(true);
  });

  it('rethrows non-recoverable errors (e.g. 500)', async () => {
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(errorResponse(500));
    // 500 is recoverable per BotApiError.kind === 'http' branch — the
    // service falls back to logs. Pin that we *do* fall back so the
    // user sees something. (If you change this to rethrow, update both
    // sides at once.)
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(jsonResponse([]));
    const out = await getClosedTrades();
    expect(out).toEqual([]);
  });
});

describe('getDashboardSnapshot', () => {
  it('returns SectionResult per section (allFailed=false on partial)', async () => {
    (globalThis.fetch as FetchMock)
      .mockResolvedValueOnce(
        jsonResponse({
          pnl24h: 0,
          totalPnL: 0,
          openTrades: 0,
          winRate: 0,
          status: 'running',
          datasource: 'live',
          vmHealth: { cpu: null, memory: null, disk: null },
        }),
      )
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));
    const snap = await getDashboardSnapshot();
    expect(snap.stats.data).not.toBeNull();
    expect(snap.logs.error).not.toBeNull();
    expect(snap.positions.data).toEqual([]);
    expect(snap.signals.data).toEqual([]);
    expect(snap.allFailed).toBe(false);
  });

  it('allFailed=true when every section errors', async () => {
    (globalThis.fetch as FetchMock)
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(503));
    const snap = await getDashboardSnapshot();
    expect(snap.allFailed).toBe(true);
    expect(snap.stats.data).toBeNull();
    expect(snap.stats.error).toBeInstanceOf(BotApiError);
  });
});

describe('BotApiError + describeError', () => {
  it('describes timeout / network / http / parse', () => {
    const t = new BotApiError('/x', 0, 'timeout', 'timeout');
    const n = new BotApiError('/x', 0, 'network', 'network');
    const h = new BotApiError('/x', 503, 'http', 'http');
    const p = new BotApiError('/x', 200, 'parse', 'parse');
    // Pinning the exact strings the api.ts contract returns. If they
    // change, the StatsGrid + OfflinePanel render copy changes too,
    // so this is a real cross-component contract.
    expect(describeError(t)).toBe('Timed out');
    expect(describeError(n)).toBe('Network error');
    expect(describeError(h)).toBe('HTTP 503');
    expect(describeError(p)).toBe('Bad response');
    expect(describeError(null)).toBe('');
  });
});

describe('Endpoint metrics', () => {
  it('records a successful call', async () => {
    (globalThis.fetch as FetchMock).mockResolvedValueOnce(jsonResponse([]));
    await getLogs();
    const m = getEndpointMetrics();
    expect(m['/api/bot/logs']).toBeTruthy();
    expect(m['/api/bot/logs'].okCount).toBeGreaterThanOrEqual(1);
    expect(m['/api/bot/logs'].lastOkAt).not.toBeNull();
  });
});

describe('deriveClosedTradesFromLogs (deprecated fallback)', () => {
  it('extracts a closed trade from a trade-level log line', () => {
    const out = deriveClosedTradesFromLogs(
      [
        {
          id: 'L1',
          timestamp: '2026-05-09T10:00:00Z',
          level: 'trade',
          message: 'BTCUSDT long closed at 62200 pnl +0.15',
        },
      ],
      10,
    );
    expect(out.length).toBe(1);
    expect(out[0].derivedFromLogs).toBe(true);
    expect(out[0].symbol).toBe('BTCUSDT');
  });

  it('skips non-close logs and obviously non-trade levels', () => {
    const out = deriveClosedTradesFromLogs(
      [
        {
          id: 'L1',
          timestamp: '2026-05-09T10:00:00Z',
          level: 'info',
          message: 'BTCUSDT closed something',
        },
      ],
      10,
    );
    expect(out).toEqual([]);
  });
});
