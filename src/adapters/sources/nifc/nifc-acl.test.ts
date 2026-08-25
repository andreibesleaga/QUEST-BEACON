// BEACON — NIFC ACL tests (E4·T-17x; F1/adapter-contract §4). The recorded WFIGS GeoJSON round-trips to
// valid HazardGeometry (PERIMETER) entities, keeping geometry byte-for-byte (no simplification); a
// malformed feature is skipped+counted (never silently dropped, never aborts the batch); poly_DateCurrent
// (epoch millis) maps to a valid ISO instant; a directly-mapped malformed shape raises a defensive PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { nifcMapper, parseNifcFeatures, toIsoUtc } from './nifc-acl.js';
import type { NifcFeature } from './nifc-acl.js';

const geojson = readFileSync(
  fileURLToPath(new URL('./__fixtures__/perimeters.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-15T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseNifcFeatures', () => {
  it('parses the recorded WFIGS FeatureCollection into raw features with skipped=0', () => {
    const { features, skipped } = parseNifcFeatures(geojson);
    expect(features).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(features[0]?.properties?.poly_IncidentName).toBe('ROCK');
    expect(features[1]?.geometry?.type).toBe('MultiPolygon');
  });

  it('returns skipped=0 and no features for an empty FeatureCollection', () => {
    expect(parseNifcFeatures(JSON.stringify({ features: [] }))).toEqual({ features: [], skipped: 0 });
  });

  it('returns skipped=0 features:[] when there is no features array at all', () => {
    expect(parseNifcFeatures(JSON.stringify({}))).toEqual({ features: [], skipped: 0 });
  });

  it('skips+counts a feature with no geometry', () => {
    const fc = JSON.stringify({
      features: [{ type: 'Feature', geometry: null, properties: { poly_IncidentName: 'Ghost' } }],
    });
    const { features, skipped } = parseNifcFeatures(fc);
    expect(features).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('skips+counts a feature with an out-of-scope geometry type (e.g. Point)', () => {
    const fc = JSON.stringify({
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-121, 39] }, properties: {} }],
    });
    expect(parseNifcFeatures(fc)).toEqual({ features: [], skipped: 1 });
  });

  it('skips+counts a Polygon with a degenerate ring (<4 vertices)', () => {
    const fc = JSON.stringify({
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-121, 39], [-121.1, 39]]] }, properties: {} }],
    });
    expect(parseNifcFeatures(fc)).toEqual({ features: [], skipped: 1 });
  });

  it('keeps well-formed features and skips malformed ones in the same batch, counting only the bad one', () => {
    const good: NifcFeature = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-121, 39], [-121.1, 39], [-121.1, 39.1], [-121, 39]]] },
      properties: { poly_IncidentName: 'Good Fire', poly_DateCurrent: 1783000000000 },
    };
    const bad: NifcFeature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} };
    const { features, skipped } = parseNifcFeatures(JSON.stringify({ features: [good, bad] }));
    expect(features).toHaveLength(1);
    expect(features[0]?.properties?.poly_IncidentName).toBe('Good Fire');
    expect(skipped).toBe(1);
  });
});

describe('nifcMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture feature to a valid PERIMETER HazardGeometry with unsimplified geometry', () => {
    const { features } = parseNifcFeatures(geojson);
    const geoms = features.map((f) => nifcMapper.toCanonical(f, ctx));
    expect(geoms).toHaveLength(2);
    for (const g of geoms) {
      expect(g.kind).toBe('PERIMETER');
      expect(['Polygon', 'MultiPolygon']).toContain(g.geometry.type);
      expect(g.sourceId).toBe('sid-1');
      expect(Number.isNaN(Date.parse(g.observedAt))).toBe(false);
    }
    const rock = geoms[0];
    expect(rock?.geometry.type).toBe('Polygon');
    expect(rock?.observedAt).toBe('2026-07-14T16:23:19.655Z'); // poly_DateCurrent=1784046199655
    if (rock?.geometry.type === 'Polygon') {
      // Geometry preserved exactly as upstream serves it (no vertex-count reduction) — honesty.
      expect(rock.geometry.coordinates[0]).toHaveLength(6);
      expect(rock.geometry.coordinates[0]?.[0]).toEqual([-121.011392983693, 39.7285733899928]);
    }
    const milePost = geoms[1];
    expect(milePost?.geometry.type).toBe('MultiPolygon');
    expect(milePost?.observedAt).toBe('2026-07-12T00:51:12.000Z'); // poly_DateCurrent=1783817472000
  });

  it('falls back to the fetch instant when poly_DateCurrent is absent', () => {
    const noDate: NifcFeature = {
      geometry: { type: 'Polygon', coordinates: [[[-121, 39], [-121.1, 39], [-121.1, 39.1], [-121, 39]]] },
      properties: { poly_IncidentName: 'Undated Fire' },
    };
    expect(nifcMapper.toCanonical(noDate, ctx).observedAt).toBe('2026-07-15T22:00:00Z');
  });

  it('builds a stable, deterministic id from incident name + currency date', () => {
    const feature: NifcFeature = {
      geometry: { type: 'Polygon', coordinates: [[[-121, 39], [-121.1, 39], [-121.1, 39.1], [-121, 39]]] },
      properties: { poly_IncidentName: 'Rock', poly_DateCurrent: 1783000000000 },
    };
    const a = nifcMapper.toCanonical(feature, ctx);
    const b = nifcMapper.toCanonical(feature, ctx);
    expect(String(a.id)).toBe(String(b.id));
    expect(String(a.id)).toContain('nifc:Rock:1783000000000');
  });

  it('raises a defensive typed PARSE when called directly with a missing/invalid geometry', () => {
    try {
      nifcMapper.toCanonical({ properties: { poly_IncidentName: 'Bad' } }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a defensive typed PARSE for an out-of-scope geometry type', () => {
    try {
      nifcMapper.toCanonical({ geometry: { type: 'Point', coordinates: [-121, 39] }, properties: {} }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});

describe('toIsoUtc', () => {
  it('converts epoch millis to an ISO-8601 UTC instant', () => {
    expect(toIsoUtc(1784046199655, 'fallback')).toBe('2026-07-14T16:23:19.655Z');
  });

  it('falls back on null/undefined/non-finite input', () => {
    expect(toIsoUtc(null, 'fallback')).toBe('fallback');
    expect(toIsoUtc(undefined, 'fallback')).toBe('fallback');
    expect(toIsoUtc(Number.NaN, 'fallback')).toBe('fallback');
  });
});
