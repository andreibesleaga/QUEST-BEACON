// BEACON — OpenAQ ACL tests (S2 Lane A4; adapter-contract §4, AirQualityPort P17, Art. XII). The two-stage
// v3 join (locations → latest) produces canonical AirQualityReadings; a latest value whose sensorsId is not
// in the station index is SKIPPED **and COUNTED** rather than given a guessed identity; unmodelled
// parameters and malformed stations are skipped + counted; OpenAQ publishes concentrations, so no AQI is
// ever fabricated; unknown upstream fields are ignored.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { MapContext } from '@/adapters/_shared/index.js';
import { joinOpenAqLatest, locationIdsOf, openAqMapper, parseOpenAqLocations } from './openaq-acl.js';

const CTX: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-openaq' };
const dir = new URL('./__fixtures__/', import.meta.url);
const read = (name: string): Promise<string> => readFile(fileURLToPath(new URL(name, dir)), 'utf8');

describe('parseOpenAqLocations', () => {
  it('indexes every modelled sensor of the fixture by sensor id, with station identity + verbatim unit', async () => {
    const index = parseOpenAqLocations(await read('locations.json'));
    expect(index.bySensorId.size).toBe(4);
    const pm25 = index.bySensorId.get('3920');
    expect(pm25).toEqual({
      locationId: '1592',
      locationName: 'Omak-Colville Tribe',
      lon: -119.518959,
      lat: 48.39999,
      pollutant: 'PM25',
      unit: 'µg/m³',
    });
    expect(index.bySensorId.get('3921')?.pollutant).toBe('O3');
    expect(index.skipped).toBe(0);
  });

  it('SKIPS and COUNTS a sensor whose parameter BEACON does not model, and a station with no position', () => {
    const index = parseOpenAqLocations(
      JSON.stringify({
        results: [
          {
            id: 1,
            name: 'A',
            coordinates: { latitude: 48, longitude: -119 },
            sensors: [
              { id: 10, parameter: { name: 'pm25', units: 'µg/m³' } },
              { id: 11, parameter: { name: 'bc', units: 'µg/m³' } },
            ],
          },
          { id: 2, name: 'B', coordinates: { latitude: null, longitude: -119 }, sensors: [{ id: 12, parameter: { name: 'pm25', units: 'µg/m³' } }] },
        ],
      }),
    );
    expect([...index.bySensorId.keys()]).toEqual(['10']);
    expect(index.skipped).toBe(2);
  });

  it('is lenient: unknown fields and a missing `results` array do not throw', () => {
    const lenient = parseOpenAqLocations(
      JSON.stringify({
        meta: { name: 'openaq-api' },
        results: [
          {
            id: 3,
            name: 'C',
            brandNewField: 'ignored',
            coordinates: { latitude: 48, longitude: -119 },
            instruments: [{ id: 2, name: 'Government Monitor' }],
            sensors: [{ id: 13, name: 'pm25 µg/m³', parameter: { id: 2, name: 'pm25', units: 'µg/m³', displayName: 'PM2.5' } }],
          },
        ],
      }),
    );
    expect(lenient.bySensorId.size).toBe(1);
    expect(parseOpenAqLocations('{}').bySensorId.size).toBe(0);
  });
});

describe('locationIdsOf', () => {
  it('returns each station once, ascending — a deterministic, de-duplicated stage-2 fan-out list', async () => {
    expect(locationIdsOf(parseOpenAqLocations(await read('locations.json')))).toEqual(['1592', '1607', '1631']);
  });
});

describe('joinOpenAqLatest', () => {
  it('joins latest values onto their station via sensorsId', async () => {
    const index = parseOpenAqLocations(await read('locations.json'));
    const parsed = joinOpenAqLatest(index, [await read('latest.json')]);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.skipped).toBe(0);
    const worst = parsed.rows.find((r) => r.sensorId === '3920');
    expect(worst?.locationName).toBe('Omak-Colville Tribe');
    expect(worst?.value).toBe(205);
    expect(worst?.observedAt).toBe('2026-08-08T04:00:00Z');
  });

  it('SKIPS and COUNTS a latest value whose sensorsId is not in the index (never a guessed identity)', async () => {
    const index = parseOpenAqLocations(await read('locations.json'));
    const parsed = joinOpenAqLatest(index, [
      JSON.stringify({
        results: [
          { sensorsId: 999999, locationsId: 1, value: 42, datetime: { utc: '2026-08-08T04:00:00Z' }, coordinates: { latitude: 1, longitude: 2 } },
          { sensorsId: 3920, locationsId: 1592, value: 7, datetime: { utc: '2026-08-08T04:00:00Z' }, coordinates: { latitude: 48.39999, longitude: -119.518959 } },
        ],
      }),
    ]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
  });

  it('carries the stage-1 skip count forward and drops a value with an unusable instant', async () => {
    const index = parseOpenAqLocations(
      JSON.stringify({ results: [{ id: 1, name: 'A', coordinates: { latitude: 48, longitude: -119 }, sensors: [{ id: 10, parameter: { name: 'pm25', units: 'µg/m³' } }, { id: 11, parameter: { name: 'bc', units: 'µg/m³' } }] }] }),
    );
    const parsed = joinOpenAqLatest(index, [
      JSON.stringify({ results: [{ sensorsId: 10, value: 5, datetime: { utc: 'not-a-date' }, coordinates: { latitude: 48, longitude: -119 } }] }),
    ]);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped).toBe(2); // 1 unmodelled sensor (stage 1) + 1 unusable instant (stage 2)
  });

  it('prefers the per-measurement coordinates (mobile monitors) and falls back to the station', async () => {
    const index = parseOpenAqLocations(await read('locations.json'));
    const moved = joinOpenAqLatest(index, [
      JSON.stringify({ results: [{ sensorsId: 3920, value: 5, datetime: { utc: '2026-08-08T04:00:00Z' }, coordinates: { latitude: 47, longitude: -118 } }] }),
    ]);
    expect([moved.rows[0]?.lon, moved.rows[0]?.lat]).toEqual([-118, 47]);
    const noCoords = joinOpenAqLatest(index, [
      JSON.stringify({ results: [{ sensorsId: 3920, value: 5, datetime: { utc: '2026-08-08T04:00:00Z' } }] }),
    ]);
    expect([noCoords.rows[0]?.lon, noCoords.rows[0]?.lat]).toEqual([-119.518959, 48.39999]);
  });
});

describe('openAqMapper', () => {
  it('maps a joined row to a canonical AirQualityReading with NO fabricated AQI', async () => {
    const index = parseOpenAqLocations(await read('locations.json'));
    const row = joinOpenAqLatest(index, [await read('latest.json')]).rows.find((r) => r.sensorId === '3920');
    expect(row).toBeDefined();
    if (row === undefined) return;
    const reading = openAqMapper.toCanonical(row, CTX);
    expect(reading).toEqual({
      stationId: 'openaq:1592:3920',
      stationName: 'Omak-Colville Tribe',
      position: [-119.518959, 48.39999],
      pollutant: 'PM25',
      value: 205,
      unit: 'µg/m³',
      observedAt: '2026-08-08T04:00:00Z',
      sourceId: 'sid-openaq',
    });
    expect(reading.aqi).toBeUndefined();
    expect(reading.aqiCategory).toBeUndefined();
  });

  it('throws a typed PARSE if handed a row with a non-finite value directly', () => {
    expect(() =>
      openAqMapper.toCanonical(
        {
          locationId: '1',
          locationName: 'X',
          sensorId: '1',
          lon: -119,
          lat: 48,
          pollutant: 'PM25',
          unit: 'µg/m³',
          value: Number.NaN,
          observedAt: '2026-08-08T04:00:00Z',
        },
        CTX,
      ),
    ).toThrow(/invalid value\/position/);
  });
});
