// BEACON — NWS ACL tests (E4·T-153; F1/adapter-contract §4). The recorded GeoJSON round-trips to valid
// WeatherObservation DTOs; km/h wind is converted to m/s deterministically; a feature without geometry
// raises a typed PARSE (never silently dropped).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { nwsMapper, parseNwsObservations } from './nws-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/observations.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseNwsObservations', () => {
  it('reads the FeatureCollection features array', () => {
    const feats = parseNwsObservations(json);
    expect(feats).toHaveLength(3);
  });

  it('wraps a single latest-observation Feature as a one-element array', () => {
    const one = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-121, 38] },
      properties: {},
    });
    expect(parseNwsObservations(one)).toHaveLength(1);
  });
});

describe('nwsMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture feature to a WeatherObservation with converted wind (km/h → m/s)', () => {
    const obs = parseNwsObservations(json).map((f) => nwsMapper.toCanonical(f, ctx));
    expect(obs).toHaveLength(3);
    const first = obs[0];
    expect(first?.position).toEqual([-121.4936, 38.5069]);
    expect(first?.tempC).toBe(34.4);
    expect(first?.windSpeedMs).toBeCloseTo(5.1, 5); // 18.36 km/h / 3.6
    expect(first?.windDirDeg).toBe(200);
    expect(first?.humidityPct).toBe(22.7);
    expect(first?.at).toBe('2026-07-05T21:15:00+00:00');
  });

  it('raises a typed PARSE on a feature without geometry', () => {
    try {
      nwsMapper.toCanonical({ properties: { timestamp: 't' } }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('falls back to ctx.fetchedAt when the observation has no timestamp', () => {
    const obs = nwsMapper.toCanonical(
      { geometry: { type: 'Point', coordinates: [-121, 38] }, properties: {} },
      ctx,
    );
    expect(obs.at).toBe('2026-07-05T22:00:00Z');
  });
});
