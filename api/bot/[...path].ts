/**
 * Vercel Edge Function — proxies `/api/bot/*` to the bot's plain-HTTP
 * REST surface on the Oracle VM.
 *
 * Why this exists: `vercel.json` previously rewrote `/api/bot/:path*`
 * directly to the VM's HTTP IP, but Vercel's edge tightened its
 * Hobby-plan policy on plain-HTTP rewrite destinations and silently
 * stopped proxying. The intermediate fix routed via a Cloudflare
 * quick tunnel; that worked but the trycloudflare hostname is
 * ephemeral and the operator wanted a stable, free URL with no
 * external service to manage.
 *
 * This file gives us exactly that. User-deployed Edge Functions are
 * not subject to the rewrite policy — fetch() inside the function
 * happily talks to plain-HTTP destinations server-side. The browser
 * only ever sees the dashboard's own HTTPS Vercel domain, so:
 *
 *   * No mixed-content block (function calls bot HTTP from the edge,
 *     not the browser).
 *   * No third-party tunnel, no Cloudflare account, no extra moving
 *     parts.
 *   * Stable URL forever (the Vercel deployment domain is the URL).
 *
 * Filesystem routes take precedence over rewrites in Vercel, so the
 * SPA catch-all in `vercel.json` (`/(.*)` → `/`) does not match
 * `/api/bot/*` while this file exists. The catch-all is what gives
 * the React Router its hash-free routing on hard refreshes.
 */

export const config = {
  runtime: 'edge',
};

// Bot's REST API on the Oracle VM. Plain HTTP because the bot is on a
// fixed IP without a TLS terminator. If the IP ever moves, change here.
const BOT_BASE = 'http://158.178.210.252:8001';

// Edge runtime fetch timeout. The bot endpoints are read-only over a
// SQLite DB + a few JSONL tail reads; if any of them takes more than
// 10 s something is genuinely broken upstream and the dashboard is
// better off seeing a 504 than holding the request open.
const UPSTREAM_TIMEOUT_MS = 10_000;

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const upstream = `${BOT_BASE}${url.pathname}${url.search}`;

  // Strip Vercel-injected forwarding headers so the bot sees a clean
  // request. We don't forward cookies — the bot's `/api/bot/*` surface
  // is unauthenticated read-only by design (Tier 1 per
  // docs/api-tier-policy.md on the bot side).
  const fwdHeaders: Record<string, string> = {};
  const accept = req.headers.get('accept');
  if (accept) fwdHeaders.accept = accept;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamRes = await fetch(upstream, {
      method: req.method,
      headers: fwdHeaders,
      cache: 'no-store',
      signal: ctrl.signal,
    });
    // Pass the body through verbatim. Strip hop-by-hop headers
    // (transfer-encoding, connection) which fetch handles for us but
    // some upstreams set explicitly.
    const passthroughHeaders = new Headers();
    upstreamRes.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (lower === 'transfer-encoding') return;
      if (lower === 'connection') return;
      passthroughHeaders.set(k, v);
    });
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: passthroughHeaders,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    const status = aborted ? 504 : 502;
    const detail = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        error: aborted ? 'upstream_timeout' : 'upstream_unreachable',
        detail,
        upstream,
      }),
      {
        status,
        headers: { 'content-type': 'application/json' },
      },
    );
  } finally {
    clearTimeout(timer);
  }
}
