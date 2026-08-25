// BEACON — NFHL ACL tests. Pure/deterministic parse+mapper (Art. XII): Polygon rows map straight through,
// a MultiPolygon feature splits into one row (and one mapped FloodZone) per polygon part, and malformed
// features (missing geometry/zone, unsupported geometry type, bad rings) are skipped and counted — never
// silently dropped.
import { describe, it, expect } from 'vitest';
import { nfhlMapper, parseNfhlZones } from './nfhl-acl.js';
import type { NfhlZoneRow } from './nfhl-acl.js';

const POLYGON_FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { OBJECTID: 100234, FLD_ZONE: 'AE' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-90.1, 29.95],
            [-90.05, 29.95],
            [-90.05, 30.0],
            [-90.1, 30.0],
            [-90.1, 29.95],
          ],
        ],
      },
    },
  ],
});

const MULTIPOLYGON_FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { OBJECTID: 100236, FLD_ZONE: 'VE' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-90.2, 29.8],
              [-90.17, 29.8],
              [-90.17, 29.83],
              [-90.2, 29.83],
              [-90.2, 29.8],
            ],
          ],
          [
            [
              [-90.15, 29.85],
              [-90.12, 29.85],
              [-90.12, 29.88],
              [-90.15, 29.88],
              [-90.15, 29.85],
            ],
          ],
        ],
      },
    },
  ],
});

describe('parseNfhlZones', () => {
  it('maps a Polygon feature to a single row (part 0)', () => {
    const { rows, skipped } = parseNfhlZones(POLYGON_FC);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(0);
    expect(rows[0]).toMatchObject({ zone: 'AE', objectId: '100234', part: 0 });
    expect(rows[0]?.polygon.type).toBe('Polygon');
  });

  it('splits a MultiPolygon feature into one row per polygon part', () => {
    const { rows, skipped } = parseNfhlZones(MULTIPOLYGON_FC);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(rows.map((r) => r.part)).toEqual([0, 1]);
    expect(rows.every((r) => r.zone === 'VE' && r.objectId === '100236')).toBe(true);
    expect(rows[0]?.polygon.coordinates).not.toEqual(rows[1]?.polygon.coordinates);
  });

  it('skips and counts a feature with a blank FLD_ZONE', () => {
    const fc = JSON.stringify({
      features: [{ properties: { OBJECTID: 1, FLD_ZONE: '  ' }, geometry: { type: 'Polygon', coordinates: [[[-90, 29], [-89, 29], [-89, 30], [-90, 29]]] } }],
    });
    const { rows, skipped } = parseNfhlZones(fc);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('skips and counts a feature with missing geometry', () => {
    const fc = JSON.stringify({ features: [{ properties: { OBJECTID: 1, FLD_ZONE: 'AE' } }] });
    const { rows, skipped } = parseNfhlZones(fc);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('skips and counts a feature with an unsupported geometry type', () => {
    const fc = JSON.stringify({
      features: [{ properties: { OBJECTID: 1, FLD_ZONE: 'AE' }, geometry: { type: 'Point', coordinates: [-90, 29] } }],
    });
    const { rows, skipped } = parseNfhlZones(fc);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('skips and counts a Polygon feature with an invalid ring (too few positions)', () => {
    const fc = JSON.stringify({
      features: [
        { properties: { OBJECTID: 1, FLD_ZONE: 'AE' }, geometry: { type: 'Polygon', coordinates: [[[-90, 29], [-89, 29]]] } },
      ],
    });
    const { rows, skipped } = parseNfhlZones(fc);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('counts malformed features alongside well-formed ones in the same fetch (mixed batch)', () => {
    const fc = JSON.stringify({
      features: [
        { properties: { OBJECTID: 1, FLD_ZONE: 'AE' }, geometry: { type: 'Polygon', coordinates: [[[-90, 29], [-89, 29], [-89, 30], [-90, 29]]] } },
        { properties: { OBJECTID: 2, FLD_ZONE: 'X' } }, // missing geometry
        { properties: { FLD_ZONE: 'AE' }, geometry: { type: 'LineString', coordinates: [[-90, 29], [-89, 30]] } }, // wrong type
      ],
    });
    const { rows, skipped } = parseNfhlZones(fc);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('returns nothing when there are no features', () => {
    expect(parseNfhlZones(JSON.stringify({}))).toEqual({ rows: [], skipped: 0 });
  });
});

describe('nfhlMapper.toCanonical', () => {
  const ROW: NfhlZoneRow = {
    zone: 'AE',
    objectId: '100234',
    part: 0,
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [-90.1, 29.95],
          [-90.05, 29.95],
          [-90.05, 30.0],
          [-90.1, 29.95],
        ],
      ],
    },
  };

  it('maps a row to a FloodZone with a stable id derived from objectId + part', () => {
    const fz = nfhlMapper.toCanonical(ROW, { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-nfhl' });
    expect(fz.id).toBe('nfhl:100234:0');
    expect(fz.zone).toBe('AE');
    expect(fz.geom).toEqual(ROW.polygon);
  });

  it('gives split MultiPolygon parts distinct ids', () => {
    const { rows } = parseNfhlZones(MULTIPOLYGON_FC);
    const ctx = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-nfhl' };
    const ids = rows.map((r) => nfhlMapper.toCanonical(r, ctx).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['nfhl:100236:0', 'nfhl:100236:1']);
  });
});
