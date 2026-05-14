// Shared aggregation logic for the CF Pages JS port of api/widget.py.
// Files prefixed with `_` are not routed by CF Pages Functions.

const DEFAULT_BOT_API = "http://158.178.210.252:8001";
const TIMEOUT_MS    = 6_000;
const TRADES_LIMIT  = 50;
const EXEC_HINTS    = ["ict-bot", "ict-web-api", "ict-trader"];
const TRAIN_HINTS   = ["ict-trainer"];

async function fetchJson(url, signal) {
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function serviceUp(services, hints) {
  if (!Array.isArray(services)) return null;
  let matched = false;
  for (const svc of services) {
    const name = (svc.name || svc.unit || "").toLowerCase();
    if (!hints.some((h) => name.includes(h))) continue;
    matched = true;
    const state = (svc.active_state || svc.state || "").toLowerCase();
    if (state === "active") return true;
  }
  return matched ? false : null;
}

function strategyDots(payload) {
  const list = (payload && payload.strategies) || [];
  return list.map((s) => ({ name: s.name || "?", up: Boolean(s.enabled) }));
}

function parseIso(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function recentTrades(trades) {
  if (!Array.isArray(trades)) return [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const rows = [];
  for (const t of trades) {
    const ts = parseIso(t.closedAt || t.closeTime || t.openedAt);
    if (!ts || ts.getTime() < cutoff) continue;
    rows.push({
      time:   ts.toISOString(),
      symbol: t.symbol ?? null,
      side:   t.side ?? null,
      size:   t.qty ?? null,
      pnl:    t.realizedPnl ?? null,
    });
  }
  rows.sort((a, b) => (a.time < b.time ? 1 : -1));
  return rows;
}

export async function handleWidget(env) {
  const base  = (env && env.BOT_API_URL) || DEFAULT_BOT_API;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const [stats, strategies, servicesResp, trades] = await Promise.all([
      fetchJson(`${base}/api/bot/stats`,                              ctrl.signal),
      fetchJson(`${base}/api/bot/strategies`,                         ctrl.signal),
      fetchJson(`${base}/api/bot/health/services`,                    ctrl.signal),
      fetchJson(`${base}/api/bot/trades/closed?limit=${TRADES_LIMIT}`, ctrl.signal),
    ]);

    const svcList = servicesResp && servicesResp.services;
    const s = stats || {};

    return Response.json({
      generatedAt: new Date().toISOString(),
      pnl24h:      s.pnl24h   ?? null,
      pnlTotal:    s.totalPnL ?? null,
      status:      (s.status || "unknown").toUpperCase(),
      systems: {
        strategies: strategyDots(strategies),
        execution:  serviceUp(svcList, EXEC_HINTS),
        training:   serviceUp(svcList, TRAIN_HINTS),
      },
      trades24h: recentTrades(trades),
    }, {
      headers: {
        "Cache-Control":               "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
