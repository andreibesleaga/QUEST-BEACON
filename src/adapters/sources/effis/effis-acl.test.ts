// BEACON — EFFIS/GWIS ACL tests (E4·Part-B). Pure/deterministic mapper (Art. XII): geometry.type→kind
// (Point→HOTSPOT, Polygon/MultiPolygon→PERIMETER), coordinate pass-through, UTC timestamp normalization
// (bare date / zone-less datetime / already-zoned), area_ha→intensity, skip-malformed at parse (never a
// silent drop reaching the mapper unfiltered), and a defensive PARSE when the mapper is handed a shape
// it still cannot place.
import { describe, it, expect } from 'vitest';
import type { MapContext } from '@/adapters/_shared/index.js';
import { effisMapper, parseEffisFeatures } from './effis-acl.js';
import type { EffisFeature } from './effis-acl.js';

const CTX: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-effis' };

const ACTIVE_FIRE: EffisFeature = {
  geometry: { type: 'Point', coordinates: [22.0, 37.5] },
  properties: { id: 1, firedate: '2026-07-04T13:20:00', country: 'GR' },
};

const BURNT_AREA_RO: EffisFeature = {
  geometry: {
    type: 'Polygon',
    coordinates: [[[25.55, 45.6], [25.65, 45.6], [25.65, 45.7], [25.55, 45.7], [25.55, 45.6]]],
  },
  properties: { id: 2, firedate: '2026-07-03', lastupdate: '2026-07-05T09:00:00Z', country: 'RO', area_ha: 812.4 },
};

const BURNT_AREA_MULTI: EffisFeature = {
  geometry: {
    type: 'MultiPolygon',
    coordinates: [[[[-8.05, 40.0], [-7.95, 40.0], [-7.95, 40.1], [-8.05, 40.1], [-8.05, 40.0]]]],
  },
  properties: { id: 3, firedate: '2026-07-02', country: 'PT', area_ha: 2350.8 },
};

describe('effisMapper.toCanonical', () => {
  it('maps a Point active-fire feature to a HOTSPOT with pass-through [lon,lat] geometry', () => {
    const hz = effisMapper.toCanonical(ACTIVE_FIRE, CTX);
    expect(hz.kind).toBe('HOTSPOT');
    expect(hz.geometry).toEqual({ type: 'Point', coordinates: [22.0, 37.5] });
    expect(hz.observedAt).toBe('2026-07-04T13:20:00Z');
    expect(String(hz.id)).toBe('effis:pt:1');
    expect(hz.sourceId).toBe('sid-effis');
  });

  it('maps a Polygon burnt-area feature to a PERIMETER, preferring lastupdate over firedate, with area_ha as intensity', () => {
    const hz = effisMapper.toCanonical(BURNT_AREA_RO, CTX);
    expect(hz.kind).toBe('PERIMETER');
    expect(hz.geometry.type).toBe('Polygon');
    expect(hz.observedAt).toBe('2026-07-05T09:00:00Z');
    expect(hz.intensity).toBe(812.4);
    expect(String(hz.id)).toBe('effis:poly:2');
  });

  it('maps a MultiPolygon burnt-area feature to a PERIMETER and normalizes a bare-date firedate to UTC midnight', () => {
    const hz = effisMapper.toCanonical(BURNT_AREA_MULTI, CTX);
    expect(hz.kind).toBe('PERIMETER');
    expect(hz.geometry.type).toBe('MultiPolygon');
    expect(hz.observedAt).toBe('2026-07-02T00:00:00Z');
    expect(String(hz.id)).toBe('effis:mpoly:3');
  });

  it('falls back to the fetch instant when both firedate and lastupdate are absent', () => {
    const noDate: EffisFeature = { geometry: { type: 'Point', coordinates: [22.0, 37.5] }, properties: { id: 9 } };
    expect(effisMapper.toCanonical(noDate, CTX).observedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('throws PARSE for an unsupported geometry.type (defensive — parse filters these first)', () => {
    const line: EffisFeature = { geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] }, properties: {} };
    expect(() => effisMapper.toCanonical(line, CTX)).toThrow(/out of scope/);
  });

  it('throws PARSE when a Point feature has invalid coordinates (defensive)', () => {
    const badPoint: EffisFeature = { geometry: { type: 'Point', coordinates: ['x', 'y'] }, properties: {} };
    expect(() => effisMapper.toCanonical(badPoint, CTX)).toThrow(/Point feature/);
  });

  it('throws PARSE when a Polygon feature has invalid coordinates (defensive)', () => {
    const badPoly: EffisFeature = { geometry: { type: 'Polygon', coordinates: [] }, properties: {} };
    expect(() => effisMapper.toCanonical(badPoly, CTX)).toThrow(/Polygon feature/);
  });
});

describe('parseEffisFeatures', () => {
  it('keeps only structurally sane Point/Polygon/MultiPolygon features', () => {
    const fc = JSON.stringify({ features: [ACTIVE_FIRE, BURNT_AREA_RO, BURNT_AREA_MULTI] });
    const rows = parseEffisFeatures(fc);
    expect(rows).toHaveLength(3);
  });

  it('skips (and does not throw for) malformed features: unsupported geometry, missing geometry, and empty/short polygon rings', () => {
    const malformed: EffisFeature[] = [
      { geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] }, properties: {} }, // out-of-scope type
      { geometry: null, properties: { id: 'no-geom' } }, // missing geometry
      { geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4]]] }, properties: {} }, // ring too short (<4)
      { geometry: { type: 'Point', coordinates: ['bad'] }, properties: {} }, // non-numeric point coords
    ];
    const fc = JSON.stringify({ features: [ACTIVE_FIRE, ...malformed, BURNT_AREA_RO] });
    const rows = parseEffisFeatures(fc);
    // Only the 2 well-formed features survive; all 4 malformed ones are skipped+counted via the diff.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => effisMapper.toCanonical(r, CTX) !== undefined)).toBe(true);
  });

  it('returns nothing when there are no features', () => {
    expect(parseEffisFeatures(JSON.stringify({}))).toEqual([]);
  });
});
