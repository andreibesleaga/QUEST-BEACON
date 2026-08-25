// BEACON — Open-Meteo ACL tests (E4·T-157). The mapper is pure/deterministic (Art. XII): position order,
// unit passthrough (URL requests m/s), UTC timestamp normalization, optional-field omission, PARSE on a
// payload without a location, and the parse of present/absent `current` blocks.
import { describe, it, expect } from 'vitest';
import type { MapContext } from '@/adapters/_shared/index.js';
import { openMeteoMapper, parseOpenMeteo } from './open-meteo-acl.js';
import type { OpenMeteoResponse } from './open-meteo-acl.js';

const CTX: MapContext = { fetchedAt: '2026-07-07T13:00:00Z', sourceRecordId: 'sid-om' };

const FULL: OpenMeteoResponse = {
  latitude: 44.4268,
  longitude: 26.1025,
  current: { time: '2026-07-07T12:00', temperature_2m: 31.2, relative_humidity_2m: 38, wind_speed_10m: 5.4, wind_direction_10m: 210 },
};

describe('openMeteoMapper.toCanonical', () => {
  it('maps a full current observation with [lon,lat] order and unit passthrough', () => {
    const obs = openMeteoMapper.toCanonical(FULL, CTX);
    expect(obs.position).toEqual([26.1025, 44.4268]);
    expect(obs.tempC).toBe(31.2);
    expect(obs.windSpeedMs).toBe(5.4);
    expect(obs.windDirDeg).toBe(210);
    expect(obs.humidityPct).toBe(38);
  });

  it('normalizes a zoneless minute-resolution time to explicit UTC', () => {
    expect(openMeteoMapper.toCanonical(FULL, CTX).at).toBe('2026-07-07T12:00:00Z');
  });

  it('keeps a timestamp that is already zoned', () => {
    const zoned = { ...FULL, current: { ...FULL.current, time: '2026-07-07T12:00:00Z' } };
    expect(openMeteoMapper.toCanonical(zoned, CTX).at).toBe('2026-07-07T12:00:00Z');
  });

  it('falls back to the fetch instant when time is absent', () => {
    const noTime = { latitude: 1, longitude: 2, current: { temperature_2m: 20 } };
    expect(openMeteoMapper.toCanonical(noTime, CTX).at).toBe('2026-07-07T13:00:00Z');
  });

  it('omits optional fields that are absent or null (definedOnly)', () => {
    const sparse: OpenMeteoResponse = { latitude: 1, longitude: 2, current: { time: '2026-07-07T12:00', temperature_2m: null } };
    const obs = openMeteoMapper.toCanonical(sparse, CTX);
    expect(obs.tempC).toBeUndefined();
    expect(obs.windSpeedMs).toBeUndefined();
    expect('humidityPct' in obs).toBe(false);
  });

  it('throws a typed PARSE when the location is missing', () => {
    expect(() => openMeteoMapper.toCanonical({ current: { temperature_2m: 20 } }, CTX)).toThrow(/lat,lon/);
  });
});

describe('parseOpenMeteo', () => {
  it('returns the single row when a current block is present', () => {
    expect(parseOpenMeteo(JSON.stringify(FULL))).toHaveLength(1);
  });

  it('returns nothing when there is no current block', () => {
    expect(parseOpenMeteo(JSON.stringify({ latitude: 1, longitude: 2 }))).toEqual([]);
  });
});
