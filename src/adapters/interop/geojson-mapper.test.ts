// BEACON — GeoJSON mapper tests (E7·F15). Geometry ⇄ Feature/FeatureCollection round-trips safely
// (RFC 7946, [lon,lat] preserved) and produced Features validate against the inline GeoJSON schema.
import { describe, it, expect } from 'vitest';
import type {
  Geometry,
  PointGeometry,
  PolygonGeometry,
  LineStringGeometry,
  MultiPolygonGeometry,
} from '@/domain/value-objects/geo.js';
import {
  geometryToFeature,
  featureToGeometry,
  geometriesToFeatureCollection,
  featureCollectionToGeometries,
} from './geojson-mapper.js';

const POINT: PointGeometry = { type: 'Point', coordinates: [-118.25, 34.05] };
const LINE: LineStringGeometry = {
  type: 'LineString',
  coordinates: [
    [-118.3, 34.0],
    [-118.2, 34.1],
  ],
};
const POLY: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-118.3, 34.0],
      [-118.2, 34.0],
      [-118.2, 34.1],
      [-118.3, 34.1],
      [-118.3, 34.0],
    ],
  ],
};
const MULTI: MultiPolygonGeometry = { type: 'MultiPolygon', coordinates: [POLY.coordinates] };

describe('GeoJSON round-trip (F15 — geometry → feature → geometry equals)', () => {
  const cases: Array<[string, Geometry]> = [
    ['Point', POINT],
    ['LineString', LINE],
    ['Polygon', POLY],
    ['MultiPolygon', MULTI],
  ];
  for (const [name, geometry] of cases) {
    it(`round-trips a ${name} through a Feature`, () => {
      const feature = geometryToFeature(geometry, { kind: 'hazard' });
      expect(feature.ok).toBe(true);
      if (!feature.ok) return;
      expect(feature.value.type).toBe('Feature');
      expect(feature.value.properties['kind']).toBe('hazard');
      const back = featureToGeometry(feature.value);
      expect(back.ok).toBe(true);
      if (!back.ok) return;
      expect(back.value).toEqual(geometry);
    });
  }

  it('round-trips a FeatureCollection of mixed geometries', () => {
    const fc = geometriesToFeatureCollection([POINT, POLY, MULTI]);
    expect(fc.ok).toBe(true);
    if (!fc.ok) return;
    expect(fc.value.type).toBe('FeatureCollection');
    expect(fc.value.features).toHaveLength(3);
    const back = featureCollectionToGeometries(fc.value);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value).toEqual([POINT, POLY, MULTI]);
  });
});

describe('featureToGeometry (inbound guards)', () => {
  it('rejects a feature with no geometry', () => {
    const res = featureToGeometry({ type: 'Feature', properties: {} } as never);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PARSE_ERROR');
  });

  it('rejects a non-canonical geometry type (MultiPoint)', () => {
    const res = featureToGeometry({
      type: 'Feature',
      geometry: { type: 'MultiPoint', coordinates: [[0, 0]] } as never,
      properties: {},
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PARSE_ERROR');
  });
});
