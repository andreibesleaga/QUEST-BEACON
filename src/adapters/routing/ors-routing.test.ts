// BEACON — ORS routing adapter tests (W4a; FR-7, EV7, ADR-016). Fixture-driven, injected HttpClient — no
// network. Proves: success maps the ORS geojson route into the EvacRoute domain shape; avoid_polygons is
// sent from the injected hazard footprint ONLY when it is a Polygon/MultiPolygon; 4xx/5xx and malformed
// bodies degrade to a typed err (never throw) so planEvacRoute's heuristic fallback stays reachable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { Geometry, PointGeometry, PolygonGeometry } from '@/domain/value-objects/geo.js';
import type { HttpClient, HttpResponse } from '@/adapters/ai/http-client.js';
import { makeOrsRoutingAdapter, type OrsRoutingAdapterDeps } from './ors-routing.js';

const FIXTURES_DIR = fileURLToPath(new URL('./__fixtures__', import.meta.url));
const loadFixture = (name: string): unknown => JSON.parse(readFileSync(`${FIXTURES_DIR}/${name}`, 'utf8')) as unknown;

const SUCCESS_BODY = loadFixture('ors-directions-success.json');
const ERROR_BODY = loadFixture('ors-directions-error.json');

const INCIDENT = asId<IncidentId>('inc-ors-1');

const HAZARD: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [[[8.683, 49.417], [8.686, 49.417], [8.686, 49.419], [8.683, 49.419], [8.683, 49.417]]],
};

interface Call {
  readonly url: string;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

/** Records every call and returns a canned response (mirrors openai-compatible-provider.test.ts's fakeHttp). */
function fakeHttp(response: HttpResponse): { http: HttpClient; calls: Call[] } {
  const calls: Call[] = [];
  const http: HttpClient = {
    postJson(url, body, headers = {}) {
      calls.push({ url, body, headers });
      return Promise.resolve(response);
    },
  };
  return { http, calls };
}

function makeDeps(http: HttpClient, hazardFor: (id: IncidentId) => Geometry | undefined): OrsRoutingAdapterDeps {
  let n = 0;
  return { http, apiKey: 'test-ors-key', hazardFor, newId: (p) => `${p}-${++n}` };
}

describe('makeOrsRoutingAdapter.route', () => {
  it('maps a 2xx GeoJSON directions response to a ROUTED EvacRoute (avoidsHazard=true, geometry from the fixture)', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({ incidentId: INCIDENT, from: [8.681495, 49.41461], to: [8.687872, 49.420318] });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.incidentId).toBe(INCIDENT);
    expect(r.value.avoidsHazard).toBe(true);
    expect(r.value.engine).toBe('ors'); // the honest engine tag the route panel labels from
    expect(r.value.geom.type).toBe('LineString');
    expect(r.value.geom.coordinates.length).toBe(8); // from the fixture's 8-point route
    expect(r.value.geom.coordinates[0]).toEqual([8.681495, 49.41461]);
    expect(r.value.geom.coordinates.at(-1)).toEqual([8.687872, 49.420318]);
    expect(calls[0]?.url).toBe('https://api.openrouteservice.org/v2/directions/driving-car/geojson');
    expect(calls[0]?.headers.Authorization).toBe('test-ors-key');
  });

  it('sends options.avoid_polygons built from the injected hazard footprint (Polygon)', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    await adapter.route({ incidentId: INCIDENT, from: [8.681495, 49.41461], to: [8.687872, 49.420318] });
    const body = calls[0]?.body as { coordinates: unknown; options?: { avoid_polygons?: unknown } };
    expect(body.coordinates).toEqual([[8.681495, 49.41461], [8.687872, 49.420318]]);
    expect(body.options?.avoid_polygons).toEqual(HAZARD);
  });

  it('omits options.avoid_polygons when no hazard footprint is known (avoidsHazard=false, honest label)', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => undefined));
    const r = await adapter.route({ incidentId: INCIDENT, from: [8.681495, 49.41461], to: [8.687872, 49.420318] });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.avoidsHazard).toBe(false);
    const body = calls[0]?.body as { options?: unknown };
    expect(body.options).toBeUndefined();
  });

  it('omits options.avoid_polygons when the hazard footprint is not a Polygon/MultiPolygon (honest skip, no coercion)', async () => {
    const point: PointGeometry = { type: 'Point', coordinates: [8.684, 49.418] };
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => point));
    const r = await adapter.route({ incidentId: INCIDENT, from: [8.681495, 49.41461], to: [8.687872, 49.420318] });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.avoidsHazard).toBe(false);
    const body = calls[0]?.body as { options?: unknown };
    expect(body.options).toBeUndefined();
  });

  it('honours avoidHazard=false (no avoidance attempted even though a hazard is known)', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    await adapter.route({ incidentId: INCIDENT, from: [8.681495, 49.41461], to: [8.687872, 49.420318], avoidHazard: false });
    const body = calls[0]?.body as { options?: unknown };
    expect(body.options).toBeUndefined();
  });

  it('returns a typed err on a 4xx response (never throws)', async () => {
    const { http } = fakeHttp({ status: 404, ok: false, json: ERROR_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [1, 1] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('returns a typed err on a 5xx response (never throws)', async () => {
    const { http } = fakeHttp({ status: 503, ok: false, json: null });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [1, 1] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('returns a typed err when the HTTP client itself throws (network/timeout — never throws out)', async () => {
    const http: HttpClient = {
      postJson: () => Promise.reject(new Error('network/timeout: fetch failed')),
    };
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [1, 1] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('NOT_FOUND');
      expect(r.error.message).toMatch(/network\/timeout/);
    }
  });

  it('returns a typed err on a malformed/empty 2xx body (missing features)', async () => {
    const { http } = fakeHttp({ status: 200, ok: true, json: { type: 'FeatureCollection', features: [] } });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [1, 1] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PARSE_ERROR');
  });

  it('returns a typed err on a malformed/empty 2xx body (non-JSON / null)', async () => {
    const { http } = fakeHttp({ status: 200, ok: true, json: null });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [1, 1] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PARSE_ERROR');
  });

  it('returns a typed err when the LineString geometry has fewer than 2 positions', async () => {
    const malformed = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0]] }, properties: {} }],
    };
    const { http } = fakeHttp({ status: 200, ok: true, json: malformed });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [1, 1] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PARSE_ERROR');
  });

  it('uses a configurable baseUrl/profile when provided', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const deps = { ...makeDeps(http, () => HAZARD), baseUrl: 'https://ors.internal', profile: 'foot-walking' };
    const adapter = makeOrsRoutingAdapter(deps);
    await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [1, 1] });
    expect(calls[0]?.url).toBe('https://ors.internal/v2/directions/foot-walking/geojson');
  });
});
