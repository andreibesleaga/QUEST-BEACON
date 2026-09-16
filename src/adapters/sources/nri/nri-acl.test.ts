// BEACON — FEMA NRI ACL tests (S2·Lane-A2; F1/adapter-contract §4). The RECORDED REAL FeatureServer
// response round-trips to per-county PopulationEstimates carrying the census count VERBATIM; an ArcGIS
// error payload raises PARSE instead of reporting "no population"; malformed features are dropped AND
// counted; the centroid marker box is a marker, not a county boundary.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import {
  bboxCenter,
  centroidBox,
  centroidOf,
  nriMapper,
  parseNriCounties,
  pointInBBox,
} from './nri-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/counties.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseNriCounties', () => {
  it('keeps every usable county of the recorded response', () => {
    const res = parseNriCounties(json);
    expect(res.features).toHaveLength(4); // Butte / Glenn / Plumas / Yuba (the Butte-fire envelope)
    expect(res.skipped).toBe(0);
    expect(res.features[0]?.attributes?.COUNTY).toBe('Butte');
  });

  it('raises PARSE on an ArcGIS error payload rather than reporting zero population (Art. XII)', () => {
    try {
      parseNriCounties(
        JSON.stringify({ error: { code: 400, message: "'outFields' parameter is invalid" } }),
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) {
        expect(e.kind).toBe('PARSE');
        expect(e.message).toContain('outFields');
      }
    }
  });

  it('drops AND counts features with no finite centroid or no finite POPULATION', () => {
    const res = parseNriCounties(
      JSON.stringify({
        features: [
          { attributes: { NRI_ID: 'C1', POPULATION: 100 } }, // no centroid
          { attributes: { NRI_ID: 'C2', POPULATION: null }, centroid: { x: 1, y: 2 } },
          { attributes: { NRI_ID: 'C3', POPULATION: -5 }, centroid: { x: 1, y: 2 } },
          { attributes: { NRI_ID: 'C4', POPULATION: 7 }, centroid: { x: 1, y: 2 } },
        ],
      }),
    );
    expect(res.features.map((f) => f.attributes?.NRI_ID)).toEqual(['C4']);
    expect(res.skipped).toBe(3);
  });

  it('returns an empty result for a body with no features array', () => {
    expect(parseNriCounties('{"fields":[]}')).toEqual({ features: [], skipped: 0 });
  });
});

describe('nriMapper.toCanonical (golden round-trip over the recorded response)', () => {
  it('carries the NRI 2020-Census POPULATION verbatim, marked at the service-supplied centroid', () => {
    const { features } = parseNriCounties(json);
    const estimates = features.map((f) => nriMapper.toCanonical(f, ctx));
    expect(estimates.map((e) => e.count)).toEqual([211490, 28889, 19746, 81512]);
    const butte = estimates[0];
    expect(butte?.area).toEqual([
      -121.61068334988443, 39.65775989240478, -121.59068334988442, 39.67775989240478,
    ]);
    // A marker box, never a county boundary: its edge is 0.02° — far smaller than any real county.
    expect((butte?.area[2] ?? 0) - (butte?.area[0] ?? 0)).toBeCloseTo(0.02, 10);
  });

  it('raises a typed PARSE for a feature the ACL cannot place', () => {
    try {
      nriMapper.toCanonical({ attributes: { NRI_ID: 'C06007', POPULATION: 100 } }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});

describe('NRI geometry helpers', () => {
  it('rejects a non-finite centroid rather than inventing a location', () => {
    expect(centroidOf({ centroid: { x: 1, y: 2 } })).toEqual([1, 2]);
    expect(centroidOf({ centroid: { x: Number.NaN, y: 2 } })).toBeUndefined();
    expect(centroidOf({ centroid: null })).toBeUndefined();
    expect(centroidOf({})).toBeUndefined();
  });

  it('round-trips a centroid through its marker box', () => {
    expect(bboxCenter(centroidBox([-121.6, 39.66]))).toEqual([-121.6, 39.66]);
  });

  it('tests bbox membership inclusively', () => {
    expect(pointInBBox([-121.6, 39.66], [-122, 39, -121, 40])).toBe(true);
    expect(pointInBBox([-122, 39], [-122, 39, -121, 40])).toBe(true); // corner is inside
    expect(pointInBBox([-123, 39.66], [-122, 39, -121, 40])).toBe(false);
    expect(pointInBBox([-121.6, 41], [-122, 39, -121, 40])).toBe(false);
  });
});
