// BEACON — GloFAS ACL tests (E4·T-173; F1/adapter-contract §4). The recorded reporting-point GeoJSON
// round-trips to valid Gauge entities; floodCategory is derived deterministically from the return-period
// severity (2→MINOR, 5→MODERATE, 20→MAJOR, else NONE); the forecast peak discharge + time-to-peak map
// through as crestForecast/crestTime; a point without coordinates raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { glofasMapper, parseGlofasReportingPoints, categoryFromReturnPeriod } from './glofas-acl.js';

const json = readFileSync(fileURLToPath(new URL('./__fixtures__/reporting-points.json', import.meta.url)), 'utf8');
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseGlofasReportingPoints', () => {
  it('reads the FeatureCollection features array', () => {
    expect(parseGlofasReportingPoints(json)).toHaveLength(3);
  });
  it('returns [] when there are no features', () => {
    expect(parseGlofasReportingPoints('{}')).toEqual([]);
  });
});

describe('categoryFromReturnPeriod', () => {
  it('maps GloFAS return-period severity to the ordered FloodCategory', () => {
    expect(categoryFromReturnPeriod(20)).toBe('MAJOR');
    expect(categoryFromReturnPeriod(5)).toBe('MODERATE');
    expect(categoryFromReturnPeriod(2)).toBe('MINOR');
    expect(categoryFromReturnPeriod(0)).toBe('NONE');
    expect(categoryFromReturnPeriod(null)).toBe('NONE');
    expect(categoryFromReturnPeriod('5')).toBe('MODERATE');
  });
});

const mapped = () => parseGlofasReportingPoints(json).map((g) => glofasMapper.toCanonical(g, ctx));

describe('glofasMapper.toCanonical (golden round-trip)', () => {
  it('maps the RO reporting point (Siret at Galati) with severity + crest', () => {
    const ro = mapped()[0];
    expect(ro?.id).toBe('glofas:G0421');
    expect(ro?.geom).toEqual({ type: 'Point', coordinates: [27.9457, 45.4353] });
    expect(ro?.floodCategory).toBe('MODERATE'); // 5-year return period
    expect(ro?.crestForecast).toBe(2650); // forecast peak discharge (m³/s)
    expect(ro?.crestTime).toBe('2026-07-07T12:00:00Z');
    expect(ro?.stage).toBeUndefined(); // GloFAS is a model — no observed stage
    expect(ro?.sourceId).toBe('sid-1');
  });

  it('carries the exceedance probability and tendency instead of dropping them (finding F-15)', () => {
    const gauges = mapped();
    expect(gauges[0]?.exceedanceProbability).toBe(0.74); // verbatim fraction, not rescaled to a %
    expect(gauges[0]?.tendency).toBe('INCREASING'); // uppercased machine value
    expect(gauges[1]?.exceedanceProbability).toBe(0.91);
    expect(gauges[2]?.exceedanceProbability).toBe(0.12); // below any class band — still carried
    expect(gauges[2]?.tendency).toBe('DECREASING');
  });

  it('leaves both absent when the point publishes neither', () => {
    const g = glofasMapper.toCanonical(
      { geometry: { type: 'Point', coordinates: [10.5, 51.2] }, properties: { returnPeriod: 2 } },
      ctx,
    );
    expect(g.exceedanceProbability).toBeUndefined();
    expect(g.tendency).toBeUndefined();
  });

  it('does not guess the unit of an out-of-range probability, and does not invent a tendency', () => {
    // A bare 74 could be 74 % or a 74-fold nonsense; guessing could turn a quiet river into a certainty.
    const g = glofasMapper.toCanonical(
      {
        geometry: { type: 'Point', coordinates: [10.5, 51.2] },
        properties: { returnPeriod: 2, probability: 74, tendency: 'rising fast' },
      },
      ctx,
    );
    expect(g.exceedanceProbability).toBeUndefined();
    expect(g.tendency).toBeUndefined();
  });

  it('normalizes the documented tendency wording, whatever case the source used', () => {
    const tendencyOf = (tendency: string) =>
      glofasMapper.toCanonical(
        { geometry: { type: 'Point', coordinates: [1, 2] }, properties: { tendency, probability: 0.55 } },
        ctx,
      );
    expect(tendencyOf('Stagnant').tendency).toBe('STAGNANT');
    expect(tendencyOf(' decreasing ').tendency).toBe('DECREASING');
    expect(tendencyOf('INCREASING').tendency).toBe('INCREASING');
    expect(tendencyOf('increasing').exceedanceProbability).toBe(0.55);
    expect(tendencyOf('  ').tendency).toBeUndefined();
  });

  it('maps the global points: Brahmaputra (20-yr → MAJOR) and a below-threshold NONE', () => {
    const gauges = mapped();
    expect(gauges).toHaveLength(3);
    expect(gauges[1]?.id).toBe('glofas:G3187');
    expect(gauges[1]?.floodCategory).toBe('MAJOR');
    expect(gauges[2]?.floodCategory).toBe('NONE');
    expect(gauges[2]?.crestForecast).toBeUndefined();
  });

  it('raises a typed PARSE on a point without coordinates', () => {
    try {
      glofasMapper.toCanonical({ properties: { pointId: 'X', returnPeriod: 5 } }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('falls back to lon,lat as the id when pointId is absent', () => {
    const g = glofasMapper.toCanonical(
      { geometry: { type: 'Point', coordinates: [10.5, 51.2] }, properties: { returnPeriod: 2 } },
      ctx,
    );
    expect(g.id).toBe('glofas:10.5,51.2');
    expect(g.floodCategory).toBe('MINOR');
  });
});
