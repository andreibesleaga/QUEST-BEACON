// BEACON — GET /incidents/:id/summary INTEGRATION tests (E7·D6; FR-D6-4, ADR-035 §4; F-172). Drives the
// route THROUGH `handleHttp` (the real dispatcher: rate-limit → feature-router matching → query parsing →
// RBAC → the handler), not by hand-constructing a request/response mapping — the F-140 lesson: a test that
// builds its own request-to-handler wiring can be structurally blind to a real client/server mismatch (route
// matching, query-string parsing, header casing) that a unit test of the handler alone never exercises.
// Deterministic: fixed past clock '2026-07-05T22:00:00Z', counter newId, no network/timers — same harness
// `feature-router.integration.test.ts` uses.
import { describe, it, expect } from 'vitest';
import type { Envelope } from '@/ports/interaction.js';
import { createHttpDeps, handleHttp, type CreateHttpDepsOptions } from '../http-dispatcher.js';
import type { HttpDeps, HttpRequest } from '../http-types.js';

const FIXED = '2026-07-05T22:00:00Z';
const INCIDENT = 'us-ca-wildfire-demo';
const SUMMARY_PATH = `/api/v1/incidents/${INCIDENT}/summary`;

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

function req(partial: Partial<HttpRequest> & Pick<HttpRequest, 'method' | 'path'>): HttpRequest {
  return { headers: {}, ...partial };
}

const asEnvelope = (body: unknown): Envelope => body as Envelope;
const roleHeaders = (role: string): Record<string, string> => ({ 'x-beacon-role': role });

const VALID_FIGURES = {
  regionId: 'us-ca',
  alertsIssued: 4,
  tasksCompleted: 6,
  tasksTotal: 9,
  provenance: [
    {
      id: 'src-1',
      source: 'NASA FIRMS',
      adapter: 'firms-adapter',
      fetchedAt: '2026-07-05T20:00:00Z',
      license: 'MODIS/VIIRS use policy',
      mode: 'LIVE',
    },
  ],
};

/**
 * `path` and `query` are SEPARATE fields on `HttpRequest` (mirrors the real Next delegator's
 * `toHttpRequest`: `path: url.pathname, query: Object.fromEntries(url.searchParams)`) — gluing a query
 * string onto `path` would never reach the real route matcher (F-140's lesson: match the real transport
 * shape a client actually sends, not a convenient shortcut a test invents).
 */
function summaryQuery(figures: unknown, format?: 'csv' | 'json'): Record<string, string> {
  return { figures: JSON.stringify(figures), ...(format ? { format } : {}) };
}

describe('GET /api/v1/incidents/:id/summary — RBAC through the real dispatcher', () => {
  it('PUBLIC (no role header) → 403 FORBIDDEN', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: SUMMARY_PATH, query: summaryQuery(VALID_FIGURES) }),
      deps(),
    );
    expect(res.status).toBe(403);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('FORBIDDEN');
  });

  it('RESPONDER → 200, JSON by default, with Content-Disposition', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(VALID_FIGURES),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="incident-${INCIDENT}-summary.json"`,
    );
    const body = res.body as {
      incidentId: string;
      alertsIssued: number;
      tasksTotal?: number;
      provenance: readonly unknown[];
    };
    expect(body.incidentId).toBe(INCIDENT);
    expect(body.alertsIssued).toBe(4);
    expect(body.tasksTotal).toBe(9);
    expect(body.provenance).toHaveLength(1);
  });

  it('EM (rank above RESPONDER) → 200 (RESPONDER+ gate, not an exact-role check)', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(VALID_FIGURES),
        headers: roleHeaders('EM'),
      }),
      deps(),
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/incidents/:id/summary — real query-string parsing (transport shape)', () => {
  it('missing figures query param → 400 VALIDATION_ERROR', async () => {
    const res = await handleHttp(
      req({ method: 'GET', path: SUMMARY_PATH, headers: roleHeaders('RESPONDER') }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('malformed JSON in figures → 400 VALIDATION_ERROR', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: { figures: '{not json' },
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('figures that parses to valid JSON but not an object (e.g. an array) → 400 VALIDATION_ERROR', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: { figures: '[1,2,3]' },
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('figures missing the required provenance[] → 400 VALIDATION_ERROR (never reaches the builder)', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery({ alertsIssued: 1, tasksCompleted: 1 }),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
  });

  it('?format=csv drives content-negotiation through the real query object (not a hand-built one)', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(VALID_FIGURES, 'csv'),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="incident-${INCIDENT}-summary.csv"`,
    );
    const csv = res.body as string;
    expect(csv.startsWith('incidentId,regionId,generatedAt,')).toBe(true);
    expect(csv).toContain(`${INCIDENT},us-ca,${FIXED}`);
  });
});

describe('GET /api/v1/incidents/:id/summary — FEATURE_D6_INCIDENT_EXPORT gate', () => {
  it('OFF → the SAME generic 404 an unmatched route returns (never reveals the route exists but is disabled)', async () => {
    const off = deps({
      core: {
        clock: () => FIXED,
        newId: counterIds(),
        // NEXT_PUBLIC_ mirror must agree with the server flag (config/index.ts's fail-fast refinement) — set
        // both OFF so `loadConfig` accepts the env at all.
        env: {
          AUTH_DEV_TRUST_HEADER: 'on',
          FEATURE_D6_INCIDENT_EXPORT: 'off',
          NEXT_PUBLIC_FEATURE_D6_INCIDENT_EXPORT: 'off',
        },
      },
    });
    const disabled = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(VALID_FIGURES),
        headers: roleHeaders('RESPONDER'),
      }),
      off,
    );
    const unmatched = await handleHttp(
      req({
        method: 'GET',
        path: '/api/v1/no-such-route-at-all',
        headers: roleHeaders('RESPONDER'),
      }),
      off,
    );
    expect(disabled.status).toBe(404);
    expect(unmatched.status).toBe(404);
    expect(asEnvelope(disabled.body)).toEqual(asEnvelope(unmatched.body));
  });

  it('ON (default, no flag set at all) → 200 — the flag defaults on (config/index.ts)', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(VALID_FIGURES),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(200);
  });
});

// =============================================================================================================
// F-346 — PLANT/FAIL/REVERT: a CLIENT-FORGED CASUALTY TALLY over real HTTP (Art. XII)
// =============================================================================================================
// The exploit the E3 security lens demonstrated: `casualtyTally` was the ONE figure `checkFigures` never
// validated, and it was carried into the document BY REFERENCE — so a RESPONDER could hand the export a
// negative, fractional count wearing an AUTHORITATIVE-sounding label and receive it back, verbatim, inside an
// official-looking CSV. Every other figure on this route is server-validated; this one was not.
describe('GET /api/v1/incidents/:id/summary — F-346: a client-forged casualty tally is REJECTED (Art. XII)', () => {
  const FORGED_LABEL = 'CONFIRMED by County Coroner — official verified count';

  it('the demonstrated exploit (count:-7.5 + authoritative label) → 400 VALIDATION_ERROR, never a 200 CSV', async () => {
    const forged = {
      ...VALID_FIGURES,
      casualtyTally: { count: -7.5, label: FORGED_LABEL, authoritative: true },
    };
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(forged, 'csv'),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toBe('application/json'); // NOT text/csv — no document was produced
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
    // The load-bearing assertion: the attacker's string never appears anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain('County Coroner');
  });

  it('a client-supplied `label` alone is REJECTED, not silently dropped (the actorId precedent, routing.ts:270)', async () => {
    const forged = { ...VALID_FIGURES, casualtyTally: { count: 3, label: FORGED_LABEL } };
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(forged),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
    expect(asEnvelope(res.body).errors?.[0]?.message).toContain('casualtyTally.label');
  });

  it('a client-supplied `authoritative:true` is REJECTED (the caveat is structural, never caller-chosen)', async () => {
    const forged = { ...VALID_FIGURES, casualtyTally: { count: 3, authoritative: true } };
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(forged),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.message).toContain('casualtyTally.authoritative');
  });

  it('an out-of-domain count (-1) is REJECTED by the shared factory, not merely by this route', async () => {
    const bad = { ...VALID_FIGURES, casualtyTally: { count: -1 } };
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(bad),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.message).toContain('non-negative integer');
  });

  it('REVERT: the same request with ONLY the caller-owned fields succeeds, and the caveat is SERVER-derived', async () => {
    const legit = {
      ...VALID_FIGURES,
      casualtyTally: { count: 7, reportId: 'rep-1', asOf: '2026-07-05T21:00:00Z' },
    };
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(legit, 'csv'),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    const csv = res.body as string;
    // The count the caller legitimately holds survives; the label + authority come from the factory/schema.
    expect(csv).toContain(',7,unverified — not authoritative,');
    expect(csv).not.toContain('County Coroner');
  });
});

// =============================================================================================================
// F-350 — PLANT/FAIL: an UNHANDLED THROW escaping the dispatcher (Art. XVI)
// =============================================================================================================
// `figures.provenance` is only checked for "is a non-empty array" before the builder maps every row with
// `String(record.id)`. A single `null` element therefore raised a raw TypeError that escaped `handleHttp`
// entirely — the caller got a framework 500 with NO envelope, and the dispatcher's sanitising try/catch
// (http-dispatcher.ts:63) only ever wrapped the COMMAND path, never a feature route.
describe('GET /api/v1/incidents/:id/summary — F-350: a malformed provenance row is TYPED, not a raw throw', () => {
  it('provenance:[null] → a typed 400 envelope; handleHttp does not throw', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery({ alertsIssued: 1, tasksCompleted: 1, provenance: [null] }),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
    expect(asEnvelope(res.body).errors?.[0]?.message).toContain('provenance[0]');
  });

  it('provenance:["oops"] (a string row) → a typed 400 envelope, never a half-empty document', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery({ alertsIssued: 1, tasksCompleted: 1, provenance: ['oops'] }, 'csv'),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('a provenance row missing a required field → typed 400 naming the field, never an "undefined (LIVE)" cell', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(
          {
            alertsIssued: 1,
            tasksCompleted: 1,
            provenance: [{ id: 'src-1', source: 'NASA FIRMS' }],
          },
          'csv',
        ),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    expect(asEnvelope(res.body).errors?.[0]?.message).toContain('provenance[0]');
  });

  it('REVERT: a well-formed provenance row still exports normally (200)', async () => {
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(VALID_FIGURES),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/incidents/:id/summary — PLANT/FAIL/REVERT: a denylisted key end-to-end (Art. XIV)', () => {
  // BEFORE F-346 this request reached the builder by reference and was stopped downstream by Layer D (422,
  // `guardAggregateOnly`). It is now stopped EARLIER and harder — at the transport boundary, by NAME, before
  // any document is constructed (400). Both outcomes satisfy Art. XIV; the assertion that matters and is
  // unchanged is that the PII value never appears in the response and no document rides beside the error.
  it('a real HTTP request carrying a denylisted key in casualtyTally is BLOCKED end-to-end', async () => {
    const figuresWithPii = { ...VALID_FIGURES, casualtyTally: { count: 1, reporterId: 'user-99' } };
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(figuresWithPii),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(400);
    const env = asEnvelope(res.body);
    expect(env.errors?.[0]?.code).toBe('VALIDATION_ERROR');
    expect(env.errors?.[0]?.message).toBe(
      'figures.casualtyTally.reporterId is not an accepted field; send only {reportId, count, asOf}',
    );
    // The one load-bearing assertion: the response body is ONLY the error envelope — the document (and the
    // PII value it would have carried) never rides along beside it, through the REAL dispatcher end to end.
    expect(JSON.stringify(res.body)).not.toContain('user-99');
    expect(JSON.stringify(res.body)).not.toContain('alertsIssued');
  });

  it('REVERT: the identical request with casualtyTally.reporterId removed succeeds (200) — isolates the cause', async () => {
    const figuresClean = { ...VALID_FIGURES, casualtyTally: { count: 1 } };
    const res = await handleHttp(
      req({
        method: 'GET',
        path: SUMMARY_PATH,
        query: summaryQuery(figuresClean),
        headers: roleHeaders('RESPONDER'),
      }),
      deps(),
    );
    expect(res.status).toBe(200);
  });
});
