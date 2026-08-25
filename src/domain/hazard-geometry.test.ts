import { describe, it, expect } from 'vitest';
import {
  makeHazardGeometry,
  HAZARD_KINDS,
  EXPOSURE_BEARING_BY_KIND,
  isExposureBearingKind,
  exposureBearingHazards,
} from './hazard-geometry.js';
import type { HazardKind } from './hazard-geometry.js';
import { InvariantViolation } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { HazardGeometryId, IncidentId, SourceId } from './value-objects/ids.js';
import type { Geometry } from './value-objects/geo.js';

const id = asId<HazardGeometryId>('33333333-3333-3333-3333-333333333333');
const incidentId = asId<IncidentId>('22222222-2222-2222-2222-222222222222');
const sourceId = asId<SourceId>('44444444-4444-4444-4444-444444444444');
const geometry: Geometry = { type: 'Point', coordinates: [-122, 38] };

const base = { id, incidentId, sourceId, kind: 'HOTSPOT' as const, geometry, observedAt: '2026-07-01T00:00:00Z' };

describe('makeHazardGeometry', () => {
  it('builds a valid hazard geometry', () => {
    const h = makeHazardGeometry(base);
    expect(h.kind).toBe('HOTSPOT');
    expect(h.observedAt).toBe('2026-07-01T00:00:00Z');
  });

  it('accepts every schema kind', () => {
    for (const kind of HAZARD_KINDS) {
      expect(makeHazardGeometry({ ...base, kind }).kind).toBe(kind);
    }
  });

  it('carries optional intensity only when provided', () => {
    expect(makeHazardGeometry(base).intensity).toBeUndefined();
    expect(makeHazardGeometry({ ...base, intensity: 0.8 }).intensity).toBe(0.8);
  });

  it('rejects a kind outside the enum', () => {
    // @ts-expect-error invalid enum
    expect(() => makeHazardGeometry({ ...base, kind: 'SMOKE' })).toThrow(InvariantViolation);
  });

  it('rejects a missing sourceId (provenance required)', () => {
    expect(() => makeHazardGeometry({ ...base, sourceId: asId<SourceId>('') })).toThrow(InvariantViolation);
  });

  it('rejects an invalid observedAt', () => {
    expect(() => makeHazardGeometry({ ...base, observedAt: 'not-a-date' })).toThrow(InvariantViolation);
  });

  it('rejects a malformed geometry', () => {
    expect(() =>
      makeHazardGeometry({ ...base, geometry: { type: 'Circle' } as unknown as Geometry }),
    ).toThrow(InvariantViolation);
  });
});

// ── Storm family (ADR-032, FR-STORM-1 / FU-9) ────────────────────────────────────────────────────

const LINE: Geometry = { type: 'LineString', coordinates: [[121, 14], [120.5, 14.4], [120, 15]] };
const POLY: Geometry = {
  type: 'Polygon',
  coordinates: [[[120, 14], [121, 14], [121, 15], [120, 15], [120, 14]]],
};
const MULTI: Geometry = { type: 'MultiPolygon', coordinates: [[[[120, 14], [121, 14], [121, 15], [120, 14]]]] };

describe('storm hazard kinds (ADR-032)', () => {
  it('adds TRACK, CONE and STORM_SURGE without dropping any existing kind', () => {
    expect(HAZARD_KINDS).toEqual([
      'HOTSPOT',
      'PERIMETER',
      'FLOOD_REACH',
      'SPREAD_CONE',
      'TRACK',
      'CONE',
      'STORM_SURGE',
    ]);
  });

  it('keeps SPREAD_CONE distinct from the cyclone CONE (F-19 — they are different products)', () => {
    expect(HAZARD_KINDS).toContain('SPREAD_CONE');
    expect(HAZARD_KINDS).toContain('CONE');
    expect(new Set(HAZARD_KINDS).size).toBe(HAZARD_KINDS.length);
  });

  it('accepts a TRACK as a LineString', () => {
    expect(makeHazardGeometry({ ...base, kind: 'TRACK', geometry: LINE }).geometry.type).toBe('LineString');
  });

  it('accepts a CONE and a STORM_SURGE as Polygon or MultiPolygon', () => {
    expect(makeHazardGeometry({ ...base, kind: 'CONE', geometry: POLY }).kind).toBe('CONE');
    expect(makeHazardGeometry({ ...base, kind: 'STORM_SURGE', geometry: POLY }).kind).toBe('STORM_SURGE');
    expect(makeHazardGeometry({ ...base, kind: 'STORM_SURGE', geometry: MULTI }).geometry.type).toBe('MultiPolygon');
  });

  it('carries intensity (e.g. a category proxy) on a storm kind when supplied, else leaves it absent', () => {
    expect(makeHazardGeometry({ ...base, kind: 'CONE', geometry: POLY, intensity: 4 }).intensity).toBe(4);
    expect(makeHazardGeometry({ ...base, kind: 'CONE', geometry: POLY }).intensity).toBeUndefined();
  });

  it('still requires provenance on an ingested agency product (Art. XI)', () => {
    expect(() =>
      makeHazardGeometry({ ...base, kind: 'CONE', geometry: POLY, sourceId: asId<SourceId>('') }),
    ).toThrow(InvariantViolation);
  });
});

describe('exposure-bearing hazard kinds (ADR-032 §3)', () => {
  it('decides every kind in HAZARD_KINDS (no silent gap)', () => {
    for (const kind of HAZARD_KINDS) {
      expect(typeof EXPOSURE_BEARING_BY_KIND[kind]).toBe('boolean');
    }
    expect(Object.keys(EXPOSURE_BEARING_BY_KIND).sort()).toEqual([...HAZARD_KINDS].sort());
  });

  it('treats STORM_SURGE as an impact footprint, exactly like FLOOD_REACH (FEV-6)', () => {
    expect(isExposureBearingKind('STORM_SURGE')).toBe(true);
    expect(isExposureBearingKind('STORM_SURGE')).toBe(isExposureBearingKind('FLOOD_REACH'));
  });

  it('excludes TRACK and CONE — advisory geometry is never an impact footprint (Art. XII)', () => {
    expect(isExposureBearingKind('TRACK')).toBe(false);
    expect(isExposureBearingKind('CONE')).toBe(false);
  });

  it('filters a mixed hazard set down to the impact-bearing rows only', () => {
    const of = (kind: HazardKind, geometry: Geometry) =>
      makeHazardGeometry({ ...base, kind, geometry, id: asId<HazardGeometryId>(`hz-${kind}`) });
    const mixed = [
      of('TRACK', LINE),
      of('CONE', POLY),
      of('STORM_SURGE', POLY),
      of('PERIMETER', POLY),
    ];
    expect(exposureBearingHazards(mixed).map((h) => h.kind)).toEqual(['STORM_SURGE', 'PERIMETER']);
  });

  it('is identity on a hazard set that carries no advisory geometry', () => {
    const only = [makeHazardGeometry({ ...base, kind: 'PERIMETER', geometry: POLY })];
    expect(exposureBearingHazards(only)).toEqual(only);
    expect(exposureBearingHazards([])).toEqual([]);
  });
});
