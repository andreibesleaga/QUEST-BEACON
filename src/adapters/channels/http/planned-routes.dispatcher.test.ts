// BEACON — dispatcher tests for the five formerly-planned GET routes (UNIMPLEMENTED_REGISTER rows 14-18).
// DETERMINISTIC: fixed clock + counter ids, the offline DEFAULT_SEED, no network, no Next.js — the
// http-dispatcher.test.ts pattern. These run END-TO-END through `handleHttp`, which is the level the
// register's claim lives at: every one of these paths used to answer 404 there.
//
// Per route: the happy path (200 + the envelope contract: data + NON-EMPTY provenance + freshness), the
// 404 for an unknown id, and the RBAC refusal. `GET /incidents/{id}` and `/exposure` are PUBLIC by contract
// (the same rank the `incidents` verb carries), so their "RBAC" assertion is that PUBLIC IS served — a
// tightening there would be the regression, and it is pinned here.
import { describe, it, expect } from 'vitest';
import type { Envelope } from '@/ports/interaction.js';
import { createHttpDeps, handleHttp, type CreateHttpDepsOptions } from './http-dispatcher.js';
import type { HttpDeps, HttpRequest } from './http-types.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ThresholdRuleId } from '@/domain/value-objects/ids.js';
import type { AppUserRole } from '@/domain/app-user.js';

const FIXED = '2026-07-05T22:00:00Z';

function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

function deps(overrides: CreateHttpDepsOptions = {}): HttpDeps {
  return createHttpDeps({
    core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_DEV_TRUST_HEADER: 'on' } },
    rateLimit: { capacity: 1000, refillPerSec: 0 },
    ...overrides,
  });
}

const roleHeaders = (role: AppUserRole): Record<string, string> => ({ 'x-beacon-role': role });

function req(partial: Partial<HttpRequest> & Pick<HttpRequest, 'method' | 'path'>): HttpRequest {
  return { headers: {}, ...partial };
}

const asEnvelope = (body: unknown): Envelope => body as Envelope;

/** Every successful data response owes data + a NON-EMPTY provenance[] + freshness (F1, AGENTS §4). */
function expectEnvelopeContract(body: unknown): Envelope {
  const env = asEnvelope(body);
  expect(env.data).toBeDefined();
  expect(env.provenance.length).toBeGreaterThan(0);
  expect(env.freshness).toBeTypeOf('string');
  return env;
}

describe('GET /api/v1/incidents/{id} — register row 14 (was 404)', () => {
  it('serves the incident record with the full envelope contract', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/incidents/us-ca-wildfire-demo' }), deps());
    expect(res.status).toBe(200);
    const env = expectEnvelopeContract(res.body);
    expect((env.data as { id: string; regionId: string }).id).toBe('us-ca-wildfire-demo');
    expect((env.data as { regionId: string }).regionId).toBe('us-ca');
  });

  it('404s for an unknown incident id', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/incidents/no-such-incident' }), deps());
    expect(res.status).toBe(404);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('NOT_FOUND');
  });

  it('is PUBLIC by contract — an anonymous caller is served, exactly like GET /regions/:id/incidents', async () => {
    const anonymous = await handleHttp(req({ method: 'GET', path: '/api/v1/incidents/ro-flood-demo' }), deps());
    expect(anonymous.status).toBe(200);
    expect((asEnvelope(anonymous.body).data as { regionId: string }).regionId).toBe('ro');
  });

  it('does not shadow the sibling 3-segment incident routes (/sitrep, /summary)', async () => {
    const sitrep = await handleHttp(req({ method: 'GET', path: '/api/v1/incidents/us-ca-wildfire-demo/sitrep' }), deps());
    expect(sitrep.status).toBe(200);
    expect(asEnvelope(sitrep.body).citations?.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/incidents/{id}/exposure — register row 15 (was 404)', () => {
  it('serves the deterministic exposure rows with the full envelope contract', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/incidents/us-ca-wildfire-demo/exposure' }),
      deps(),
    );
    expect(res.status).toBe(200);
    const env = expectEnvelopeContract(res.body);
    const data = env.data as { incidentId: string; regionId: string; count: number; exposure: readonly unknown[] };
    expect(data.incidentId).toBe('us-ca-wildfire-demo');
    expect(data.regionId).toBe('us-ca');
    expect(data.count).toBeGreaterThan(0);
    expect(data.exposure.length).toBe(data.count);
  });

  // The engine is NOT re-implemented: these rows must be the ones GET /regions/:id/map already serves.
  it('serves EXACTLY the exposure slice of GET /regions/us-ca/map (one computation, two doors)', async () => {
    const d = deps();
    const viaMap = await handleHttp(req({ method: 'GET', path: '/api/v1/regions/us-ca/map' }), d);
    const viaIncident = await handleHttp(
      req({ method: 'GET', path: '/api/v1/incidents/us-ca-wildfire-demo/exposure' }),
      d,
    );
    const mapExposure = (asEnvelope(viaMap.body).data as { exposure: readonly unknown[] }).exposure;
    const routeExposure = (asEnvelope(viaIncident.body).data as { exposure: readonly unknown[] }).exposure;
    expect(routeExposure).toEqual(mapExposure);
  });

  it('404s for an unknown incident id', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/incidents/no-such-incident/exposure' }), deps());
    expect(res.status).toBe(404);
  });

  it('is PUBLIC by contract — exposure rows name infrastructure assets, never a person (Art. XIV)', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/incidents/ro-flood-demo/exposure' }), deps());
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/health/adapters — register row 16 (was 404)', () => {
  it('refuses PUBLIC with 403 FORBIDDEN — degradation posture is not public', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/health/adapters' }), deps());
    expect(res.status).toBe(403);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('FORBIDDEN');
  });

  it('serves RESPONDER the per-adapter report with the full envelope contract', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/health/adapters', headers: roleHeaders('RESPONDER') }),
      deps(),
    );
    expect(res.status).toBe(200);
    const env = expectEnvelopeContract(res.body);
    const data = env.data as { status: string; adapters: readonly { adapterId: string; mode: string; degraded: boolean }[]; counts: { total: number } };
    expect(data.adapters.length).toBe(data.counts.total);
    expect(data.adapters.map((a) => a.adapterId)).toContain('firms');
    // The offline profile serves every source from the recorded-mock rung — reported, not hidden (Art. XVI).
    expect(data.status).toBe('degraded');
    expect(data.adapters.every((a) => a.mode === 'MOCK' && a.degraded)).toBe(true);
  });

  it('the single-segment /health liveness probe is untouched by the new 2-segment route', async () => {
    const res = await handleHttp(req({ method: 'GET', path: '/api/v1/health' }), deps());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('404s for an unknown /health/* subresource (the pair table matches `adapters` only)', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/health/nope', headers: roleHeaders('EM') }),
      deps(),
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/threshold-rules — register row 17 (was 404)', () => {
  it('refuses VERIFIER with 403 FORBIDDEN — threshold-rule config is EM-only (CLARIFICATIONS §B.Q6)', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/threshold-rules', headers: roleHeaders('VERIFIER') }),
      deps(),
    );
    expect(res.status).toBe(403);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('FORBIDDEN');
  });

  it('serves EM the envelope contract (an unwired composition honestly reports zero rules)', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/threshold-rules', headers: roleHeaders('EM') }),
      deps(),
    );
    expect(res.status).toBe(200);
    const env = expectEnvelopeContract(res.body);
    const data = env.data as { rules: readonly unknown[]; count: number };
    expect(data.count).toBe(data.rules.length);
  });

  // The wiring contract: whatever `buildFeatureDeps` puts on `features.thresholdRules` is what this route
  // lists, verbatim. Pinning it here means the composition-root patch that supplies the seed's rules cannot
  // land in a shape the endpoint silently ignores.
  it('lists the composition-supplied rules verbatim when they are wired', async () => {
    const rule = makeThresholdRule({
      id: asId<ThresholdRuleId>('ca-hazard-buffer-rule'),
      target: 'HAZARD_BUFFER',
      operator: 'enters',
      value: '1000m',
    });
    const base = deps();
    const wired: HttpDeps = { ...base, features: { ...base.features, thresholdRules: [rule] } };
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/threshold-rules', headers: roleHeaders('EM') }),
      wired,
    );
    expect(res.status).toBe(200);
    expect(asEnvelope(res.body).data).toEqual({ rules: [rule], count: 1 });
  });
});

describe('GET /api/v1/audit-events — register row 18 (was 404)', () => {
  it('refuses RESPONDER with 403 FORBIDDEN — "view audit log" is VERIFIER/EM', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/audit-events', headers: roleHeaders('RESPONDER') }),
      deps(),
    );
    expect(res.status).toBe(403);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('FORBIDDEN');
  });

  it('serves VERIFIER an empty, verified chain on a fresh process (nothing has been audited yet)', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/audit-events', headers: roleHeaders('VERIFIER') }),
      deps(),
    );
    expect(res.status).toBe(200);
    const env = expectEnvelopeContract(res.body);
    expect(env.data).toEqual({ events: [], total: 0, chainVerified: true });
    expect(env.meta?.['page']).toEqual({ limit: 50, offset: 0, hasMore: false, nextCursor: null });
  });

  it('surfaces the REAL chain the CAP emit gate writes to — approve an alert, then read the link', async () => {
    const d = deps();
    const approved = await handleHttp(
      req({ method: 'POST', path: '/api/v1/alerts/ca-alert-draft-1/approve', headers: roleHeaders('VERIFIER') }),
      d,
    );
    expect(approved.status).toBe(201);

    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/audit-events', headers: roleHeaders('EM') }),
      d,
    );
    expect(res.status).toBe(200);
    const data = asEnvelope(res.body).data as {
      events: readonly { action: string; target: string; hash: string; prevHash?: string }[];
      total: number;
      chainVerified: boolean;
    };
    expect(data.total).toBe(1);
    expect(data.chainVerified).toBe(true);
    expect(data.events[0]?.action).toBe('ALERT_EMIT');
    expect(data.events[0]?.target).toBe('alert:ca-alert-draft-1');
    expect(data.events[0]?.hash).toBeTypeOf('string');
    expect(data.events[0]?.prevHash).toBeUndefined(); // genesis link of this chain
  });

  it('rejects a malformed page param with 400 rather than silently paging from row 0', async () => {
    for (const query of [{ limit: 'abc' }, { offset: '-1' }, { limit: '1.5' }]) {
      const res = await handleHttp(
        req({ method: 'GET', path: '/api/v1/audit-events', headers: roleHeaders('EM'), query }),
        deps(),
      );
      expect(res.status).toBe(400);
      expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
    }
  });

  it('honours ?limit= / ?offset= end to end', async () => {
    const d = deps();
    await handleHttp(
      req({ method: 'POST', path: '/api/v1/alerts/ca-alert-draft-1/approve', headers: roleHeaders('VERIFIER') }),
      d,
    );
    const res = await handleHttp(
      req({ method: 'GET', path: '/api/v1/audit-events', headers: roleHeaders('EM'), query: { limit: '1', offset: '1' } }),
      d,
    );
    expect(res.status).toBe(200);
    expect((asEnvelope(res.body).data as { events: readonly unknown[] }).events).toEqual([]);
    expect(asEnvelope(res.body).meta?.['page']).toEqual({ limit: 1, offset: 1, hasMore: false, nextCursor: null });
  });
});
