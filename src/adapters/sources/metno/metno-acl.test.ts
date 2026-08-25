// BEACON — met.no ACL tests (S2·Lane A3; adapter-contract §4, P3). The RECORDED REAL Locationforecast
// response round-trips to valid WeatherObservations in the units met.no declares; unknown/extra fields are
// ignored (LENIENT); a structurally malformed step is dropped AND COUNTED, never silently discarded; a step
// that reaches the mapper unmappable raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import { metnoMapper, parseMetnoForecast } from './metno-acl.js';

const body = readFileSync(
  fileURLToPath(new URL('./__fixtures__/locationforecast.json', import.meta.url)),
  'utf8',
);

describe('parseMetnoForecast', () => {
  it('flattens every recorded timeseries step with the Feature position, skipping nothing', () => {
    const { rows, skipped } = parseMetnoForecast(body);
    expect(rows).toHaveLength(3);
    expect(skipped).toBe(0);
    expect(rows[0]?.time).toBe('2026-08-08T07:00:00Z');
    expect(rows[0]?.position).toEqual([27.15, 45.75]); // GeoJSON [lon, lat] — altitude (78 m) dropped
  });

  it('ignores unknown/extra fields rather than failing (LENIENT — met.no adds variables over time)', () => {
    const doc = {
      type: 'Feature',
      brand_new_top_level_key: 42,
      geometry: { type: 'Point', coordinates: [10, 60, 5] },
      properties: {
        meta: { units: { wind_speed: 'm/s' } },
        timeseries: [
          {
            time: '2026-07-05T22:00:00Z',
            data: {
              instant: { details: { air_temperature: 11, some_future_variable: 'x' } },
              next_1_hours: { summary: { symbol_code: 'rain' } },
            },
          },
        ],
      },
    };
    const { rows, skipped } = parseMetnoForecast(JSON.stringify(doc));
    expect(skipped).toBe(0);
    expect(metnoMapper.toCanonical(rows[0]!, ctx())).toEqual({
      at: '2026-07-05T22:00:00Z',
      position: [10, 60],
      tempC: 11,
    });
  });

  it('DROPS AND COUNTS malformed steps (no time, unparseable time, no instant.details)', () => {
    const doc = {
      geometry: { type: 'Point', coordinates: [10, 60] },
      properties: {
        timeseries: [
          { time: '2026-07-05T22:00:00Z', data: { instant: { details: { wind_speed: 3 } } } },
          { data: { instant: { details: { wind_speed: 3 } } } }, // no time
          { time: 'not-a-date', data: { instant: { details: {} } } }, // unparseable time
          { time: '2026-07-05T23:00:00Z' }, // no data/instant/details
          { time: '2026-07-06T00:00:00Z', data: { instant: { details: null } } }, // details not an object
        ],
      },
    };
    const { rows, skipped } = parseMetnoForecast(JSON.stringify(doc));
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(4);
  });

  it('yields no rows (all steps counted skipped) when the payload has no usable position', () => {
    const doc = { properties: { timeseries: [{ time: '2026-07-05T22:00:00Z', data: { instant: { details: {} } } }] } };
    expect(parseMetnoForecast(JSON.stringify(doc))).toEqual({ rows: [], skipped: 1 });
  });

  it('returns an empty result on invalid JSON instead of throwing (ladder degrades, never dead-ends)', () => {
    expect(parseMetnoForecast('<html>503</html>')).toEqual({ rows: [], skipped: 0 });
  });
});

describe('metnoMapper.toCanonical (golden round-trip on the recorded response)', () => {
  it('maps every recorded step to a WeatherObservation in met.no-declared units', () => {
    const { rows } = parseMetnoForecast(body);
    const obs = rows.map((r) => metnoMapper.toCanonical(r, ctx()));
    expect(obs).toHaveLength(3);
    // Recorded verbatim: units block declares m/s, celsius, %, degrees ⇒ NO conversion is performed.
    expect(obs[0]).toEqual({
      at: '2026-08-08T07:00:00Z',
      position: [27.15, 45.75],
      windSpeedMs: 7.9,
      windDirDeg: 339.8,
      tempC: 26.1,
      humidityPct: 61.9,
    });
    expect(obs[2]?.tempC).toBe(28.9);
    for (const o of obs) expect(Number.isNaN(Date.parse(o.at))).toBe(false);
  });

  it('omits (never zero-fills) a variable met.no did not publish for that step', () => {
    const raw = { time: '2026-07-05T22:00:00Z', position: [1, 2] as const, details: { wind_speed: 4 } };
    expect(metnoMapper.toCanonical(raw, ctx())).toEqual({
      at: '2026-07-05T22:00:00Z',
      position: [1, 2],
      windSpeedMs: 4,
    });
  });

  it('raises a typed PARSE on a step whose time cannot be placed (defensive ACL boundary)', () => {
    try {
      metnoMapper.toCanonical({ time: 'nope', position: [1, 2], details: {} }, ctx());
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('ignores non-numeric values for a numeric variable rather than emitting NaN', () => {
    const raw = { time: '2026-07-05T22:00:00Z', position: [1, 2] as const, details: { air_temperature: 'warm' } };
    expect(metnoMapper.toCanonical(raw, ctx())).toEqual({ at: '2026-07-05T22:00:00Z', position: [1, 2] });
  });
});

function ctx(): { fetchedAt: string; sourceRecordId: string } {
  return { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-metno' };
}
