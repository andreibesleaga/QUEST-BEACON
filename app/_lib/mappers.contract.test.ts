// @vitest-environment node
// BEACON — ENVELOPE↔TYPE SEAM CONTRACT (E8·the lesson). This is the test that would have caught the live COP
// crash: it pipes the ACTUAL HTTP handler output (real handleHttp, never a hand-written fixture) through the
// frontend types + mappers. A green tsc/vitest/next build did NOT catch a client-crashing shape mismatch
// because the unit tests were written against fixtures whose shapes did not match the wire. Here the fixture
// IS the wire. Any drift between the real envelope and the FE types/mappers fails Vitest, not the browser.
import { describe, it, expect } from 'vitest';
import { realGet, DEMO_REGION_ID, FIXED_CLOCK } from './real-http.js';
import { incidentsOf, sitRepOf, reportsOf, alertsOf, decisionFiguresOf } from './mappers.js';
import { projectionToMapData } from './map-data.js';
import type {
  ActorRole,
  AlertsData,
  IncidentsData,
  MapProjectionData,
  ReportsData,
  SitRepData,
} from './types.js';

const INCIDENTS_PATH = `/api/v1/regions/${DEMO_REGION_ID}/incidents`;

describe('seam: GET /regions/:id/incidents ↔ IncidentsData', () => {
  it('the envelope data is an OBJECT with an incidents[] array (NOT a bare array) — bug 1 guard', async () => {
    const { env } = await realGet<IncidentsData>(INCIDENTS_PATH);
    // The exact crash: page.tsx treated `data` as an array and called `.map` → TypeError → blank COP.
    expect(Array.isArray(env.data)).toBe(false);
    expect(Array.isArray(env.data.incidents)).toBe(true);
    const list = incidentsOf(env);
    expect(list.length).toBeGreaterThan(0);
    expect(typeof list[0]!.id).toBe('string');
    expect(typeof list[0]!.type).toBe('string');
    expect(typeof list[0]!.status).toBe('string');
    expect(env.provenance.length).toBeGreaterThan(0); // F1
  });
});

async function firstIncidentId(role: ActorRole = 'PUBLIC'): Promise<string> {
  const { env } = await realGet<IncidentsData>(INCIDENTS_PATH, role);
  return incidentsOf(env)[0]!.id;
}

describe('seam: GET /incidents/:id/sitrep ↔ SitRepData (+ citations)', () => {
  it('fields are {field, claim} (NOT {key,text}); priorities live on data; citations ride the envelope — bug 2 guard', async () => {
    const id = await firstIncidentId();
    const { env } = await realGet<SitRepData>(`/api/v1/incidents/${id}/sitrep`);
    const view = sitRepOf(env);

    expect(Array.isArray(view.data.fields)).toBe(true);
    expect(view.data.fields.length).toBeGreaterThan(0);
    for (const f of view.data.fields) {
      expect(typeof f.field).toBe('string'); // the old FE type read `key` — would be undefined here
      expect('key' in f).toBe(false);
    }
    // priorities are STRUCTURED on data (SPEC §2.4/OpenAPI), rank/label from the engine (Art. XII).
    expect(Array.isArray(view.data.priorities)).toBe(true);
    // citations are TOP-LEVEL on the envelope, never on data (F2).
    expect(env.citations).toBeDefined();
    expect((env.data as { citations?: unknown }).citations).toBeUndefined();
    expect(view.citations.length).toBeGreaterThan(0);
    for (const c of view.citations) {
      expect(typeof c.field).toBe('string');
      expect(typeof c.sourceId).toBe('string');
    }
  });

  it('deterministic-only (offline default) RETAINS priorities, trend, and per-field citations — bug 3/F2 guard', async () => {
    const id = await firstIncidentId();
    const { env } = await realGet<SitRepData>(`/api/v1/incidents/${id}/sitrep`);
    const view = sitRepOf(env);
    expect(view.data.aiMode).toBe('deterministic-only'); // AI off offline (F7)
    expect(view.data.trend).toBeDefined(); // trend retained in the degraded rung
    // 100% field-citation coverage (F2): EVERY grounded field has ≥1 citation in the envelope.
    for (const f of view.data.fields) {
      expect(view.citations.some((c) => c.field === f.field)).toBe(true);
    }
  });

  it('decisionFiguresOf renders engine numbers verbatim (Art. XII) — never client-computed', async () => {
    const id = await firstIncidentId();
    const { env } = await realGet<SitRepData>(`/api/v1/incidents/${id}/sitrep`);
    const figures = decisionFiguresOf(sitRepOf(env).data);
    for (const [i, fig] of figures.entries()) {
      expect(fig.value).toBe(i + 1); // rank is the engine's 1-based order, echoed not recomputed
      expect(typeof fig.label).toBe('string');
    }
  });
});

describe('seam: GET /regions/:id/map ↔ MapProjectionData (existing mapper over REAL output)', () => {
  it('projectionToMapData maps the real envelope without throwing', async () => {
    const { env } = await realGet<MapProjectionData>(`/api/v1/regions/${DEMO_REGION_ID}/map`);
    expect(env.data.regionId).toBe(DEMO_REGION_ID);
    const mode = env.provenance[0]?.mode ?? 'MOCK';
    const md = projectionToMapData(env.data, mode, env.freshness ?? null);
    expect(md.freshness).toBeDefined();
  });

  it('carries the PLURAL predictions[] plus a deprecated singular mirror of predictions[0] (ADR-033 §3.1)', async () => {
    const { env } = await realGet<MapProjectionData>(`/api/v1/regions/${DEMO_REGION_ID}/map`);
    expect(Array.isArray(env.data.predictions)).toBe(true);
    expect(env.data.predictions).toHaveLength(1); // the seeded region carries exactly one prediction today
    // The ADDITIVE contract: a v1 client that only ever learned `prediction` sees exactly `predictions[0]`.
    expect(env.data.prediction).toEqual(env.data.predictions[0]);
    // Every predicted figure keeps its own method + inputs + uncertainty on the wire (Art. XII).
    for (const p of env.data.predictions) {
      expect(p.method.length).toBeGreaterThan(0);
      expect(p.inputs.length).toBeGreaterThan(0);
      expect(p.uncertainty).toMatch(/^±\d+%$/);
    }
    const md = projectionToMapData(env.data, 'MOCK', null);
    expect(md.predictions?.map((c) => c.id)).toEqual(env.data.predictions.map((p) => p.id));
  });

  it('per-layer freshness resolves from the REAL provenance[] — mapped layers stamped, others fall back', async () => {
    const { env } = await realGet<MapProjectionData>(`/api/v1/regions/${DEMO_REGION_ID}/map`);
    const mode = env.provenance[0]?.mode ?? 'MOCK';
    const shared = env.freshness ?? null;
    // The mapper must accept the real provenance[] (retained by useMapData) and never throw on it.
    const md = projectionToMapData(env.data, mode, shared, env.provenance);
    expect(md.freshness).toBeDefined();
    const layerSources = env.data.layerSources ?? {};
    const byId = new Map(env.provenance.map((r) => [r.sourceId, r] as const));
    for (const [layerId, stamp] of Object.entries(md.freshness ?? {})) {
      const mappedSource = (layerSources as Record<string, string | undefined>)[layerId];
      const ref = mappedSource !== undefined ? byId.get(mappedSource) : undefined;
      if (ref !== undefined) {
        // A layer with a KNOWN mapped source carries THAT source's own fetchedAt/mode (per-layer, not shared).
        expect(stamp).toEqual({ fetchedAt: ref.fetchedAt, mode: ref.mode });
      } else {
        // No mapped/known source → the shared envelope stamp (degraded rung, never a break).
        expect(stamp).toEqual({ fetchedAt: shared, mode });
      }
    }
  });
});

describe('seam: GET /reports ↔ ReportsData (VERIFIER+, geomPrecise gated)', () => {
  it('PUBLIC is refused (403) — the queue never leaks to an unauthenticated actor', async () => {
    const { status } = await realGet<ReportsData>('/api/v1/reports', 'PUBLIC');
    expect(status).toBe(403);
  });

  it('VERIFIER sees an object with a reports[] array + precise geometry (≥RESPONDER, Art. XIV)', async () => {
    const { status, env } = await realGet<ReportsData>('/api/v1/reports', 'VERIFIER');
    expect(status).toBe(200);
    expect(Array.isArray(env.data)).toBe(false);
    const reports = reportsOf(env);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.some((r) => r.geomPrecise !== undefined)).toBe(true);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.freshness).toBe(FIXED_CLOCK);
  });
});

describe('seam: GET /alerts ↔ AlertsData (VERIFIER+, DRAFT-only)', () => {
  it('PUBLIC is refused (403)', async () => {
    const { status } = await realGet<AlertsData>('/api/v1/alerts', 'PUBLIC');
    expect(status).toBe(403);
  });

  it('VERIFIER sees an object with an alerts[] array, every one DRAFT (Art. XIII)', async () => {
    const { status, env } = await realGet<AlertsData>('/api/v1/alerts', 'VERIFIER');
    expect(status).toBe(200);
    expect(Array.isArray(env.data)).toBe(false);
    const alerts = alertsOf(env);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((a) => a.state === 'DRAFT')).toBe(true);
  });
});
