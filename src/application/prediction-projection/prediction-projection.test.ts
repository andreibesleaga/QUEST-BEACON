import { describe, it, expect } from 'vitest';
import type { SpatialPort } from '@/ports/index.js';
import type { Geometry, PolygonGeometry } from '@/domain/value-objects/geo.js';
import { ok, err, isOk, isErr } from '@/domain/shared/result.js';
import { InvariantViolation } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, PredictionId } from '@/domain/value-objects/ids.js';
import { makeFloodZone, type FloodZone } from '@/domain/flood-zone.js';
import { projectFireCone, projectFloodInundation, projectFloodZoneImpact } from './prediction-projection.js';
import type { FireConeInput, FloodInundationInput, FloodZoneImpactInput } from './prediction-projection.js';

const INC = asId<IncidentId>('inc-1');
const PID = asId<PredictionId>('p-1');

function coneInput(over: Partial<FireConeInput> = {}): FireConeInput {
  return {
    id: PID,
    incidentId: INC,
    origin: [10, 45],
    windDirDeg: 90, // blowing east
    windSpeedMps: 5,
    nowMs: 0,
    horizonMs: 3_600_000,
    ...over,
  };
}

describe('projectFireCone', () => {
  it('projects a labeled first-order cone along the wind bearing', () => {
    const p = projectFireCone(coneInput({ sourceId: asId('s1') }));
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(p.kind).toBe('FIRE_CONE');
    expect(p.method).toContain('first-order');
    expect(p.geom?.type).toBe('Polygon');
    // wind blows east → nose longitude greater than origin
    const nose = (p.geom as unknown as { coordinates: number[][][] }).coordinates[0]![2]!;
    expect(nose[0]!).toBeGreaterThan(10);
    expect(p.uncertainty).toBeGreaterThan(0);
    expect(p.sourceId).toBe('s1');
  });

  it('length scales with wind speed × horizon', () => {
    const slow = projectFireCone(coneInput({ windSpeedMps: 2 }));
    const fast = projectFireCone(coneInput({ windSpeedMps: 8 }));
    const lenSlow = (slow?.inputs as { lengthM: number }).lengthM;
    const lenFast = (fast?.inputs as { lengthM: number }).lengthM;
    expect(lenFast).toBeCloseTo(lenSlow * 4, 6);
  });

  it('returns null when there are no hotspots (no origin)', () => {
    const noOrigin: FireConeInput = { ...coneInput() };
    delete (noOrigin as { origin?: unknown }).origin;
    expect(projectFireCone(noOrigin)).toBeNull();
  });

  it('returns null for zero wind or zero horizon', () => {
    expect(projectFireCone(coneInput({ windSpeedMps: 0 }))).toBeNull();
    expect(projectFireCone(coneInput({ horizonMs: 0 }))).toBeNull();
  });

  it('clamps uncertainty into [0,1] for a very long horizon', () => {
    const p = projectFireCone(coneInput({ horizonMs: 100 * 3_600_000 }));
    expect(p?.uncertainty).toBe(1);
  });
});

const REACH: Geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
const NFHL: Geometry = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]],
};

function floodInput(over: Partial<FloodInundationInput> = {}): FloodInundationInput {
  return { id: PID, incidentId: INC, reach: REACH, nfhl: NFHL, floods: true, ...over };
}

function fakeSpatial(intersect: SpatialPort['intersect']): SpatialPort {
  return { pointInPolygon: () => ok(false), buffer: () => ok(NFHL as never), intersect };
}

describe('projectFloodInundation', () => {
  it('projects when the crest floods and the reach intersects NFHL', () => {
    const res = projectFloodInundation(
      floodInput({ crestForecast: 12.4, crestTime: '2026-07-07T06:00:00Z', sourceId: asId('s2') }),
      fakeSpatial(() => ok(true)),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res) || res.value === null) return;
    expect(res.value.kind).toBe('FLOOD_INUNDATION');
    expect(res.value.method).toContain('NFHL');
    expect((res.value.inputs as { caveat: string }).caveat).toContain('NFHL');
    expect(res.value.horizon).toBe('2026-07-07T06:00:00Z');
    expect(res.value.sourceId).toBe('s2');
  });

  it('returns null when the crest does not indicate flooding', () => {
    const res = projectFloodInundation(floodInput({ floods: false }), fakeSpatial(() => ok(true)));
    expect(isOk(res) && res.value).toBeNull();
  });

  it('returns null when the reach does not intersect the NFHL layer', () => {
    const res = projectFloodInundation(floodInput(), fakeSpatial(() => ok(false)));
    expect(isOk(res) && res.value).toBeNull();
  });

  it('propagates a SpatialPort intersect error', () => {
    const res = projectFloodInundation(floodInput(), fakeSpatial(() => err(new InvariantViolation('x'))));
    expect(isErr(res)).toBe(true);
  });

  it('projects with the optional fields omitted (no crestForecast/crestTime/sourceId)', () => {
    // Covers the "absent" arms of the optional spreads: floods + intersect succeed, yet none of
    // crestForecast / crestTime / sourceId are supplied.
    const res = projectFloodInundation(floodInput(), fakeSpatial(() => ok(true)));
    expect(isOk(res)).toBe(true);
    if (!isOk(res) || res.value === null) return;
    expect(res.value.kind).toBe('FLOOD_INUNDATION');
    expect((res.value.inputs as { crestForecast?: number }).crestForecast).toBeUndefined();
    expect(res.value.horizon).toBeUndefined();
    expect(res.value.sourceId).toBeUndefined();
  });
});

// ── projectFloodZoneImpact — NFHL flood-zones ∩ crest-driven extent (makes flagship-3 real) ────────────

const zone = (id: string, code: string, coords: PolygonGeometry['coordinates']): FloodZone =>
  makeFloodZone({ id, zone: code, geom: { type: 'Polygon', coordinates: coords } });

// A zone straddling the reach extent (partly inside), and one far away (fully outside any plausible extent).
const NEAR_ZONE = zone('z-ae', 'AE', [[[0.5, 0.5], [2, 0.5], [2, 2], [0.5, 2], [0.5, 0.5]]]);
const FAR_ZONE = zone('z-x', 'X', [[[50, 50], [51, 50], [51, 51], [50, 51], [50, 50]]]);
const REACH2: Geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };

function impactInput(over: Partial<FloodZoneImpactInput> = {}): FloodZoneImpactInput {
  return { id: PID, incidentId: INC, floodZones: [NEAR_ZONE], reach: REACH2, crestForecast: 4.2, floods: true, ...over };
}

describe('projectFloodZoneImpact', () => {
  it('intersects NFHL zones with the crest extent → a labelled MultiPolygon impact geometry', () => {
    const p = projectFloodZoneImpact(
      impactInput({ floodCategory: 'MODERATE', crestTime: '2026-07-07T06:00:00Z', sourceId: asId('nfhl') }),
    );
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(p.kind).toBe('FLOOD_INUNDATION');
    expect(p.geom?.type).toBe('MultiPolygon');
    expect(p.method).toContain('NFHL flood-zones ∩ crest-driven extent');
    const inputs = p.inputs as { crestForecast: number; floodCategory: string; zonesAssessed: number; zonesImpacted: number; impactedZones: string; caveat: string };
    expect(inputs.crestForecast).toBe(4.2);
    expect(inputs.floodCategory).toBe('MODERATE');
    expect(inputs.zonesAssessed).toBe(1);
    expect(inputs.zonesImpacted).toBe(1);
    expect(inputs.impactedZones).toBe('AE');
    expect(inputs.caveat).toContain('NFHL');
    expect(p.uncertainty).toBe(0.5);
    expect(p.horizon).toBe('2026-07-07T06:00:00Z');
    expect(p.sourceId).toBe('nfhl');
  });

  it('omits floodCategory/horizon/sourceId when not supplied', () => {
    const p = projectFloodZoneImpact(impactInput());
    expect(p).not.toBeNull();
    if (p === null) return;
    expect((p.inputs as { floodCategory?: string }).floodCategory).toBeUndefined();
    expect(p.horizon).toBeUndefined();
    expect(p.sourceId).toBeUndefined();
  });

  it('returns null when the crest does not indicate flooding', () => {
    expect(projectFloodZoneImpact(impactInput({ floods: false }))).toBeNull();
  });

  it('returns null when there are no flood zones', () => {
    expect(projectFloodZoneImpact(impactInput({ floodZones: [] }))).toBeNull();
  });

  it('returns null when no zone intersects the crest extent (fallback signal to the caller)', () => {
    expect(projectFloodZoneImpact(impactInput({ floodZones: [FAR_ZONE] }))).toBeNull();
  });

  it('a larger crest grows the extent so a marginally-distant zone becomes impacted', () => {
    // Zone whose nearest edge sits ~0.05° beyond the reach; base margin (0.01 + crest·0.002) must reach it.
    const edgeZone = zone('z-edge', 'A', [[[1.04, 1.04], [1.2, 1.04], [1.2, 1.2], [1.04, 1.2], [1.04, 1.04]]]);
    const low = projectFloodZoneImpact(impactInput({ floodZones: [edgeZone], crestForecast: 1 }));
    const high = projectFloodZoneImpact(impactInput({ floodZones: [edgeZone], crestForecast: 30 }));
    expect(low).toBeNull(); // margin 0.012 — does not reach 1.04
    expect(high).not.toBeNull(); // margin 0.07 — reaches into the zone
  });

  it('rejects sliver intersections below the min-area floor (custom config)', () => {
    const p = projectFloodZoneImpact(impactInput(), {
      baseMarginDeg: 0.01,
      marginPerCrestUnit: 0.002,
      baseUncertainty: 0.5,
      minAreaDeg2: 1e9, // impossibly large floor → every real overlap is rejected
    });
    expect(p).toBeNull();
  });

  it('skips a malformed zone with an empty ring set (defensive), yielding null when it is the only zone', () => {
    const malformed = { id: 'z-bad', zone: 'D', geom: { type: 'Polygon', coordinates: [] } } as unknown as FloodZone;
    expect(projectFloodZoneImpact(impactInput({ floodZones: [malformed] }))).toBeNull();
  });

  it('deduplicates + sorts impacted zone codes across multiple zones', () => {
    const z2 = zone('z-ae2', 'AE', [[[0.6, 0.6], [1.9, 0.6], [1.9, 1.9], [0.6, 1.9], [0.6, 0.6]]]);
    const z3 = zone('z-a', 'A', [[[0.4, 0.4], [1.5, 0.4], [1.5, 1.5], [0.4, 1.5], [0.4, 0.4]]]);
    const p = projectFloodZoneImpact(impactInput({ floodZones: [NEAR_ZONE, z2, z3] }));
    if (p === null) throw new Error('expected impact');
    expect((p.inputs as { impactedZones: string }).impactedZones).toBe('A|AE'); // sorted, unique
    expect((p.inputs as { zonesImpacted: number }).zonesImpacted).toBe(3);
  });
});
