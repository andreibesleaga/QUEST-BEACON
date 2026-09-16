// BEACON — NWPS ACL tests (E4·T-155; F1/adapter-contract §4). The recorded JSON round-trips to valid
// Gauge entities; the worse of observed/forecast category wins (never under-state risk); crest forecast
// maps through; a gauge without coordinates raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { nwpsMapper, parseNwpsGauges, worstCategory } from './nwps-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/gauges.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseNwpsGauges', () => {
  it('reads the gauges array', () => {
    expect(parseNwpsGauges(json)).toHaveLength(3);
  });
  it('returns [] when there are no gauges', () => {
    expect(parseNwpsGauges('{}')).toEqual([]);
  });
});

describe('worstCategory', () => {
  it('returns the more-severe of the two categories', () => {
    expect(worstCategory('minor', 'moderate')).toBe('MODERATE');
    expect(worstCategory('action', 'no_flooding')).toBe('ACTION');
    expect(worstCategory(undefined, null)).toBe('NONE');
  });
});

describe('nwpsMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture gauge to a valid Gauge with crest + worst-category', () => {
    const gauges = parseNwpsGauges(json).map((g) => nwpsMapper.toCanonical(g, ctx));
    expect(gauges).toHaveLength(3);
    const first = gauges[0];
    expect(first?.id).toBe('nwps:SACC1');
    expect(first?.geom).toEqual({ type: 'Point', coordinates: [-121.5052, 38.5988] });
    expect(first?.floodCategory).toBe('MODERATE'); // forecast moderate beats observed minor
    expect(first?.stage).toBe(18.4);
    expect(first?.crestForecast).toBe(22.1);
    expect(first?.crestTime).toBe('2026-07-06T18:00:00Z');
    expect(first?.sourceId).toBe('sid-1');
    expect(gauges[1]?.floodCategory).toBe('MAJOR');
    expect(gauges[2]?.floodCategory).toBe('NONE');
  });

  it('raises a typed PARSE on a gauge without coordinates', () => {
    try {
      nwpsMapper.toCanonical({ lid: 'X', status: {} }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
