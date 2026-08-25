// BEACON — HTTP dispatcher integration tests (E7·T-334…T-338; ADR-023). DETERMINISTIC: fixed clock +
// counter newId, DEFAULT_SEED (US + RO), no network, no Next.js. Covers every implemented route, the
// envelope contract (data + non-empty provenance + freshness; citations on sitrep), the DomainError→status
// mapping (400/403/404/409/422), RBAC, and the per-actor rate-limit 429.
import { describe, it, expect } from 'vitest';
import type { Envelope } from '@/ports/interaction.js';
import { statusForError } from './error-mapping.js';
import { createHttpDeps, createHttpDepsLive, handleHttp, type CreateHttpDepsOptions } from './http-dispatcher.js';
import { parseCredentials } from './credentials.js';
import type { HttpDeps, HttpRequest } from './http-types.js';
import type { MemoryReportStore } from '@/adapters/memory/memory-core.js';
import { loadManifest } from '@/main/adapter-registry.js';
import { isOk } from '@/domain/shared/result.js';

const FIXED = '2026-07-05T22:00:00Z';

function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

// Enable the demo header-trust flag so the x-beacon-role RBAC stub is honoured in tests (real deployments
// use JWT). A dedicated test below asserts the FAIL-CLOSED default (flag off ⇒ header ignored ⇒ PUBLIC).
function deps(overrides: CreateHttpDepsOptions = {}): HttpDeps {
  return createHttpDeps({
    core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_DEV_TRUST_HEADER: 'on' } },
    rateLimit: { capacity: 1000, refillPerSec: 0 },
    ...overrides,
  });
}

function req(partial: Partial<HttpRequest> & Pick<HttpRequest, 'method' | 'path'>): HttpRequest {
  return { headers: {}, ...partial };
}

const asEnvelope = (body: unknown): Envelope => body as Envelope;

describe('handleHttp — read routes (golden path, US + RO)', () => {
  it('GET /api/v1/status returns an envelope with non-empty provenance + freshness (default region US)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/status' }), deps());
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.freshness).toBe(FIXED);
    expect((env.data as { regionId: string }).regionId).toBe('us-ca');
  });

  it('GET /api/v1/status?regionId=ro returns the RO overview', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/status', query: { regionId: 'ro' } }), deps());
    expect(res.status).toBe(200);
    expect((asEnvelope(res.body).data as { regionId: string }).regionId).toBe('ro');
  });

  it('GET /api/v1/regions/us-ca/incidents lists incidents with provenance', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/regions/us-ca/incidents' }), deps());
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect((env.data as { incidents: unknown[] }).incidents.length).toBe(1);
  });

  it('GET /api/v1/incidents/:id/sitrep carries citations[] (F2)', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/incidents/us-ca-wildfire-demo/sitrep' }),
      deps(),
    );
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    expect(env.citations?.length).toBeGreaterThan(0);
    expect(env.provenance.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/sources returns the source catalogue with provenance', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/sources' }), deps());
    expect(res.status).toBe(200);
    expect(asEnvelope(res.body).provenance.length).toBeGreaterThan(0);
  });

  // B1.2 / finding F-01: the bare /regions collection is SERVED (it used to 404 while openapi documented
  // it as `x-status: planned`). The geography/locale values come from config/regions.json through the seed
  // — asserted literally so a substituted bbox (the F-06 class of bug) fails here.
  it('GET /api/v1/regions serves the shipped-zone registry with provenance + freshness', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/regions' }), deps());
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    expect(env.provenance).toEqual([{ sourceId: 'region-registry', mode: 'LIVE', fetchedAt: FIXED }]);
    expect(env.freshness).toBe(FIXED);
    const { regions } = env.data as { regions: readonly Record<string, unknown>[] };
    expect(regions.map((r) => r.id)).toEqual(['us-ca', 'ro', 'es', 'gr', 'ph']);
    expect(regions[0]).toEqual({
      id: 'us-ca',
      name: 'California (US)',
      iso: 'US',
      tz: 'America/Los_Angeles',
      languages: ['en'],
      bbox: [-124.48, 32.53, -114.13, 42.01],
    });
    expect(regions[1]).toMatchObject({ id: 'ro', iso: 'RO', tz: 'Europe/Bucharest' });
    // The three B3.3 zones are served by the SAME route with no code change (FR-ZONE-3), each with its own
    // geography and locale — `ph` carries two languages, the zone's own first (FR-I18N-6).
    expect(regions[2]).toMatchObject({ id: 'es', iso: 'ES', tz: 'Europe/Madrid', languages: ['es'] });
    expect(regions[3]).toMatchObject({ id: 'gr', iso: 'GR', tz: 'Europe/Athens', languages: ['el'] });
    expect(regions[4]).toMatchObject({ id: 'ph', iso: 'PH', tz: 'Asia/Manila', languages: ['fil', 'en'] });
    // Every region must carry its OWN extent, never the flagship's (regionOf/FALLBACK_BBOX defect, F-06).
    const boxes = regions.map((r) => JSON.stringify(r.bbox));
    expect(new Set(boxes).size).toBe(regions.length);
  });

  it('GET /api/v1/regions is PUBLIC and a trailing slash resolves to the same collection', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/regions/' }), deps());
    expect(res.status).toBe(200);
    expect((asEnvelope(res.body).data as { regions: unknown[] }).regions.length).toBe(5);
  });

  it('the nested region routes are unaffected by the new collection route', async () => {
    const incidents = await handleHttp(req({ method: 'GET', path: '/api/v1/regions/us-ca/incidents' }), deps());
    expect(incidents.status).toBe(200);
    const map = await handleHttp(req({ method: 'GET', path: '/api/v1/regions/us-ca/map' }), deps());
    expect(map.status).toBe(200);
  });
});

describe('handleHttp — system probes', () => {
  it('GET /health returns a plain 200 {status:ok} (non-envelope)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/health' }), deps());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /me echoes the resolved role (default PUBLIC)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/me' }), deps());
    expect(res.body).toEqual({ role: 'PUBLIC' });
  });

  it('GET /me echoes an elevated role from x-beacon-role (demo flag on)', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/me', headers: { 'x-beacon-role': 'VERIFIER' } }),
      deps(),
    );
    expect(res.body).toEqual({ role: 'VERIFIER' });
  });

  it('FAIL-CLOSED: with AUTH_DEV_TRUST_HEADER off, a spoofed x-beacon-role is ignored → PUBLIC', async () => {
    const d = createHttpDeps({
      core: { clock: () => FIXED, newId: counterIds(), env: {} }, // flag absent
      rateLimit: { capacity: 1000, refillPerSec: 0 },
    });
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/me', headers: { 'x-beacon-role': 'EM' } }),
      d,
    );
    expect(res.body).toEqual({ role: 'PUBLIC' });
  });

  it('GET /.well-known/sustainability serves the schema-valid plugin report', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/.well-known/sustainability' }), deps());
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>)['measurement-method']).toBe('third-party-modeled');
  });
});

describe('handleHttp — intake + HITL', () => {
  it('POST /api/v1/reports creates an UNVERIFIED report (201)', async () => {
    const res = await handleHttp(
      req({ method: 'POST', path: '/api/v1/reports', body: JSON.stringify({ text: 'smoke on the ridge', consent: true }) }),
      deps(),
    );
    expect(res.status).toBe(201);
    const env = asEnvelope(res.body);
    expect((env.data as { status: string }).status).toBe('UNVERIFIED');
    expect(env.provenance.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/reports with malformed JSON → 400 PARSE_ERROR', async () => {
    const res = await handleHttp(
      req({ method: 'POST', path: '/api/v1/reports', body: '{not json' }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR'); // public API code (SPEC §196)
  });

  it('POST /api/v1/reports missing consent → 422 CONSENT_REQUIRED (EV4)', async () => {
    const res = await handleHttp(
      req({ method: 'POST', path: '/api/v1/reports', body: JSON.stringify({ text: 'help' }) }),
      deps(),
    );
    expect(res.status).toBe(422);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('CONSENT_REQUIRED');
  });

  it('PATCH /api/v1/reports/:id by PUBLIC → 403 (RBAC: verify needs VERIFIER)', async () => {
    const res = await handleHttp(
      req({ method: 'PATCH', path: '/api/v1/reports/rep-x', body: JSON.stringify({ decision: 'TRIAGED' }) }),
      deps(),
    );
    expect(res.status).toBe(403);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('FORBIDDEN'); // domain UNAUTHORIZED → public FORBIDDEN (SPEC §196)
  });

  it('PATCH /api/v1/reports/:id by RESPONDER → 403 (verify is VERIFIER+, not RESPONDER)', async () => {
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: { 'x-beacon-role': 'RESPONDER' },
        body: JSON.stringify({ decision: 'VERIFIED' }),
      }),
      deps(),
    );
    expect(res.status).toBe(403);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('FORBIDDEN');
  });

  it('SECURITY: the audit record carries the SERVER-DERIVED actor (role key), not a client value', async () => {
    const d = deps();
    const store = d.reports as unknown as MemoryReportStore;
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1', // seeded TRIAGED → VERIFIED is a legal hop
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'VERIFIED' }),
      }),
      d,
    );
    expect(res.status).toBe(202);
    const trail = store.auditTrail();
    expect(trail).toHaveLength(1);
    expect(trail[0]?.actorId).toBe('role:VERIFIER'); // actorKey('VERIFIER') — derived, never from the body
    expect(trail[0]?.decision).toBe('VERIFIED');
  });

  it('SECURITY: a client-supplied actorId is REJECTED (400 VALIDATION_ERROR) and never reaches the audit', async () => {
    const d = deps();
    const store = d.reports as unknown as MemoryReportStore;
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'VERIFIED', actorId: 'attacker-999' }), // spoof attempt
      }),
      d,
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
    expect(store.auditTrail()).toHaveLength(0); // spoof rejected BEFORE the core — nothing recorded
  });

  it('report → verify round-trip persists across requests (single wired core)', async () => {
    const d = deps();
    const created = await handleHttp(
      req({ method: 'POST', path: '/api/v1/reports', body: JSON.stringify({ text: 'trapped', consent: true }) }),
      d,
    );
    const id = (asEnvelope(created.body).data as { id: string }).id;
    const verified = await handleHttp(
      req({
        method: 'PATCH',
        path: `/api/v1/reports/${id}`,
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'TRIAGED' }),
      }),
      d,
    );
    expect(verified.status).toBe(202);
    expect((asEnvelope(verified.body).data as { status: string }).status).toBe('TRIAGED');
  });

  // CONTRACT CHANGED 2026-08-05 (WP-C1): this test used to pin `409` here — which pinned the DEFECT.
  // The queue offers one-click terminal decisions on UNVERIFIED rows, so the router now performs the
  // state machine's mandatory intermediate hop itself; the machine is unchanged (a DIRECT store-level
  // UNVERIFIED→VERIFIED is still illegal — public-report.test.ts pins that), and BOTH hops are audited.
  it('PATCH a fresh UNVERIFIED report with a terminal decision succeeds, with the TRIAGED hop audited', async () => {
    const d = deps();
    const created = await handleHttp(
      req({ method: 'POST', path: '/api/v1/reports', body: JSON.stringify({ text: 'trapped', consent: true }) }),
      d,
    );
    const id = (asEnvelope(created.body).data as { id: string }).id;
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: `/api/v1/reports/${id}`,
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'VERIFIED' }),
      }),
      d,
    );
    expect(res.status).toBe(202);
    expect((asEnvelope(res.body).data as { status: string }).status).toBe('VERIFIED');
    // One human click = TWO audited hops (Art. XIII: the trail still shows the report was taken up first).
    const trail = (d.reports as MemoryReportStore).auditTrail().filter((a) => a.reportId === id);
    expect(trail.map((a) => a.decision)).toEqual(['TRIAGED', 'VERIFIED']);
  });

  it('PATCH an unknown report id → 404 (never fabricates a report)', async () => {
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/does-not-exist',
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'TRIAGED' }),
      }),
      deps(),
    );
    expect(res.status).toBe(404);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('NOT_FOUND');
  });
});

// W4c — advisory vision-assist end-to-end over HTTP (E6·T-290/T-291; Art. XII/XIII/XIV). Transport-shape
// validation on `visionAssist`; FEATURE_VISION=off leaves it inert (byte-identical); FEATURE_VISION=on
// surfaces the advisory finding in `meta` without changing the report status or response shape otherwise.
describe('handleHttp — PATCH /api/v1/reports/:id — advisory vision-assist (FEATURE_VISION)', () => {
  const VISION_ASSIST = {
    imageRef: 'fixture:sentinel2-burn-area-crop-001',
    task: 'burn-area',
    imageConsented: true,
    piiScreened: true,
  };

  it('malformed visionAssist.task → 400 VALIDATION_ERROR (never silently dropped)', async () => {
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'VERIFIED', visionAssist: { ...VISION_ASSIST, task: 'not-a-real-task' } }),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('imageRef scheme allow-list: fixture:<id> and https:// are accepted (latent-SSRF guard)', async () => {
    for (const imageRef of ['fixture:sentinel2-burn-area-001', 'https://example.org/x.png']) {
      const res = await handleHttp(
        req({
          method: 'PATCH',
          path: '/api/v1/reports/rep-demo-1',
          headers: { 'x-beacon-role': 'VERIFIER' },
          body: JSON.stringify({ decision: 'VERIFIED', visionAssist: { ...VISION_ASSIST, imageRef } }),
        }),
        deps(), // fresh store per iteration (TRIAGED → VERIFIED is a one-shot legal hop)
      );
      expect(res.status).toBe(202); // accepted transport shape
    }
  });

  it('imageRef scheme allow-list: file:/http:/ftp: (and metadata IPs) → 400 VALIDATION_ERROR', async () => {
    for (const imageRef of ['file:///etc/passwd', 'http://169.254.169.254/', 'ftp://x']) {
      const res = await handleHttp(
        req({
          method: 'PATCH',
          path: '/api/v1/reports/rep-demo-1',
          headers: { 'x-beacon-role': 'VERIFIER' },
          body: JSON.stringify({ decision: 'VERIFIED', visionAssist: { ...VISION_ASSIST, imageRef } }),
        }),
        deps(),
      );
      expect(res.status).toBe(400);
      expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
    }
  });

  it('FEATURE_VISION=off (default): visionAssist is accepted but produces no finding (inert, byte-identical)', async () => {
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'VERIFIED', visionAssist: VISION_ASSIST }),
      }),
      deps(),
    );
    expect(res.status).toBe(202);
    const env = asEnvelope(res.body);
    expect((env.data as { status: string }).status).toBe('VERIFIED');
    expect(env.meta?.visionFinding).toBeUndefined();
  });

  it('FEATURE_VISION=on: an advisory burn-area finding surfaces in meta; report state unaffected', async () => {
    const d = createHttpDeps({
      core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_DEV_TRUST_HEADER: 'on', FEATURE_VISION: 'on' } },
      rateLimit: { capacity: 1000, refillPerSec: 0 },
    });
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'VERIFIED', visionAssist: VISION_ASSIST }),
      }),
      d,
    );
    expect(res.status).toBe(202);
    const env = asEnvelope(res.body);
    expect((env.data as { status: string }).status).toBe('VERIFIED'); // the human decision, unchanged
    const finding = env.meta?.visionFinding as { label: string; confidence: number } | undefined;
    expect(finding?.label).toBe('possible burn scar');
    expect(finding?.confidence).toBeGreaterThan(0);
  });
});

// CW4 — citizen live-view link intake (Live Views v1.2, ADR-029; FEATURE_CITIZEN_STREAM). Allowlist + SSRF
// hygiene on POST /reports `liveViewUrl`; link-only (NEVER fetched server-side); flag-off ⇒ REJECTED (400).
describe('handleHttp — POST /api/v1/reports — citizen live-view link (FEATURE_CITIZEN_STREAM)', () => {
  function citizenDeps(): HttpDeps {
    return createHttpDeps({
      core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_DEV_TRUST_HEADER: 'on', FEATURE_CITIZEN_STREAM: 'on' } },
      rateLimit: { capacity: 1000, refillPerSec: 0 },
    });
  }
  function post(body: Record<string, unknown>, d: HttpDeps) {
    return handleHttp(req({ method: 'POST', path: '/api/v1/reports', body: JSON.stringify(body) }), d);
  }
  const BASE = { text: 'live view of the fire front', consent: true } as const;

  it('accepts an allow-listed link (youtube live, youtu.be, twitch, facebook) and persists it on the report', async () => {
    for (const liveViewUrl of [
      'https://youtube.com/live/abc123',
      'https://www.youtube.com/watch?v=abc123',
      'https://youtu.be/abc123',
      'https://twitch.tv/somechannel',
      'https://www.facebook.com/somepage/live',
    ]) {
      const res = await post({ ...BASE, liveViewUrl }, citizenDeps());
      expect(res.status).toBe(201);
      expect((asEnvelope(res.body).data as { liveViewUrl?: string }).liveViewUrl).toBe(liveViewUrl);
    }
  });

  it('surfaces the persisted link on GET /reports (end-to-end to the verifier queue)', async () => {
    const d = citizenDeps();
    await post({ ...BASE, liveViewUrl: 'https://twitch.tv/firewatch' }, d);
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/reports', headers: { 'x-beacon-role': 'VERIFIER' } }),
      d,
    );
    expect(res.status).toBe(200);
    const items = (asEnvelope(res.body).data as { reports: Array<{ liveViewUrl?: string }> }).reports;
    expect(items.some((r) => r.liveViewUrl === 'https://twitch.tv/firewatch')).toBe(true);
  });

  it('rejects a non-allow-listed / unsafe link (http, file, IP-literal, userinfo, off-list host, bad YT path) → 400', async () => {
    for (const liveViewUrl of [
      'http://youtube.com/live/abc', // not https
      'file:///etc/passwd', // file scheme
      'https://169.254.169.254/live', // IPv4 metadata literal (SSRF)
      'https://[::1]/live', // IPv6 literal
      'https://user:pass@youtube.com/watch?v=x', // userinfo credential-smuggling
      'https://evil.example.com/live', // off-allowlist host
      'https://youtube.com/channel/UCxyz', // YT host but non-live/watch path
      'not-a-url', // unparseable
    ]) {
      const res = await post({ ...BASE, liveViewUrl }, citizenDeps());
      expect(res.status).toBe(400);
      expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects a link over the 2048-char cap → 400', async () => {
    const tooLong = `https://youtube.com/live/${'a'.repeat(2048)}`;
    const res = await post({ ...BASE, liveViewUrl: tooLong }, citizenDeps());
    expect(res.status).toBe(400);
  });

  it('FEATURE_CITIZEN_STREAM=off (default): a liveViewUrl is REJECTED with 400 (honest, not silently dropped)', async () => {
    const res = await post({ ...BASE, liveViewUrl: 'https://youtube.com/live/abc123' }, deps());
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('FEATURE_CITIZEN_STREAM=off (default): a report WITHOUT a liveViewUrl is byte-identical (201, no field)', async () => {
    const res = await post({ ...BASE }, deps());
    expect(res.status).toBe(201);
    expect((asEnvelope(res.body).data as { liveViewUrl?: string }).liveViewUrl).toBeUndefined();
  });
});

describe('handleHttp — alert:draft (RBAC + not-found)', () => {
  it('POST /api/v1/alerts by PUBLIC → 403', async () => {
    const res = await handleHttp(
      req({ method: 'POST', path: '/api/v1/alerts', body: JSON.stringify({ incidentId: 'us-ca-wildfire-demo', headline: 'x' }) }),
      deps(),
    );
    expect(res.status).toBe(403);
  });

  it('POST /api/v1/alerts by RESPONDER → 403 (alert family is VERIFIER+, SPEC §2.2/CLARIF Q6)', async () => {
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/alerts',
        headers: { 'x-beacon-role': 'RESPONDER' },
        body: JSON.stringify({ incidentId: 'us-ca-wildfire-demo', headline: 'x' }),
      }),
      deps(),
    );
    expect(res.status).toBe(403);
  });

  it('POST /api/v1/alerts by VERIFIER drafts an alert (201 Created, never emitted)', async () => {
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/alerts',
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ incidentId: 'us-ca-wildfire-demo', headline: 'Evacuate Oak Ridge' }),
      }),
      deps(),
    );
    expect(res.status).toBe(201);
    const env = asEnvelope(res.body);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect((env.data as { alert: { capStatus: string } }).alert.capStatus).toBe('DRAFT');
  });

  it('POST /api/v1/alerts for an unknown incident → 404', async () => {
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/alerts',
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ incidentId: 'does-not-exist', headline: 'x' }),
      }),
      deps(),
    );
    expect(res.status).toBe(404);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('NOT_FOUND');
  });
});

describe('handleHttp — routing edges + rate limit', () => {
  // `GET /regions` used to be the deferred-route case here (404). It is SERVED as of B1.2 (finding F-01)
  // — see the read-routes block above. An unknown collection still 404s, which is what this case now pins.
  it('an unknown single-segment collection → 404', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/zones' }), deps());
    expect(res.status).toBe(404);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('NOT_FOUND');
  });

  it('sitrep for an unknown incident → 404', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/incidents/nope/sitrep' }), deps());
    expect(res.status).toBe(404);
  });

  it('exceeding the per-actor bucket → 429 RATE_LIMITED', async () => {
    const d = deps({ rateLimit: { capacity: 2, refillPerSec: 0 } });
    await handleHttp(req({ method: 'GET', path: '/api/v1/status' }), d);
    await handleHttp(req({ method: 'GET', path: '/api/v1/status' }), d);
    const third = await handleHttp(req({ method: 'GET', path: '/api/v1/status' }), d);
    expect(third.status).toBe(429);
    expect(asEnvelope(third.body).errors?.[0]?.code).toBe('RATE_LIMITED');
  });
});

describe('statusForError — DomainError → HTTP status (SPEC §2.3)', () => {
  it('maps every domain code to its HTTP status', () => {
    expect(statusForError('NOT_FOUND')).toBe(404);
    expect(statusForError('UNAUTHORIZED')).toBe(403);
    expect(statusForError('PARSE_ERROR')).toBe(400);
    expect(statusForError('CONFLICT')).toBe(409);
    expect(statusForError('INVALID_TRANSITION')).toBe(409);
    expect(statusForError('INVARIANT_VIOLATION')).toBe(422);
  });
});

// W5 — createHttpDepsLive integration (Phase-B/C test-audit debt). Deterministic: fixed clock, counter
// newId, no network.
//
// DERIVED FROM THE MANIFEST, NOT HAND-LISTED (fixed 2026-08-08). This was a hardcoded array of source
// prefixes that had to be extended by hand every time an adapter landed — and it silently rotted twice:
// it never gained the three B3 aggregators (`meteoalarm-gr`/`-es`/`wmo-swic`, added 2026-07-27) and it
// never gained the eleven S2 live-demo sources. The rot was invisible because a missing row only bites
// when that adapter's manifest mode is LIVE (a CACHED/MOCK default reaches no network either way), so
// the list looked fine right up until an omitted source defaulted LIVE — at which point this "offline,
// no-network" test would have issued a REAL fetch, and `metno` would have failed the registry build
// outright (it fail-fasts on LIVE without its licence-mandated contact User-Agent).
//
// Reading the manifest is the only version that cannot drift: every row that exists is forced MOCK by
// construction. If the manifest cannot be read the test fails loudly rather than silently under-mocking.
const manifestRes = loadManifest();
if (!isOk(manifestRes)) throw new Error(`adapter manifest unreadable: ${manifestRes.error.message}`);
// THE PREFIX IS READ FROM THE MANIFEST, NOT DERIVED FROM THE ID (fixed 2026-08-11, PR#7 review) — the
// same defect the comment above warns about, one level down: the SET was derived correctly while the KEY
// was still guessed. `id.replace(/-/g,'_').toUpperCase()` disagrees with any declared `configPrefix` that
// is not that mechanical transform (`agency-rss` declares `AGENCYRSS`), so the emitted
// `SOURCE_AGENCY_RSS_MODE` was read by nothing — and agency-rss defaults **LIVE**, so this "offline,
// no-network" test really did fetch. `configPrefix` is what the composition root keys on
// (`resolveEntryEnv`, adapter-registry.ts:235).
const ALL_SOURCES_MOCK: Readonly<Record<string, string>> = Object.fromEntries(
  manifestRes.value.adapters
    .filter((a) => a.configPrefix !== undefined)
    .map((a) => [`SOURCE_${a.configPrefix!}_MODE`, 'MOCK']),
);

function liveDeps(env: Record<string, string | undefined> = {}): Promise<HttpDeps> {
  return createHttpDepsLive({ core: { clock: () => FIXED, newId: counterIds(), env } });
}

describe('createHttpDepsLive — async live composition (W5)', () => {
  it('DATA_SOURCE_COMPOSITION unset: falls back to the offline seed (same shape as createHttpDeps)', async () => {
    const deps = await liveDeps({ AUTH_DEV_TRUST_HEADER: 'on' });
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/status' }), deps);
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    expect((env.data as { incidentCount: number }).incidentCount).toBe(1);
    expect(env.provenance.every((p) => p.mode === 'MOCK')).toBe(true);
  });

  it('DATA_SOURCE_COMPOSITION=adapters (all 22 sources MOCK): the live-composition path, mode-labelled MOCK', async () => {
    const deps = await liveDeps({
      DATA_SOURCE_COMPOSITION: 'adapters',
      ...ALL_SOURCES_MOCK,
      AUTH_DEV_TRUST_HEADER: 'on',
    });
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/status' }), deps);
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    expect((env.data as { incidentCount: number }).incidentCount).toBeGreaterThan(0);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.provenance.every((p) => ['LIVE', 'CACHED', 'MOCK'].includes(p.mode))).toBe(true);
    // Forcing every source to MOCK means the live-adapter status response is actually labelled MOCK
    // throughout — proves the live composition path (not just a byte-identical fallback) was exercised.
    expect(env.provenance.every((p) => p.mode === 'MOCK')).toBe(true);
  });

  it('FEATURE_STORE default (memory): GET /reports serves the seeded offline demo queue (no db touched)', async () => {
    const deps = await liveDeps({ AUTH_DEV_TRUST_HEADER: 'on' });
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/reports', headers: { 'x-beacon-role': 'VERIFIER' } }),
      deps,
    );
    expect(res.status).toBe(200);
    const items = (asEnvelope(res.body).data as { reports: Array<{ id: string }> }).reports;
    expect(items.map((r) => r.id).sort()).toEqual(['rep-demo-1', 'rep-demo-2']);
  });

  it('deps shape: interaction + every feature adapter is wired (routing/logistics/interop/map/eventBus)', async () => {
    const deps = await liveDeps();
    expect(deps.interaction).toBeDefined();
    expect(deps.features.routing).toBeDefined();
    expect(deps.features.logistics).toBeDefined();
    expect(deps.features.interop).toBeDefined();
    expect(deps.features.map).toBeDefined();
    expect(deps.features.eventBus).toBeDefined();
  });

  it('ONE EventBus instance backs the composition: a publish is observed by a subscriber on the SAME deps', async () => {
    const deps = await liveDeps();
    const received: Array<{ n: number }> = [];
    const sub = deps.features.eventBus.subscribe<{ n: number }>('w5-test-topic', (event) => received.push(event));
    expect(sub.ok).toBe(true);
    const pub = await deps.features.eventBus.publish('w5-test-topic', { n: 42 });
    expect(pub.ok).toBe(true);
    expect(received).toEqual([{ n: 42 }]);
  });

  it('report -> verify round-trip persists across requests on the async live deps (single shared report store)', async () => {
    const deps = await liveDeps({ AUTH_DEV_TRUST_HEADER: 'on' });
    const created = await handleHttp(
      req({ method: 'POST', path: '/api/v1/reports', body: JSON.stringify({ text: 'trapped', consent: true }) }),
      deps,
    );
    expect(created.status).toBe(201);
    const id = (asEnvelope(created.body).data as { id: string }).id;
    const verified = await handleHttp(
      req({
        method: 'PATCH',
        path: `/api/v1/reports/${id}`,
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'TRIAGED' }),
      }),
      deps,
    );
    expect(verified.status).toBe(202);
    expect((asEnvelope(verified.body).data as { status: string }).status).toBe('TRIAGED');
  });
});

// ── F-350 (general case): a throw in a FEATURE route must not escape handleHttp ────────────────────────
//
// `handleFeatureRoute` was called bare — outside any try/catch — while `dispatchCommand`, the sibling
// dispatch path three lines below it, was wrapped. So a throw anywhere in logistics/interop/map/queue
// escaped `handleHttp` entirely and became a framework 500 with NO envelope, potentially rendering a stack
// or an internal message (a connection string, say) to the caller. The asymmetry WAS the bug.
//
// The plant is a `clock` that throws a secret-shaped message, because the clock is read by every feature
// handler's provenance stamp — it is the shortest path to "something deep inside a feature route threw".
describe('handleHttp — a feature-route throw is contained (F-350)', () => {
  function throwingClockDeps(): HttpDeps {
    const d = deps();
    return {
      ...d,
      features: {
        ...d.features,
        clock: () => {
          throw new Error('postgres://user:hunter2@db:5432/beacon');
        },
      },
    };
  }

  it('returns a mapped 500 envelope instead of propagating the throw out of handleHttp', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/resources', query: { incidentId: 'us-ca-wildfire-demo' }, headers: { 'x-beacon-role': 'EM' } }),
      throwingClockDeps(),
    );
    expect(res.status).toBe(500);
  });

  it('leaks NOTHING of the internal failure — no stack, no message, no credential', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/resources', query: { incidentId: 'us-ca-wildfire-demo' }, headers: { 'x-beacon-role': 'EM' } }),
      throwingClockDeps(),
    );
    const body = JSON.stringify(res.body);
    // The credential in the thrown message must not appear anywhere in the response.
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('postgres://');
    expect(body).not.toMatch(/at .*\.ts:\d+/); // no stack frame
    expect(res.body).toMatchObject({ errors: [{ code: 'INTERNAL_ERROR', message: 'internal error' }] });
  });
});

// ── F-416: the SSE channel's MISSING HALF — a mutation must publish a region-keyed delta ───────────────
//
// `EventBusPort.publish` was implemented and called from NO production code path, so `GET /api/v1/stream`
// served `hello` + heartbeats forever: the push channel was infrastructure with no producer, and the COP
// refreshed only on the client's 15 s polling rung. The sixth instance of "code exists, nothing runs it"
// in this project (after F-53, F-152, F-280, F-328, F-320) — and the one landing on **Timeliness**, the
// lowest-scored rubric category.
describe('handleHttp — a mutation publishes a region-keyed SSE delta (F-416)', () => {
  /** Capture every publish without changing behaviour, so the assertions are about the REAL dispatcher. */
  function capturingDeps(): { deps: HttpDeps; published: { topic: string; event: unknown }[] } {
    const base = deps();
    const published: { topic: string; event: unknown }[] = [];
    const bus = base.features.eventBus;
    return {
      published,
      deps: {
        ...base,
        features: {
          ...base.features,
          eventBus: {
            ...bus,
            publish: async (topic: string, event: unknown) => {
              published.push({ topic, event });
              return bus.publish(topic, event);
            },
          },
        },
      },
    };
  }

  const CA_INCIDENT = 'us-ca-wildfire-demo';

  it('POST /reports publishes to the incident’s region topic, and the frame carries NO figures (Art. XII)', async () => {
    const { deps: d, published } = capturingDeps();
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/reports',
        body: JSON.stringify({
          consent: true,
          text: 'Trapped by fire on the ridge road, need evacuation assistance.',
          lat: 38.5816,
          lng: -121.4944,
          incidentId: CA_INCIDENT,
        }),
      }),
      d,
    );
    expect(res.status).toBe(201);

    expect(published).toHaveLength(1);
    const [frame] = published;
    // Region-keyed (THREAT T13.1) — a subscriber only ever sees its own region.
    expect(frame?.topic).toMatch(/^region:.+:delta$/);
    // Art. XII: EXACTLY these four keys. A delta is a doorbell, never a delivery — if a coordinate,
    // a casualty count or a confidence score ever rides this channel, it bypasses provenance and RBAC.
    expect(Object.keys(frame?.event as object).sort()).toEqual(['at', 'entity', 'region', 'type']);
    expect(frame?.event).toMatchObject({ type: 'report.created' });
  });

  it('an UNATTRIBUTABLE mutation publishes NOTHING rather than broadcasting to a shared topic', async () => {
    const { deps: d, published } = capturingDeps();
    // No incidentId: a citizen may report before any incident exists. That is a real state, and the change
    // genuinely belongs to no region — so it must not be pushed to one. The client's polling rung still
    // picks it up (Art. XVI: the degraded path is the one that always works).
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/reports',
        body: JSON.stringify({ consent: true, text: 'Water rising fast on the low road by the mill.' }),
      }),
      d,
    );
    expect(res.status).toBe(201);
    expect(published).toHaveLength(0);
  });

  it('a READ publishes nothing — a delta for a GET would put every client in a refetch loop', async () => {
    const { deps: d, published } = capturingDeps();
    await handleHttp(req({ method: 'GET', path: '/api/v1/status' }), d);
    expect(published).toHaveLength(0);
  });

  it('a publish failure NEVER fails the write — notification is a side effect, not a precondition', async () => {
    const base = deps();
    const d: HttpDeps = {
      ...base,
      features: {
        ...base.features,
        eventBus: {
          ...base.features.eventBus,
          publish: () => {
            throw new Error('bus exploded');
          },
        },
      },
    };
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/reports',
        body: JSON.stringify({ consent: true, text: 'Structure fire spreading east.', incidentId: CA_INCIDENT }),
      }),
      d,
    );
    // The SOS was accepted. A subscriber problem must never turn a citizen's emergency report into a 5xx.
    expect(res.status).toBe(201);
  });
});

// Dispatcher-level coverage for the REAL named-account login (credentials.test.ts covers the crypto;
// THESE tests pin the externally observable HTTP contract: 200 shape, the flat non-enumerating 401, and
// the generic 404 when the posture has no accounts). Deterministic: fixed secret, no network.
describe('handleHttp — POST /api/v1/auth/login (named accounts)', () => {
  const SECRET = 'test-only-auth-secret';
  const loginReq = (body: unknown): HttpRequest =>
    req({ method: 'POST', path: '/api/v1/auth/login', body: JSON.stringify(body) });

  async function loginDeps(): Promise<HttpDeps> {
    const base = deps({ core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_SECRET: SECRET } } });
    const credentials = await parseCredentials('em@beacon.test:EM:correct-horse-battery', SECRET);
    return { ...base, credentials };
  }

  it('valid credentials → 200 with a token, the SERVER-assigned role, and the account id', async () => {
    const res = await handleHttp(loginReq({ userId: 'em@beacon.test', password: 'correct-horse-battery' }), await loginDeps());
    expect(res.status).toBe(200);
    const body = res.body as { token: string; role: string; userId: string };
    expect(body.token).toEqual(expect.any(String));
    expect(body.token.length).toBeGreaterThan(0);
    // The role comes from the CONFIGURED account — the request never carried one (vs. dev-login).
    expect(body.role).toBe('EM');
    expect(body.userId).toBe('em@beacon.test');
  });

  it('wrong password → flat 401 UNAUTHORIZED', async () => {
    const res = await handleHttp(loginReq({ userId: 'em@beacon.test', password: 'wrong' }), await loginDeps());
    expect(res.status).toBe(401);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('UNAUTHORIZED');
  });

  it('unknown user → the IDENTICAL 401 (no account enumeration via status or body)', async () => {
    const d = await loginDeps();
    const unknown = await handleHttp(loginReq({ userId: 'nobody@beacon.test', password: 'wrong' }), d);
    const wrongPw = await handleHttp(loginReq({ userId: 'em@beacon.test', password: 'wrong' }), d);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrongPw.body);
  });

  it('no configured accounts (the offline posture) → the router-generic 404, never a hint', async () => {
    const res = await handleHttp(loginReq({ userId: 'em@beacon.test', password: 'x' }), deps());
    expect(res.status).toBe(404);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('NOT_FOUND');
  });

  it('missing password → 400 (transport-shape validation, before any credential work)', async () => {
    const res = await handleHttp(loginReq({ userId: 'em@beacon.test' }), await loginDeps());
    expect(res.status).toBe(400);
  });
});

// WP-C1 regression (2026-08-05): the REAL demo flow — submit an SOS (born UNVERIFIED) and decide it in
// ONE click. Until this fix the terminal decision was an illegal hop (UNVERIFIED→REJECTED), the PATCH
// 409'd, nothing persisted, and the "rejected" report resurrected on the next refetch. No prior test
// covered it because every seeded queue row is TRIAGED.
describe('handleHttp — one-click decision on a fresh UNVERIFIED report persists (Art. XIII)', () => {
  const asVerifier = { 'x-beacon-role': 'VERIFIER' };

  async function submitReport(d: HttpDeps): Promise<string> {
    const res = await handleHttp(
      req({ method: 'POST', path: '/api/v1/reports', body: JSON.stringify({ consent: true, text: 'flames visible from the road' }) }),
      d,
    );
    expect(res.status).toBe(201);
    return (asEnvelope(res.body).data as { id: string }).id;
  }

  it('REJECTED persists: the report leaves the pending queue and stays REJECTED', async () => {
    const d = deps();
    const id = await submitReport(d);
    const patch = await handleHttp(
      req({ method: 'PATCH', path: `/api/v1/reports/${id}`, headers: asVerifier, body: JSON.stringify({ decision: 'REJECTED' }) }),
      d,
    );
    expect(patch.status).toBe(202);
    expect((asEnvelope(patch.body).data as { status: string }).status).toBe('REJECTED');

    const all = await handleHttp(req({ method: 'GET', path: '/api/v1/reports', headers: asVerifier }), d);
    const rows = (asEnvelope(all.body).data as { reports: { id: string; status: string }[] }).reports;
    expect(rows.find((r) => r.id === id)?.status).toBe('REJECTED'); // audit surface still sees it, decided

    const pending = await handleHttp(
      req({ method: 'GET', path: '/api/v1/reports', query: { status: 'pending' }, headers: asVerifier }),
      d,
    );
    const pendingRows = (asEnvelope(pending.body).data as { reports: { id: string }[] }).reports;
    expect(pendingRows.some((r) => r.id === id)).toBe(false); // rejected means GONE from the queue
  });

  it('VERIFIED persists the same way (the other one-click terminal)', async () => {
    const d = deps();
    const id = await submitReport(d);
    const patch = await handleHttp(
      req({ method: 'PATCH', path: `/api/v1/reports/${id}`, headers: asVerifier, body: JSON.stringify({ decision: 'VERIFIED' }) }),
      d,
    );
    expect(patch.status).toBe(202);
    expect((asEnvelope(patch.body).data as { status: string }).status).toBe('VERIFIED');
  });

  it('re-deciding an already-terminal report still 409s truthfully (no silent overwrite)', async () => {
    const d = deps();
    const id = await submitReport(d);
    await handleHttp(
      req({ method: 'PATCH', path: `/api/v1/reports/${id}`, headers: asVerifier, body: JSON.stringify({ decision: 'REJECTED' }) }),
      d,
    );
    const again = await handleHttp(
      req({ method: 'PATCH', path: `/api/v1/reports/${id}`, headers: asVerifier, body: JSON.stringify({ decision: 'VERIFIED' }) }),
      d,
    );
    expect(again.status).toBe(409);
  });

  it('?status=<anything else> is a strict 400, never a silently unfiltered response', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/reports', query: { status: 'rejected' }, headers: asVerifier }),
      deps(),
    );
    expect(res.status).toBe(400);
  });
});
