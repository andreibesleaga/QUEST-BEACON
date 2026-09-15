// BEACON — the health route must survive the failures it exists to report (2026-09-12).
//
// The governing property is NOT "returns ok". It is that this route answers CORRECTLY WHILE THE
// COMPOSITION IS BROKEN — the only circumstance in which anyone reads it. Two production outages reached
// the operator as an opaque 500 because the probe was implemented on top of the thing that had failed.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const getCompositionState = vi.fn();
vi.mock('@/adapters/channels/http/http-dispatcher.js', () => ({ getCompositionState }));

const { GET } = await import('./route.js');

const req = (headers: Record<string, string> = {}): Request =>
  new Request('https://beacon.test/api/v1/health', { headers });

const SECRET = 'the-operator-secret';

/** Mint the same HS256 shape `/auth/login` issues, so the route is tested against a REAL token. */
function signToken(claims: Record<string, unknown>, secret: string = SECRET): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256' });
  const body = enc({
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  });
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  getCompositionState.mockReset();
  vi.unstubAllEnvs();
});

describe('GET /api/v1/health', () => {
  it('reports liveness 200 with ready=false while the composition is still building', async () => {
    getCompositionState.mockReturnValue({ status: 'building', startedAtMs: 1000 });
    const res = GET(req());
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b['status']).toBe('ok');
    expect(b['ready']).toBe(false);
    expect(b['composition']).toBe('building');
  });

  it('reports ready with an elapsed time once the composition has built', async () => {
    getCompositionState.mockReturnValue({
      status: 'ready',
      startedAtMs: 1000,
      settledAtMs: 31_000,
    });
    const b = await body(GET(req()));
    expect(b['ready']).toBe(true);
    expect(b['elapsedMs']).toBe(30_000);
  });

  // THE CASE THIS FILE EXISTS FOR. On 2026-09-12 `FEATURE_CACHE=postgres` made boot validation throw and
  // every route, health included, returned an opaque 500. A probe must stay 200 and NAME the fault.
  it('stays 200 and reports failure when the composition threw — it must not fail with it', async () => {
    getCompositionState.mockReturnValue({
      status: 'failed',
      startedAtMs: 1000,
      settledAtMs: 1200,
      error:
        "Invalid BEACON configuration (fail-fast at boot):\n  - FEATURE_CACHE: Invalid enum value. Expected 'memory' | 'redis', received 'postgres'",
    });
    const res = GET(req());
    expect(res.status).toBe(200); // a restart cannot fix a bad variable; crash-looping would hide it
    const b = await body(res);
    expect(b['ready']).toBe(false);
    expect(b['composition']).toBe('failed');
  });

  it('withholds the reason from an anonymous caller but confirms that something failed', async () => {
    getCompositionState.mockReturnValue({
      status: 'failed',
      startedAtMs: 1,
      settledAtMs: 2,
      error: 'FEATURE_CACHE is wrong',
    });
    const b = await body(GET(req()));
    expect(String(b['error'])).not.toContain('FEATURE_CACHE'); // no deployment internals to strangers
    expect(String(b['error'])).toContain('withheld');
  });

  it('gives an operator with a VALID EM token the exact sentence naming the bad variable', async () => {
    vi.stubEnv('AUTH_SECRET', SECRET);
    getCompositionState.mockReturnValue({
      status: 'failed',
      startedAtMs: 1,
      settledAtMs: 2,
      error: "FEATURE_CACHE: Invalid enum value. Expected 'memory' | 'redis', received 'postgres'",
    });
    const b = await body(GET(req({ authorization: `Bearer ${signToken({ role: 'EM' })}` })));
    expect(String(b['error'])).toContain('FEATURE_CACHE');
    expect(String(b['error'])).toContain("'memory' | 'redis'");
  });

  it.each([
    ['a token signed with the WRONG secret', () => signToken({ role: 'EM' }, 'not-the-secret')],
    ['an EXPIRED token', () => signToken({ role: 'EM', exp: Math.floor(Date.now() / 1000) - 60 })],
    ['a non-EM role', () => signToken({ role: 'VERIFIER' })],
    [
      'a token with no signature segment',
      () => signToken({ role: 'EM' }).split('.').slice(0, 2).join('.'),
    ],
    ['a syntactically broken token', () => 'not.a.jwt'],
    [
      'a signature of a different LENGTH (timingSafeEqual throws on this)',
      () => `${signToken({ role: 'EM' })}extra`,
    ],
  ])('withholds the reason from %s', async (_label, make) => {
    vi.stubEnv('AUTH_SECRET', SECRET);
    getCompositionState.mockReturnValue({
      status: 'failed',
      startedAtMs: 1,
      settledAtMs: 2,
      error: 'SECRET DETAIL',
    });
    // The length case is the one that would 500 rather than refuse: `timingSafeEqual` throws when the
    // buffers differ in length, and a probe that throws is not a probe.
    const res = GET(req({ authorization: `Bearer ${make()}` }));
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(String(b['error'])).not.toContain('SECRET DETAIL');
    expect(String(b['error'])).toContain('withheld');
  });

  // WHY THE POSTURE IS IN THE PROBE. On 2026-09-12 the deployment served 23 of 38 sources as MOCK after
  // every SOURCE_*_MODE had been set to `live`. The per-source modes were correct and irrelevant: the live
  // adapter path is gated ahead of all of them by DATA_SOURCE_COMPOSITION, which DEFAULTS TO `seed`, and
  // with `seed` no adapter is ever consulted whatever its own mode says. Nothing on the wire distinguished
  // "this source failed" from "no source was asked", so the obvious reading — 23 upstreams are down — was
  // wrong and cost hours. These two fields make the gate itself legible.
  //
  // Not withheld like the failure reason: GET /sources already publishes every source's served mode to
  // anonymous callers, so the posture is public already. This states it in one place instead of leaving it
  // to be inferred from 38 rows.
  it('reports whether the live adapter path is actually enabled', async () => {
    getCompositionState.mockReturnValue({ status: 'ready', startedAtMs: 1000, settledAtMs: 2000 });
    vi.stubEnv('DATA_SOURCE_COMPOSITION', 'adapters');
    const b = await body(GET(req()));
    expect(b['dataSourceComposition']).toBe('adapters');
    expect(b['liveAdapters']).toBe(true);
  });

  it('reports liveAdapters=false when the composition is seeded, which is the DEFAULT', async () => {
    getCompositionState.mockReturnValue({ status: 'ready', startedAtMs: 1000, settledAtMs: 2000 });
    vi.stubEnv('DATA_SOURCE_COMPOSITION', '');
    const b = await body(GET(req()));
    // Unset reads as `seed` — the same value buildCore defaults to. A probe that reported "adapters"
    // for an unset variable would confirm the exact belief that made this outage hard to see.
    expect(b['dataSourceComposition']).toBe('seed');
    expect(b['liveAdapters']).toBe(false);
  });

  it('reports the reingest interval, because 0 means the picture never refreshes', async () => {
    getCompositionState.mockReturnValue({ status: 'ready', startedAtMs: 1000, settledAtMs: 2000 });
    vi.stubEnv('DATA_SOURCE_COMPOSITION', 'adapters');
    vi.stubEnv('LIVE_REINGEST_INTERVAL_SEC', '600');
    expect((await body(GET(req())))['liveReingestSec']).toBe(600);
    // The coercion must match `loadConfig`'s `z.coerce.number()`: parseInt would read this as 6 seconds
    // while the app refreshes every 600, and a probe that contradicts the running config misleads twice.
    vi.stubEnv('LIVE_REINGEST_INTERVAL_SEC', '6e2');
    expect((await body(GET(req())))['liveReingestSec']).toBe(600);
    vi.stubEnv('LIVE_REINGEST_INTERVAL_SEC', '');
    // Absent is 0, and 0 is honest: the live picture is assembled once at boot and never again, so
    // every figure ages from process start. Reporting it as null would hide a live deployment going stale.
    expect((await body(GET(req())))['liveReingestSec']).toBe(0);
  });

  it('is never cached — a cached "ready" outlives the outage it is meant to report', async () => {
    getCompositionState.mockReturnValue({ status: 'ready', startedAtMs: 1, settledAtMs: 2 });
    expect(GET(req()).headers.get('cache-control')).toBe('no-store');
  });
});
