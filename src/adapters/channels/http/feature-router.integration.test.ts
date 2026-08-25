// BEACON — HTTP feature-route integration tests (E7·integration; SPEC §2.2, ADR-016/ADR-010/ADR-006,
// Art. XIII). DETERMINISTIC: fixed past clock '2026-07-05T22:00:00Z', counter newId, DEFAULT_FEATURE_SEED
// (CA + RO), no network/timers. Drives the wired feature routes THROUGH handleHttp (proving the composition
// root + feature-router + JWT switch), plus a direct handleStream test for the SSE channel (which cannot
// flow through the JSON dispatcher).
import { describe, it, expect } from 'vitest';
import type { Envelope } from '@/ports/interaction.js';
import { makeResourceTask } from '@/domain/resource-task.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, ResourceId, ResourceTaskId } from '@/domain/value-objects/ids.js';
import { resourceTaskToEdxlRm } from '@/adapters/interop/edxl-rm-mapper.js';
import { signDevToken } from './rbac.js';
import { createHttpDeps, handleHttp, type CreateHttpDepsOptions } from './http-dispatcher.js';
import { handleStream, streamTopic, type StreamDelta } from './routes/stream.js';
import type { HttpDeps, HttpRequest } from './http-types.js';

const FIXED = '2026-07-05T22:00:00Z';
const CA_INCIDENT = 'us-ca-wildfire-demo';

function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

/** Deps with the demo-header RBAC flag on (real deployments use JWT; a dedicated test below proves that). */
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
const roleHeaders = (role: string): Record<string, string> => ({ 'x-beacon-role': role });

describe('feature-router — POST /api/v1/routes (open, hazard-avoiding)', () => {
  it('returns a hazard-avoiding route + shelters with non-empty provenance (F1)', async () => {
    // origin→destination straddles the CA hazard box (centre [-121.6,39.7], ±0.05) → router detours around it.
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/routes',
        body: JSON.stringify({ incidentId: CA_INCIDENT, origin: [-121.8, 39.7], destination: [-121.4, 39.7] }),
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    const data = env.data as { route: { avoidsHazard: boolean }; shelters: readonly unknown[] };
    expect(data.route.avoidsHazard).toBe(true);
    expect(data.shelters.length).toBeGreaterThan(0);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.freshness).toBe(FIXED);
  });

  it('rejects a malformed body with 400 VALIDATION_ERROR', async () => {
    const res = await handleHttp(req({ method: 'POST', path: '/api/v1/routes', body: '{bad' }), deps());
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
  });
});

describe('feature-router — /api/v1/resources (RESPONDER+ RBAC)', () => {
  it('GET /resources by PUBLIC → 403 FORBIDDEN-equivalent (UNAUTHORIZED)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/resources', query: { incidentId: CA_INCIDENT } }), deps());
    expect(res.status).toBe(403);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('FORBIDDEN');
  });

  it('GET /resources by RESPONDER → 200 with provenance', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/resources', query: { incidentId: CA_INCIDENT, org: 'cal-fire' }, headers: roleHeaders('RESPONDER') }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(asEnvelope(res.body).provenance.length).toBeGreaterThan(0);
  });

  it('POST /resources by PUBLIC → 403; by RESPONDER → 201', async () => {
    const forbidden = await handleHttp(
      req({ method: 'POST', path: '/api/v1/resources', body: JSON.stringify({ kind: 'ENGINE', org: 'cal-fire' }) }),
      deps(),
    );
    expect(forbidden.status).toBe(403);

    const created = await handleHttp(
      req({ method: 'POST', path: '/api/v1/resources', headers: roleHeaders('RESPONDER'), body: JSON.stringify({ kind: 'ENGINE', org: 'cal-fire' }) }),
      deps(),
    );
    expect(created.status).toBe(201);
    expect((asEnvelope(created.body).data as { resource: { kind: string } }).resource.kind).toBe('ENGINE');
  });
});

describe('feature-router — POST /api/v1/resource-tasks (legal + illegal, Art. XIII/ST1)', () => {
  it('creates a PROPOSED task on a VERIFIED incident (201), then rejects an illegal skip (409)', async () => {
    const d = deps();
    const created = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/resource-tasks',
        headers: roleHeaders('RESPONDER'),
        body: JSON.stringify({ id: 't-legal', resourceId: 'ca-engine-1', incidentId: CA_INCIDENT }),
      }),
      d,
    );
    expect(created.status).toBe(201);
    expect((asEnvelope(created.body).data as { task: { status: string } }).task.status).toBe('PROPOSED');

    const skip = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/resource-tasks',
        headers: roleHeaders('RESPONDER'),
        body: JSON.stringify({ id: 't-legal', resourceId: 'ca-engine-1', incidentId: CA_INCIDENT, status: 'ENROUTE' }),
      }),
      d,
    );
    expect(skip.status).toBe(409);
    expect(asEnvelope(skip.body).errors?.[0]?.code).toBe('STATE_CONFLICT');
  });

  it('rejects a task from an UNVERIFIED incident with 403 (Art. XIII/ST1)', async () => {
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/resource-tasks',
        headers: roleHeaders('RESPONDER'),
        body: JSON.stringify({ id: 't-unverified', resourceId: 'ca-engine-1', incidentId: 'inc-unverified' }),
      }),
      deps(),
    );
    expect(res.status).toBe(403);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('FORBIDDEN');
  });
});

describe('feature-router — POST /api/v1/alerts/:id/approve (HITL emit gate, Art. XIII)', () => {
  it('a VERIFIER approves the seeded DRAFT → emits a CAP (201 ACTUAL); a non-DRAFT re-approval → 409', async () => {
    const d = deps();
    const approved = await handleHttp(
      req({ method: 'POST', path: '/api/v1/alerts/ca-alert-draft-1/approve', headers: roleHeaders('VERIFIER') }),
      d,
    );
    expect(approved.status).toBe(201);
    const env = asEnvelope(approved.body);
    expect((env.data as { alert: { capStatus: string } }).alert.capStatus).toBe('ACTUAL');
    expect(env.meta?.emitted).toBe(true);
    expect(env.provenance[0]?.mode).toBe('MOCK'); // no real external send (Art. XVI)

    // Re-approving the now-ACTUAL alert is a non-DRAFT → 409, no double emit.
    const again = await handleHttp(
      req({ method: 'POST', path: '/api/v1/alerts/ca-alert-draft-1/approve', headers: roleHeaders('VERIFIER') }),
      d,
    );
    expect(again.status).toBe(409);
    expect(asEnvelope(again.body).errors?.[0]?.code).toBe('STATE_CONFLICT');
  });

  it('a RESPONDER (below VERIFIER) is rejected 403 — a DRAFT never reaches emit', async () => {
    const res = await handleHttp(
      req({ method: 'POST', path: '/api/v1/alerts/ca-alert-draft-1/approve', headers: roleHeaders('RESPONDER') }),
      deps(),
    );
    expect(res.status).toBe(403);
  });
});

describe('feature-router — EDXL-RM round-trip (FR-9)', () => {
  function inboundMessage(): unknown {
    const task = makeResourceTask({
      id: asId<ResourceTaskId>('task-rm-1'),
      resourceId: asId<ResourceId>('ca-engine-1'),
      incidentId: asId<IncidentId>(CA_INCIDENT),
      status: 'PROPOSED',
      edxlRmRef: 'urn:beacon:rm:corr-http-1',
    });
    const ser = resourceTaskToEdxlRm(task, { sentDateTime: FIXED });
    if (!ser.ok) throw new Error('fixture serialize failed');
    return ser.value;
  }

  it('POST /edxl/rm imports a canonical task, GET /edxl/rm/:id exports it back', async () => {
    const d = deps();
    const post = await handleHttp(
      req({ method: 'POST', path: '/api/v1/edxl/rm', headers: roleHeaders('RESPONDER'), body: JSON.stringify(inboundMessage()) }),
      d,
    );
    expect(post.status).toBe(201);
    expect(asEnvelope(post.body).meta?.correlationId).toBe('urn:beacon:rm:corr-http-1');

    const get = await handleHttp(
      req({ method: 'GET', path: '/api/v1/edxl/rm/urn:beacon:rm:corr-http-1', headers: roleHeaders('RESPONDER') }),
      d,
    );
    expect(get.status).toBe(200);
    expect((asEnvelope(get.body).data as { task: { status: string } }).task.status).toBe('PROPOSED');
  });

  it('POST /edxl/rm by PUBLIC → 403', async () => {
    const res = await handleHttp(
      req({ method: 'POST', path: '/api/v1/edxl/rm', body: JSON.stringify(inboundMessage()) }),
      deps(),
    );
    expect(res.status).toBe(403);
  });
});

describe('feature-router — JWT auth switch (resolveRoleJwt, ADR-017)', () => {
  const SECRET = 'test-hs256-secret';

  it('a signed VERIFIER bearer token authorizes the VERIFIER-gated approve (201)', async () => {
    const token = await signDevToken('VERIFIER', SECRET);
    // AUTH_SECRET set + no dev-trust header ⇒ the JWT path is the ONLY way to elevate above PUBLIC.
    const d = deps({ core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_SECRET: SECRET } } });
    const res = await handleHttp(
      req({ method: 'POST', path: '/api/v1/alerts/ca-alert-draft-1/approve', headers: { authorization: `Bearer ${token}` } }),
      d,
    );
    expect(res.status).toBe(201);
    expect((asEnvelope(res.body).data as { alert: { capStatus: string } }).alert.capStatus).toBe('ACTUAL');
  });

  it('with AUTH_SECRET set but NO bearer, the caller is PUBLIC (fail-closed) → 403', async () => {
    const d = deps({ core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_SECRET: SECRET } } });
    const res = await handleHttp(
      req({ method: 'POST', path: '/api/v1/alerts/ca-alert-draft-1/approve' }),
      d,
    );
    expect(res.status).toBe(403);
  });
});

describe('feature-router — GET /api/v1/regions/:id/map (COP geometry projection, F1/Art. XIV)', () => {
  it('serves the seeded CA map with non-empty provenance + freshness (F1)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/regions/us-ca/map' }), deps());
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    const data = env.data as { incidentType: string; hazards: unknown[]; route: unknown; reports: { precisePosition?: unknown }[] };
    expect(data.incidentType).toBe('WILDFIRE');
    expect(data.hazards.length).toBeGreaterThan(0);
    expect(data.route).toBeDefined();
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.freshness).toBe(FIXED);
    // PUBLIC (no role header, dev-trust on) → no precise report geometry leaks (Art. XIV).
    expect(data.reports[0]?.precisePosition).toBeUndefined();
  });

  it('reveals precise report geometry to a RESPONDER (Art. XIV)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/regions/us-ca/map', headers: roleHeaders('RESPONDER') }), deps());
    const data = asEnvelope(res.body).data as { reports: { precisePosition?: unknown }[] };
    expect(data.reports[0]?.precisePosition).toBeDefined();
  });

  it('returns 404 for an unknown region', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/regions/atlantis/map' }), deps());
    expect(res.status).toBe(404);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('NOT_FOUND');
  });
});

describe('feature-router — SSE /stream wiring (handleStream via the composed eventBus)', () => {
  it('publishing a delta to the wired eventBus yields a data: frame (tested directly, not via handleHttp)', async () => {
    const d = deps();
    const res = handleStream({ query: { regionId: 'us-ca' } }, d.features);
    const reader = res.stream.getReader();
    const decoder = new TextDecoder();

    const hello = decoder.decode((await reader.read()).value);
    expect(hello).toContain('event: hello');

    const delta: StreamDelta = { type: 'incident.updated', region: 'us-ca', entity: 'us-ca-wildfire-demo', at: FIXED };
    await d.features.eventBus.publish(streamTopic('us-ca'), delta);

    const frame = decoder.decode((await reader.read()).value);
    expect(frame).toContain('event: delta');
    expect(frame).toContain('"entity":"us-ca-wildfire-demo"');
    await reader.cancel();
  });
});

describe('feature-router — GET /api/v1/reports (verifier queue, VERIFIER+; precise geom RESPONDER+)', () => {
  it('PUBLIC → 403 (VERIFIER+ only, Art. XIII)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/reports' }), deps());
    expect(res.status).toBe(403);
  });

  it('RESPONDER → 403 (below VERIFIER)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/reports', headers: roleHeaders('RESPONDER') }), deps());
    expect(res.status).toBe(403);
  });

  it('VERIFIER → 200 with the seeded queue, non-empty provenance (F1), and precise geometry revealed (≥RESPONDER)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/reports', headers: roleHeaders('VERIFIER') }), deps());
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    const data = env.data as { reports: { id: string; status: string; geomPrecise?: unknown }[] };
    expect(data.reports.length).toBeGreaterThan(0);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.freshness).toBe(FIXED);
    expect(data.reports.find((r) => r.id === 'rep-demo-1')?.geomPrecise).toBeDefined();
  });

  it('a POSTed consented report joins the SHARED queue read by GET /reports', async () => {
    const d = deps();
    const before = asEnvelope(
      (await handleHttp(req({ method: 'GET', path: '/api/v1/reports', headers: roleHeaders('VERIFIER') }), d)).body,
    ).data as { reports: unknown[] };
    await handleHttp(
      req({ method: 'POST', path: '/api/v1/reports', body: JSON.stringify({ text: 'smoke near ridge', consent: true }) }),
      d,
    );
    const after = asEnvelope(
      (await handleHttp(req({ method: 'GET', path: '/api/v1/reports', headers: roleHeaders('VERIFIER') }), d)).body,
    ).data as { reports: unknown[] };
    expect(after.reports.length).toBe(before.reports.length + 1);
  });
});

describe('feature-router — GET /api/v1/alerts (DRAFT queue, VERIFIER+)', () => {
  it('PUBLIC → 403 (the alert family is VERIFIER+, SPEC §2.2)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/alerts' }), deps());
    expect(res.status).toBe(403);
  });

  it('VERIFIER → 200 with the computed DRAFT alerts (DRAFT-only, Art. XIII) + non-empty provenance', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/alerts', headers: roleHeaders('VERIFIER') }), deps());
    expect(res.status).toBe(200);
    const env = asEnvelope(res.body);
    const data = env.data as { alerts: { id: string; state: string }[] };
    expect(data.alerts.length).toBeGreaterThan(0);
    expect(data.alerts.every((a) => a.state === 'DRAFT')).toBe(true);
    expect(env.provenance.length).toBeGreaterThan(0);
  });
});
