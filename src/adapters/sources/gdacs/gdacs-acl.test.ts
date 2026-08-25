// BEACON — GDACS ACL tests (E4·T-171). Pure/deterministic mapper (Art. XII): eventtype→kind, [lon,lat]
// order, UTC timestamp normalization, in-scope filtering (WF/FL kept, EQ dropped at parse), and PARSE on
// a feature the mapper cannot place / is out of scope.
import { describe, it, expect } from 'vitest';
import type { MapContext } from '@/adapters/_shared/index.js';
import { gdacsMapper, parseGdacsEvents } from './gdacs-acl.js';
import type { GdacsFeature } from './gdacs-acl.js';

const CTX: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-gdacs' };

const WF: GdacsFeature = {
  geometry: { type: 'Point', coordinates: [-121.5, 39.8] },
  properties: { eventtype: 'WF', eventid: 1234567, episodeid: 1, fromdate: '2026-07-05T18:00:00' },
};
const FL: GdacsFeature = {
  geometry: { type: 'Point', coordinates: [26.1, 44.4] },
  properties: { eventtype: 'FL', eventid: 7654321, episodeid: 2, fromdate: '2026-07-05T06:00:00Z' },
};

describe('gdacsMapper.toCanonical', () => {
  it('maps a wildfire event to a HOTSPOT with [lon,lat] geometry and UTC-normalized observedAt', () => {
    const hz = gdacsMapper.toCanonical(WF, CTX);
    expect(hz.kind).toBe('HOTSPOT');
    expect(hz.geometry).toEqual({ type: 'Point', coordinates: [-121.5, 39.8] });
    expect(hz.observedAt).toBe('2026-07-05T18:00:00Z');
    expect(String(hz.id)).toContain('gdacs:WF:1234567');
  });

  it('maps a flood event to a FLOOD_REACH and keeps an already-zoned timestamp', () => {
    const hz = gdacsMapper.toCanonical(FL, CTX);
    expect(hz.kind).toBe('FLOOD_REACH');
    expect(hz.observedAt).toBe('2026-07-05T06:00:00Z');
  });

  it('maps a Polygon-footprint event via its bbox centre (live GDACS serves footprints for some events)', () => {
    // Regression: one Polygon row used to throw and fail the WHOLE live fetch → silent MOCK degradation.
    const poly: GdacsFeature = {
      bbox: [18.44851, -7.65454939766256, 18.5682993976626, -7.53800060233744],
      geometry: { type: 'Polygon', coordinates: [[[18.53, -7.65], [18.54, -7.64], [18.52, -7.63], [18.53, -7.65]]] },
      properties: { eventtype: 'FL', eventid: 1103888, episodeid: 46, fromdate: '2026-07-05T18:00:00' },
    };
    const hz = gdacsMapper.toCanonical(poly, CTX);
    expect(hz.kind).toBe('FLOOD_REACH');
    expect(hz.geometry).toEqual({
      type: 'Point',
      coordinates: [(18.44851 + 18.5682993976626) / 2, (-7.65454939766256 + -7.53800060233744) / 2],
    });
  });

  it('throws PARSE when a footprint event has no finite bbox either', () => {
    const bad: GdacsFeature = {
      geometry: { type: 'MultiPolygon', coordinates: [[[[1, 2]]]] },
      properties: { eventtype: 'WF' },
    };
    expect(() => gdacsMapper.toCanonical(bad, CTX)).toThrow(/neither a Point geometry nor a finite bbox/);
  });

  it('falls back to the fetch instant when fromdate is absent', () => {
    const noDate: GdacsFeature = { geometry: { type: 'Point', coordinates: [-121.5, 39.8] }, properties: { eventtype: 'WF' } };
    expect(gdacsMapper.toCanonical(noDate, CTX).observedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('throws PARSE for an out-of-scope eventtype (defensive — parse filters these first)', () => {
    const eq: GdacsFeature = { geometry: { type: 'Point', coordinates: [-121.5, 39.8] }, properties: { eventtype: 'EQ' } };
    expect(() => gdacsMapper.toCanonical(eq, CTX)).toThrow(/out of scope/);
  });

  it('throws PARSE when the geometry is missing/invalid', () => {
    const noGeom: GdacsFeature = { properties: { eventtype: 'WF', fromdate: '2026-07-05T18:00:00' } };
    expect(() => gdacsMapper.toCanonical(noGeom, CTX)).toThrow(/geometry/);
  });
});

describe('parseGdacsEvents', () => {
  it('keeps only in-scope wildfire + flood events and drops the rest', () => {
    const fc = JSON.stringify({ features: [WF, FL, { geometry: { type: 'Point', coordinates: [-121.5, 39.8] }, properties: { eventtype: 'EQ' } }] });
    const rows = parseGdacsEvents(fc);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.properties?.eventtype)).toEqual(['WF', 'FL']);
  });

  it('returns nothing when there are no features', () => {
    expect(parseGdacsEvents(JSON.stringify({}))).toEqual([]);
  });
});
