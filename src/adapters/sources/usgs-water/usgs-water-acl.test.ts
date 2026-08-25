// BEACON — USGS Water ACL tests (E4·T-156; F1/adapter-contract §4). The recorded IV JSON round-trips to
// valid Gauge entities using the latest observed value; floodCategory is NONE (raw stage, honest); a
// series without geolocation raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { usgsWaterMapper, parseUsgsTimeSeries } from './usgs-water-acl.js';

const json = readFileSync(fileURLToPath(new URL('./__fixtures__/instantaneous.json', import.meta.url)), 'utf8');
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseUsgsTimeSeries', () => {
  it('reads the value.timeSeries array', () => {
    expect(parseUsgsTimeSeries(json)).toHaveLength(2);
  });
  it('returns [] when there is no time series', () => {
    expect(parseUsgsTimeSeries('{}')).toEqual([]);
  });
});

describe('usgsWaterMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture series to a valid Gauge using the latest stage', () => {
    const gauges = parseUsgsTimeSeries(json).map((s) => usgsWaterMapper.toCanonical(s, ctx));
    expect(gauges).toHaveLength(2);
    const first = gauges[0];
    expect(first?.id).toBe('usgs:11447650');
    expect(first?.geom).toEqual({ type: 'Point', coordinates: [-121.5008, 38.4555] });
    expect(first?.stage).toBe(14.63); // latest of the two observations
    expect(first?.floodCategory).toBe('NONE');
    expect(first?.sourceId).toBe('sid-1');
  });

  it('raises a typed PARSE on a series without geolocation', () => {
    try {
      usgsWaterMapper.toCanonical({ sourceInfo: { siteName: 'X' } }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
