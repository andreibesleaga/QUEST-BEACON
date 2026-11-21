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
import type {
  Geometry,
  MultiPolygonGeometry,
  PointGeometry,
  PolygonGeometry,
} from '@/domain/value-objects/geo.js';
import type { HttpClient, HttpResponse } from '@/adapters/ai/http-client.js';
import {
  avoidAreaFor,
  makeOrsRoutingAdapter,
  routeClearOf,
  type OrsRoutingAdapterDeps,
} from './ors-routing.js';

const FIXTURES_DIR = fileURLToPath(new URL('./__fixtures__', import.meta.url));
const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(`${FIXTURES_DIR}/${name}`, 'utf8')) as unknown;

const SUCCESS_BODY = loadFixture('ors-directions-success.json');
const ERROR_BODY = loadFixture('ors-directions-error.json');

const INCIDENT = asId<IncidentId>('inc-ors-1');

const HAZARD: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [8.683, 49.417],
      [8.686, 49.417],
      [8.686, 49.419],
      [8.683, 49.419],
      [8.683, 49.417],
    ],
  ],
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

function makeDeps(
  http: HttpClient,
  hazardFor: (id: IncidentId) => Geometry | undefined,
): OrsRoutingAdapterDeps {
  let n = 0;
  return { http, apiKey: 'test-ors-key', hazardFor, newId: (p) => `${p}-${++n}` };
}

describe('makeOrsRoutingAdapter.route', () => {
  it('maps a 2xx GeoJSON directions response to a ROUTED EvacRoute (avoidsHazard=true, geometry from the fixture)', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({
      incidentId: INCIDENT,
      from: [8.681495, 49.41461],
      to: [8.687872, 49.420318],
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.incidentId).toBe(INCIDENT);
    expect(r.value.avoidsHazard).toBe(true);
    expect(r.value.engine).toBe('ors'); // the honest engine tag the route panel labels from
    expect(r.value.geom.type).toBe('LineString');
    expect(r.value.geom.coordinates.length).toBe(8); // from the fixture's 8-point route
    expect(r.value.geom.coordinates[0]).toEqual([8.681495, 49.41461]);
    expect(r.value.geom.coordinates.at(-1)).toEqual([8.687872, 49.420318]);
    expect(calls[0]?.url).toBe(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
    );
    expect(calls[0]?.headers.Authorization).toBe('test-ors-key');
  });

  it('sends options.avoid_polygons built from the injected hazard footprint (Polygon)', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    await adapter.route({
      incidentId: INCIDENT,
      from: [8.681495, 49.41461],
      to: [8.687872, 49.420318],
    });
    const body = calls[0]?.body as { coordinates: unknown; options?: { avoid_polygons?: unknown } };
    expect(body.coordinates).toEqual([
      [8.681495, 49.41461],
      [8.687872, 49.420318],
    ]);
    expect(body.options?.avoid_polygons).toEqual(HAZARD);
  });

  it('omits options.avoid_polygons when no hazard footprint is known (avoidsHazard=false, honest label)', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => undefined));
    const r = await adapter.route({
      incidentId: INCIDENT,
      from: [8.681495, 49.41461],
      to: [8.687872, 49.420318],
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.avoidsHazard).toBe(false);
    const body = calls[0]?.body as { options?: unknown };
    expect(body.options).toBeUndefined();
  });

  it('omits options.avoid_polygons when the hazard footprint is not a Polygon/MultiPolygon (honest skip, no coercion)', async () => {
    const point: PointGeometry = { type: 'Point', coordinates: [8.684, 49.418] };
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => point));
    const r = await adapter.route({
      incidentId: INCIDENT,
      from: [8.681495, 49.41461],
      to: [8.687872, 49.420318],
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.avoidsHazard).toBe(false);
    const body = calls[0]?.body as { options?: unknown };
    expect(body.options).toBeUndefined();
  });

  it('honours avoidHazard=false (no avoidance attempted even though a hazard is known)', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    await adapter.route({
      incidentId: INCIDENT,
      from: [8.681495, 49.41461],
      to: [8.687872, 49.420318],
      avoidHazard: false,
    });
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

  it('names the cause of a refusal by ORS code, and never forwards the coordinates ORS quotes', async () => {
    // The 2026-11-21 live case: a valid key, HTTP 400, because the route was too long for an avoid area.
    const tooLong = {
      error: {
        code: 2004,
        message:
          'Request parameters exceed the server configuration limits. With avoid areas, the approximated route distance must not be greater than 150000.0 meters.',
      },
    };
    const offRoad = {
      error: {
        code: 2010,
        message:
          'Could not find routable point within a radius of 350.0 meters of specified coordinate 0: -121.7100000 36.2500000.',
      },
    };
    const messageFor = async (status: number, json: unknown): Promise<string> => {
      const { http } = fakeHttp({ status, ok: false, json });
      const r = await makeOrsRoutingAdapter(makeDeps(http, () => HAZARD)).route({
        incidentId: INCIDENT,
        from: [-121.71, 36.25],
        to: [-119.77, 36.74],
      });
      if (!isErr(r)) throw new Error('expected err');
      return r.error.message;
    };
    expect(await messageFor(400, tooLong)).toBe(
      'ORS routing HTTP 400 (ORS code 2004: request exceeds the service limits (with an avoid area the route may not be this long))',
    );
    const offRoadMessage = await messageFor(404, offRoad);
    expect(offRoadMessage).toContain('ORS code 2010');
    expect(offRoadMessage).not.toContain('121.71');
    expect(await messageFor(400, { error: { code: 2099 } })).toBe(
      'ORS routing HTTP 400 (ORS code 2099)',
    );
    expect(await messageFor(503, null)).toBe('ORS routing HTTP 503');
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
    const { http } = fakeHttp({
      status: 200,
      ok: true,
      json: { type: 'FeatureCollection', features: [] },
    });
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
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0]] },
          properties: {},
        },
      ],
    };
    const { http } = fakeHttp({ status: 200, ok: true, json: malformed });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [1, 1] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PARSE_ERROR');
  });

  it('uses a configurable baseUrl/profile when provided', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const deps = {
      ...makeDeps(http, () => HAZARD),
      baseUrl: 'https://ors.internal',
      profile: 'foot-walking',
    };
    const adapter = makeOrsRoutingAdapter(deps);
    await adapter.route({ incidentId: INCIDENT, from: [0, 0], to: [1, 1] });
    expect(calls[0]?.url).toBe('https://ors.internal/v2/directions/foot-walking/geojson');
  });
});

// 2026-09-14 — the route in words: ORS's own summary and turn instructions travel on the route, verbatim.
describe('makeOrsRoutingAdapter.route — narrative', () => {
  it('carries the fixture’s summary distance/duration and its turn instructions', async () => {
    const { http } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({
      incidentId: INCIDENT,
      from: [8.681495, 49.41461],
      to: [8.687872, 49.420318],
    });
    if (!isOk(r)) throw new Error('expected ok');
    expect(r.value.distanceM).toBe(743);
    expect(r.value.durationSec).toBe(128.7);
    expect(r.value.steps?.length).toBe(3);
    expect(typeof r.value.steps?.[0]).toBe('string');
  });

  it('carries nothing when the response has no summary or steps — never a guessed figure', async () => {
    const body = JSON.parse(JSON.stringify(SUCCESS_BODY)) as {
      features: { properties?: unknown }[];
    };
    delete body.features[0]!.properties;
    const { http } = fakeHttp({ status: 200, ok: true, json: body });
    const adapter = makeOrsRoutingAdapter(makeDeps(http, () => HAZARD));
    const r = await adapter.route({
      incidentId: INCIDENT,
      from: [8.681495, 49.41461],
      to: [8.687872, 49.420318],
    });
    if (!isOk(r)) throw new Error('expected ok');
    expect(r.value.distanceM).toBeUndefined();
    expect(r.value.steps).toBeUndefined();
  });
});

// The public service refuses an avoid polygon wider than 20 km or larger than 200 km² — per polygon
// (measured 2026-11-21). These pin what is sent for a footprint on each side of that line.
describe('avoidAreaFor — an avoid area the service will accept', () => {
  const rect = (w: number, s: number, e: number, n: number): PolygonGeometry => ({
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });
  /** Width, height and corner-to-corner size of one ring's bounding rectangle, in km. */
  const sizeOf = (
    ring: readonly (readonly [number, number])[],
  ): { w: number; h: number; d: number } => {
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const mid = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
    const w = (Math.max(...lons) - Math.min(...lons)) * 111.32 * Math.cos(mid);
    const h = (Math.max(...lats) - Math.min(...lats)) * 110.57;
    return { w, h, d: Math.hypot(w, h) };
  };

  it('sends a footprint within the limits exactly as it is', () => {
    expect(avoidAreaFor(HAZARD)).toBe(HAZARD);
    // The seeded demo box: 0.1° × 0.1° at 39.7°N — about 8.6 km × 11.1 km, 14 km corner to corner.
    const demoBox = rect(-121.65, 39.65, -121.55, 39.75);
    expect(avoidAreaFor(demoBox)).toBe(demoBox);
  });

  it('tiles the real case of 2026-11-21: a 15 km × 13 km fire rectangle, 20 km corner to corner', () => {
    const area = avoidAreaFor(rect(-121.791, 36.192, -121.622, 36.31));
    if (area === null || area.type !== 'MultiPolygon') throw new Error('expected a tile grid');
    expect(area.coordinates).toHaveLength(4); // 2 columns × 2 rows
    for (const tile of area.coordinates) {
      const { w, h, d } = sizeOf(tile[0] as [number, number][]);
      expect(d).toBeLessThan(18);
      expect(w * h).toBeLessThan(180);
    }
  });

  it('covers the whole bounding rectangle with the tiles — nothing of the footprint is left out', () => {
    const area = avoidAreaFor(rect(-121.95, 39.43, -121.25, 39.97)); // about 60 km × 60 km
    if (area === null || area.type !== 'MultiPolygon') throw new Error('expected a tile grid');
    const all = area.coordinates.flatMap((tile) => tile[0] as [number, number][]);
    expect(Math.min(...all.map((p) => p[0]))).toBeCloseTo(-121.95, 9);
    expect(Math.max(...all.map((p) => p[0]))).toBeCloseTo(-121.25, 9);
    expect(Math.min(...all.map((p) => p[1]))).toBeCloseTo(39.43, 9);
    expect(Math.max(...all.map((p) => p[1]))).toBeCloseTo(39.97, 9);
    expect(area.coordinates.length).toBe(36); // 6 × 6
    for (const tile of area.coordinates)
      expect(sizeOf(tile[0] as [number, number][]).d).toBeLessThan(18);
  });

  it('leaves a MultiPolygon alone when each of its polygons is within the limits, however far apart', () => {
    const scattered: MultiPolygonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        rect(-121.7, 36.2, -121.65, 36.25).coordinates,
        rect(-120.0, 39.0, -119.95, 39.05).coordinates,
      ],
    };
    expect(avoidAreaFor(scattered)).toBe(scattered);
  });

  it('gives up on a footprint the grid cannot reasonably cover', () => {
    expect(avoidAreaFor(rect(-124, 33, -115, 42))).toBeNull(); // most of California
  });
});

describe('makeOrsRoutingAdapter — footprints over the service limits', () => {
  const rectangle = (w: number, s: number, e: number, n: number): PolygonGeometry => ({
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });

  it('asks ORS with the tile grid and reports the route as hazard-avoiding', async () => {
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const big = rectangle(-121.791, 36.192, -121.622, 36.31);
    const r = await makeOrsRoutingAdapter(makeDeps(http, () => big)).route({
      incidentId: INCIDENT,
      from: [-121.92, 36.55],
      to: [-121.13, 36.21],
    });
    const body = calls[0]?.body as {
      options?: { avoid_polygons?: { type: string; coordinates: unknown[] } };
    };
    expect(body.options?.avoid_polygons?.type).toBe('MultiPolygon');
    expect(body.options?.avoid_polygons?.coordinates).toHaveLength(4);
    expect(isOk(r) && r.value.avoidsHazard).toBe(true);
  });

  it('a footprint too large for the grid: takes the plain road route only because it is clear of it', async () => {
    // The canned route runs through Heidelberg; the footprint is most of California. No avoid area can be
    // sent, so ORS is asked for the plain route — and it is accepted because it never comes near.
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const r = await makeOrsRoutingAdapter(
      makeDeps(http, () => rectangle(-124, 33, -115, 42)),
    ).route({ incidentId: INCIDENT, from: [8.68, 49.41], to: [8.69, 49.42] });
    expect(calls).toHaveLength(1);
    expect((calls[0]?.body as { options?: unknown }).options).toBeUndefined();
    expect(isOk(r) && r.value.avoidsHazard).toBe(true);
    expect(isOk(r) && r.value.engine).toBe('ors');
  });

  it('refuses the plain road route when it passes through the footprint — never a road route through it', async () => {
    // Same canned route, but now the oversized footprint is central Europe: the route lies inside it.
    const { http, calls } = fakeHttp({ status: 200, ok: true, json: SUCCESS_BODY });
    const r = await makeOrsRoutingAdapter(makeDeps(http, () => rectangle(0, 40, 20, 60))).route({
      incidentId: INCIDENT,
      from: [8.68, 49.41],
      to: [8.69, 49.42],
    });
    expect(calls).toHaveLength(1);
    if (!isErr(r)) throw new Error('expected err');
    expect(r.error.message).toContain('passes through the hazard footprint');
  });

  it('a route too long for any avoid area (ORS 2004): asks again without one and checks the answer', async () => {
    // The live case of 2026-11-21: 181 km from a real fire to the nearest open shelter.
    const calls: Call[] = [];
    const replies: HttpResponse[] = [
      { status: 400, ok: false, json: { error: { code: 2004, message: 'exceeds limits' } } },
      { status: 200, ok: true, json: SUCCESS_BODY },
    ];
    const http: HttpClient = {
      postJson(url, body, headers = {}) {
        calls.push({ url, body, headers });
        return Promise.resolve(replies[calls.length - 1] as HttpResponse);
      },
    };
    const fire = rectangle(-121.75, 36.2, -121.7, 36.25); // small: sent as it is on the first ask
    const r = await makeOrsRoutingAdapter(makeDeps(http, () => fire)).route({
      incidentId: INCIDENT,
      from: [8.68, 49.41],
      to: [8.69, 49.42],
    });
    expect(calls).toHaveLength(2);
    expect((calls[0]?.body as { options?: unknown }).options).toBeDefined();
    expect((calls[1]?.body as { options?: unknown }).options).toBeUndefined();
    expect(isOk(r) && r.value.avoidsHazard).toBe(true);
  });

  it('any other refusal is still a refusal — no second request', async () => {
    const { http, calls } = fakeHttp({
      status: 404,
      ok: false,
      json: { error: { code: 2010, message: 'no routable point' } },
    });
    const r = await makeOrsRoutingAdapter(
      makeDeps(http, () => rectangle(-121.75, 36.2, -121.7, 36.25)),
    ).route({ incidentId: INCIDENT, from: [-121.71, 36.25], to: [-119.77, 36.74] });
    expect(calls).toHaveLength(1);
    expect(isErr(r)).toBe(true);
  });
});

describe('routeClearOf — is a road route clear of the hazard footprint?', () => {
  const box: PolygonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
        [10, 10],
      ],
    ],
  };

  it('is clear when the whole path stays outside the rectangle', () => {
    expect(
      routeClearOf(
        [
          [0, 0],
          [5, 30],
          [30, 30],
        ],
        box,
      ),
    ).toBe(true);
  });

  it('is NOT clear when a segment crosses the rectangle although no vertex lies inside it', () => {
    // The case a vertex-only test would miss: two points on either side of the hazard.
    expect(
      routeClearOf(
        [
          [0, 15],
          [30, 15],
        ],
        box,
      ),
    ).toBe(false);
  });

  it('is NOT clear when the path starts inside, ends inside, or only touches an edge', () => {
    expect(
      routeClearOf(
        [
          [15, 15],
          [40, 40],
        ],
        box,
      ),
    ).toBe(false);
    expect(
      routeClearOf(
        [
          [40, 40],
          [15, 15],
        ],
        box,
      ),
    ).toBe(false);
    expect(
      routeClearOf(
        [
          [0, 10],
          [30, 10],
        ],
        box,
      ),
    ).toBe(false); // runs along the southern edge
  });

  it('a diagonal that passes just outside a corner is clear', () => {
    expect(
      routeClearOf(
        [
          [0, 9],
          [9, 0],
        ],
        box,
      ),
    ).toBe(true);
    expect(
      routeClearOf(
        [
          [21, 30],
          [30, 21],
        ],
        box,
      ),
    ).toBe(true);
  });

  it('checks every polygon of a MultiPolygon by its own rectangle, not one rectangle around them all', () => {
    const two: MultiPolygonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        box.coordinates,
        [
          [
            [40, 40],
            [50, 40],
            [50, 50],
            [40, 50],
            [40, 40],
          ],
        ],
      ],
    };
    expect(
      routeClearOf(
        [
          [25, 0],
          [35, 60],
        ],
        two,
      ),
    ).toBe(true); // between the two
    expect(
      routeClearOf(
        [
          [25, 0],
          [45, 45],
        ],
        two,
      ),
    ).toBe(false); // ends in the second
  });
});
