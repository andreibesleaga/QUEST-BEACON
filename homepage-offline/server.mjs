// BEACON — always-on front service ("homepage-offline").
//
// One small Node process, no dependencies, that owns the public address of the BEACON deployment
// (https://quest-beacon.up.railway.app) and does exactly one of two things per request:
//
//   1. The full deployment is UP  → pass the request through to it unchanged (streaming, so the
//      situation-report push channel and large uploads work), and return its response as-is.
//   2. The full deployment is DOWN → serve one static page that explains the project, the contest
//      status and how to request access. API paths get a small JSON 503 instead of HTML.
//
// "Up" means: GET {UPSTREAM_URL}/api/v1/health answered 200 with {"status":"ok"} within
// PROBE_TIMEOUT_MS. That is deliberately liveness, not readiness: the deployment serves pages the
// moment it listens, while its `ready` flag only says the data composition has finished warming up
// (seconds to a minute); handing visitors to the real app during that window is the better experience. The verdict is cached for PROBE_TTL_MS so a busy page costs one probe per
// interval, not one per request. A stopped Railway service answers 404 "Application not found" on its
// domain, which this probe correctly reads as down.
//
// Without UPSTREAM_URL the service never proxies and always serves the page ("page-only mode").
//
// Environment: PORT (Railway sets it), UPSTREAM_URL, PROBE_TTL_MS (default 5000),
// PROBE_TIMEOUT_MS (default 2500), UPSTREAM_CONNECT_TIMEOUT_MS (default 10000).
// Own endpoints, answered here even when the deployment is up: GET /healthz.

import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const HEALTH_PATH = '/api/v1/health';
const ASSET_PREFIX = '/offline-assets/';

/** Request/response headers that belong to a single hop and must never be forwarded (RFC 9110 §7.6.1). */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

/** Remove hop-by-hop fields: the fixed list plus every field the `Connection` header nominates. */
export function stripHopByHop(headers) {
  const nominated = String(headers.connection ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  for (const name of [...nominated, ...HOP_BY_HOP]) delete headers[name];
  return headers;
}

const ASSET_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

/** Headers on the fallback page. The page carries no script, so the policy can be this strict. */
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; img-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

/** Parse UPSTREAM_URL; anything that is not an absolute http(s) URL means page-only mode. */
export function parseUpstream(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Load the page and its assets once; they are small and never change while the process runs. */
function loadStatic(root) {
  const page = readFileSync(join(root, 'index.html'));
  const assets = new Map();
  const dir = join(root, 'offline-assets');
  for (const name of ['style.css', 'beacon-192.png', 'cop-california.jpg']) {
    assets.set(ASSET_PREFIX + name, {
      body: readFileSync(join(dir, name)),
      type: ASSET_TYPES[extname(name)],
    });
  }
  return { page, assets };
}

/**
 * Build the server. Everything configurable is an option so the tests can point it at a stub
 * upstream; `main()` below fills the options from the environment.
 */
export function createServer(options = {}) {
  const upstream = options.upstream ?? null;
  const probeTtlMs = options.probeTtlMs ?? 5000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 2500;
  const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
  const log = options.log ?? ((line) => console.log(`[beacon-front] ${line}`));
  const statics = loadStatic(options.root ?? ROOT);
  const agent = upstream
    ? new (upstream.protocol === 'https:' ? https : http).Agent({ keepAlive: true })
    : null;

  let verdict = { at: 0, up: false, inflight: null };

  async function probe() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), probeTimeoutMs);
    try {
      const res = await fetch(new URL(HEALTH_PATH, upstream), {
        signal: ctl.signal,
        redirect: 'manual',
        headers: { 'user-agent': 'beacon-front/1 (health probe)' },
      });
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        return false;
      }
      const body = await res.json().catch(() => null);
      return Boolean(body) && body.status === 'ok';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function upstreamIsUp() {
    if (!upstream) return Promise.resolve(false);
    const now = Date.now();
    if (now - verdict.at < probeTtlMs) return Promise.resolve(verdict.up);
    if (!verdict.inflight) {
      verdict.inflight = probe().then((up) => {
        if (up !== verdict.up)
          log(
            `deployment is now ${up ? 'UP — passing traffic through' : 'DOWN — serving the page'}`,
          );
        verdict = { at: Date.now(), up, inflight: null };
        return up;
      });
    }
    return verdict.inflight;
  }

  function markDown() {
    verdict = { at: Date.now(), up: false, inflight: null };
  }

  function json(res, status, body, extra = {}) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    });
    res.end(JSON.stringify(body));
  }

  function servePage(req, res, status) {
    res.writeHead(status, PAGE_HEADERS);
    res.end(req.method === 'HEAD' ? undefined : statics.page);
  }

  function serveAsset(req, res, asset) {
    res.writeHead(200, {
      'content-type': asset.type,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  }

  /** The deployment is down (or there is none): page for people, a small JSON 503 for programs. */
  function serveFallback(req, res, status = 200) {
    const pathname = new URL(req.url ?? '/', 'http://front.invalid').pathname;
    const asset = statics.assets.get(pathname);
    if (asset) return serveAsset(req, res, asset);
    if (pathname.startsWith('/api/')) {
      return json(
        res,
        503,
        {
          code: 'DEPLOYMENT_OFFLINE',
          message: 'The BEACON deployment is switched off and is brought online on request.',
        },
        { 'retry-after': '300' },
      );
    }
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return json(res, 405, { code: 'METHOD_NOT_ALLOWED' });
    return servePage(req, res, status);
  }

  function forwardHeaders(req) {
    const headers = stripHopByHop({ ...req.headers });
    headers.host = upstream.host;
    headers['x-forwarded-host'] = req.headers.host ?? '';
    headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] ?? 'https';
    const ip = req.socket.remoteAddress ?? '';
    const prior = req.headers['x-forwarded-for'];
    headers['x-forwarded-for'] = prior ? `${prior}, ${ip}` : ip;
    return headers;
  }

  /** Stream the request to the deployment and its response back. Nothing is buffered or rewritten. */
  function proxy(req, res) {
    const client = upstream.protocol === 'https:' ? https : http;
    let responded = false;
    const out = client.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || undefined,
        method: req.method,
        path: req.url,
        headers: forwardHeaders(req),
        agent,
        timeout: connectTimeoutMs,
      },
      (ures) => {
        responded = true;
        const headers = stripHopByHop({ ...ures.headers });
        res.writeHead(ures.statusCode ?? 502, headers);
        ures.pipe(res);
      },
    );
    out.on('timeout', () => {
      if (!responded) out.destroy(new Error('upstream connect timeout'));
    });
    out.on('error', (err) => {
      markDown();
      if (res.headersSent) return res.destroy();
      log(`upstream error (${err.code ?? err.message}) — serving the page`);
      serveFallback(req, res, 502);
    });
    res.on('close', () => {
      if (!res.writableFinished) out.destroy();
    });
    req.pipe(out);
  }

  async function handle(req, res) {
    const pathname = new URL(req.url ?? '/', 'http://front.invalid').pathname;
    if (pathname === '/healthz') {
      const mode = upstream ? (verdict.up ? 'up' : 'down') : 'none';
      return json(res, 200, { status: 'ok', service: 'beacon-front', upstream: mode });
    }
    if (await upstreamIsUp()) return proxy(req, res);
    return serveFallback(req, res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`handler error: ${err.message}`);
      if (!res.headersSent) json(res, 500, { code: 'INTERNAL' });
      else res.destroy();
    });
  });
  // The deployment uses server-sent events, not WebSockets; refuse upgrades plainly.
  server.on('upgrade', (_req, socket) => socket.destroy());
  // Node's request timeout bounds how long a client may take to SEND a request (headers + body), so
  // it protects against slow-request abuse without touching long-lived streamed RESPONSES (SSE).
  server.requestTimeout = 300_000;
  server.headersTimeout = 60_000;

  return Object.assign(server, { upstreamIsUp, upstream });
}

function main() {
  const port = Number(process.env.PORT ?? 3000);
  const upstream = parseUpstream(process.env.UPSTREAM_URL);
  const server = createServer({
    upstream,
    probeTtlMs: Number(process.env.PROBE_TTL_MS ?? 5000),
    probeTimeoutMs: Number(process.env.PROBE_TIMEOUT_MS ?? 2500),
    connectTimeoutMs: Number(process.env.UPSTREAM_CONNECT_TIMEOUT_MS ?? 10_000),
  });
  server.listen(port, () => {
    const mode = upstream ? `front for ${upstream.origin}` : 'page-only (no UPSTREAM_URL)';
    console.log(`[beacon-front] listening on :${port} — ${mode}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
