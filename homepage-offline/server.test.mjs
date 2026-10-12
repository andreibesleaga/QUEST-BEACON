// BEACON — tests for the always-on front service. Run with: node --test homepage-offline/server.test.mjs
// A stub "deployment" (plain http server) stands in for the real app; the front is pointed at it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, parseUpstream, stripHopByHop } from './server.mjs';

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const close = (server) => new Promise((resolve) => server.close(resolve));

/** A fake deployment: /api/v1/health answers as configured; everything else echoes what it saw. */
function stubDeployment(health = { status: 200, body: { status: 'ok' } }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url === '/api/v1/health') {
      res.writeHead(health.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(health.body));
    }
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: one\n\n');
      setTimeout(() => res.end('data: two\n\n'), 50);
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-from': 'deployment' });
      res.end(`echo ${req.method} ${req.url} ${body}`);
    });
  });
  return { server, seen };
}

async function front(upstreamPort, extra = {}) {
  const server = createServer({
    upstream: upstreamPort ? new URL(`http://127.0.0.1:${upstreamPort}`) : null,
    probeTtlMs: 0,
    log: () => {},
    ...extra,
  });
  const port = await listen(server);
  return { server, base: `http://127.0.0.1:${port}` };
}

test('parseUpstream accepts only absolute http(s) URLs', () => {
  assert.equal(parseUpstream(undefined), null);
  assert.equal(parseUpstream(''), null);
  assert.equal(parseUpstream('not a url'), null);
  assert.equal(parseUpstream('ftp://x'), null);
  assert.equal(
    parseUpstream('https://quest-beacon-live.up.railway.app').origin,
    'https://quest-beacon-live.up.railway.app',
  );
});

test('page-only mode: the page, its assets, /healthz and a JSON 503 for the API', async () => {
  const f = await front(null);
  try {
    const page = await fetch(`${f.base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(await page.text(), /BEACON/);

    const deep = await fetch(`${f.base}/some/other/path?x=1`);
    assert.equal(deep.status, 200);

    const css = await fetch(`${f.base}/offline-assets/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const health = await fetch(`${f.base}/healthz`);
    assert.deepEqual(await health.json(), {
      status: 'ok',
      service: 'beacon-front',
      upstream: 'none',
    });

    const api = await fetch(`${f.base}/api/v1/status`);
    assert.equal(api.status, 503);
    assert.equal(api.headers.get('retry-after'), '300');
    assert.equal((await api.json()).code, 'DEPLOYMENT_OFFLINE');

    const post = await fetch(`${f.base}/`, { method: 'POST', body: 'x' });
    assert.equal(post.status, 405);
  } finally {
    await close(f.server);
  }
});

test('deployment up: every request is passed through with forwarding headers; the page is not served', async () => {
  const dep = stubDeployment();
  const depPort = await listen(dep.server);
  const f = await front(depPort);
  try {
    const res = await fetch(`${f.base}/regions/us-ca?view=map`, {
      method: 'POST',
      body: 'payload',
      headers: { 'x-custom': 'kept', host: 'quest-beacon.up.railway.app' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-from'), 'deployment');
    assert.equal(await res.text(), 'echo POST /regions/us-ca?view=map payload');
    const last = dep.seen.at(-1);
    assert.equal(last.headers['x-custom'], 'kept');
    // fetch() sets the Host header itself (to the front's address); the front must forward that host.
    assert.equal(last.headers['x-forwarded-host'], new URL(f.base).host);
    assert.equal(last.headers['x-forwarded-proto'], 'https');
    assert.ok(last.headers['x-forwarded-for']);
    assert.equal(last.headers.host, `127.0.0.1:${depPort}`);

    const health = await fetch(`${f.base}/healthz`);
    assert.equal((await health.json()).upstream, 'up');

    const stream = await fetch(`${f.base}/stream`);
    assert.match(stream.headers.get('content-type'), /event-stream/);
    assert.equal(await stream.text(), 'data: one\n\ndata: two\n\n');
  } finally {
    await close(f.server);
    await close(dep.server);
  }
});

test('deployment answering 404 on its domain (stopped Railway service) counts as down', async () => {
  const dep = stubDeployment({
    status: 404,
    body: { status: 'error', message: 'Application not found' },
  });
  const depPort = await listen(dep.server);
  const f = await front(depPort);
  try {
    const res = await fetch(`${f.base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /brought online on request/);
    assert.equal((await (await fetch(`${f.base}/healthz`)).json()).upstream, 'down');
  } finally {
    await close(f.server);
    await close(dep.server);
  }
});

test('health 200 without {"status":"ok"} counts as down', async () => {
  const dep = stubDeployment({ status: 200, body: { status: 'degraded' } });
  const depPort = await listen(dep.server);
  const f = await front(depPort);
  try {
    const page = await fetch(`${f.base}/`);
    assert.match(await page.text(), /brought online on request/);
    assert.equal((await (await fetch(`${f.base}/healthz`)).json()).upstream, 'down');
  } finally {
    await close(f.server);
    await close(dep.server);
  }
});

test('deployment unreachable (connection refused) serves the page, and recovers once it is back', async () => {
  const first = stubDeployment();
  const depPort = await listen(first.server);
  await close(first.server); // the port now refuses connections
  const f = await front(depPort, { probeTimeoutMs: 500 });
  try {
    const down = await fetch(`${f.base}/`);
    assert.equal(down.status, 200);
    assert.match(await down.text(), /BEACON/);

    const back = stubDeployment();
    await new Promise((resolve) => back.server.listen(depPort, '127.0.0.1', resolve));
    try {
      const res = await fetch(`${f.base}/x`);
      assert.equal(res.headers.get('x-from'), 'deployment');
    } finally {
      await close(back.server);
    }
  } finally {
    await close(f.server);
  }
});

test('the verdict is cached for probeTtlMs, so a burst of requests costs one probe', async () => {
  const dep = stubDeployment();
  const depPort = await listen(dep.server);
  const f = await front(depPort, { probeTtlMs: 60_000 });
  try {
    await Promise.all(Array.from({ length: 12 }, () => fetch(`${f.base}/x`).then((r) => r.text())));
    const probes = dep.seen.filter((s) => s.url === '/api/v1/health').length;
    assert.equal(probes, 1);
  } finally {
    await close(f.server);
    await close(dep.server);
  }
});

test('stripHopByHop removes the fixed list and every field the Connection header nominates', () => {
  const out = stripHopByHop({
    connection: 'x-private, Keep-Alive',
    'x-private': '1',
    'keep-alive': 'timeout=5',
    'transfer-encoding': 'chunked',
    'x-kept': '1',
  });
  assert.deepEqual(out, { 'x-kept': '1' });
});

test('fields nominated by Connection are not forwarded in either direction', async () => {
  const dep = { seen: [] };
  dep.server = http.createServer((req, res) => {
    dep.seen.push(req.headers);
    if (req.url === '/api/v1/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok' }));
    }
    res.writeHead(200, { connection: 'x-secret', 'x-secret': 'upstream-only', 'x-public': 'yes' });
    res.end('ok');
  });
  const depPort = await listen(dep.server);
  const f = await front(depPort);
  try {
    const got = await new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: '127.0.0.1',
          port: new URL(f.base).port,
          path: '/x',
          headers: { connection: 'x-private', 'x-private': '1' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.headers));
        },
      );
      r.on('error', reject);
      r.end();
    });
    const upstreamSaw = dep.seen.at(-1);
    assert.equal(upstreamSaw['x-private'], undefined);
    assert.equal(got['x-secret'], undefined);
    assert.equal(got['x-public'], 'yes');
  } finally {
    await close(f.server);
    await close(dep.server);
  }
});
