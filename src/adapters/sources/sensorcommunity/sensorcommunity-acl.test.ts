// BEACON — Sensor.Community ACL tests (S2 Lane A4; adapter-contract §4, AirQualityPort P17). The RECORDED
// fixture maps to canonical AirQualityReadings; P1/P2 are decoded to PM10/PM2.5 per the project's own API
// docs; non-PM channels and malformed entries are SKIPPED **and COUNTED** (never silently dropped); the
// citizen network never fabricates an AQI; the UTC timestamp is converted losslessly.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { MapContext } from '@/adapters/_shared/index.js';
import {
  isoFromTimestamp,
  parseSensorCommunity,
  sensorCommunityMapper,
} from './sensorcommunity-acl.js';

const CTX: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-sc' };
const FIXTURE = fileURLToPath(new URL('./__fixtures__/box.json', import.meta.url));

const fixtureText = (): Promise<string> => readFile(FIXTURE, 'utf8');

describe('parseSensorCommunity', () => {
  it('flattens the recorded fixture into one row per PM channel', async () => {
    const parsed = parseSensorCommunity(await fixtureText());
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows.every((r) => r.pollutant === 'PM25' || r.pollutant === 'PM10')).toBe(true);
    expect(parsed.rows.every((r) => Number.isFinite(r.value))).toBe(true);
  });

  it('decodes P1 → PM10 and P2 → PM2.5 (the documented value_type codes)', () => {
    const parsed = parseSensorCommunity(
      JSON.stringify([
        {
          id: 1,
          timestamp: '2026-07-05 21:55:00',
          location: { id: 42, latitude: '44.4', longitude: '26.1' },
          sensor: { id: 7 },
          sensordatavalues: [
            { value: '31.5', value_type: 'P1' },
            { value: '12.25', value_type: 'P2' },
          ],
        },
      ]),
    );
    expect(parsed.skipped).toBe(0);
    expect(parsed.rows.map((r) => [r.pollutant, r.value])).toEqual([
      ['PM10', 31.5],
      ['PM25', 12.25],
    ]);
  });

  it('SKIPS and COUNTS non-PM channels (temperature/humidity/pressure) rather than coercing them', () => {
    const parsed = parseSensorCommunity(
      JSON.stringify([
        {
          id: 2,
          timestamp: '2026-07-05 21:55:00',
          location: { id: 42, latitude: '44.4', longitude: '26.1' },
          sensor: { id: 8 },
          sensordatavalues: [
            { value: '27.3', value_type: 'temperature' },
            { value: '52.8', value_type: 'humidity' },
            { value: '9.9', value_type: 'P2' },
          ],
        },
      ]),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.pollutant).toBe('PM25');
    expect(parsed.skipped).toBe(2);
  });

  it('SKIPS and COUNTS an entry with a malformed position, keeping the rest of the batch', () => {
    const parsed = parseSensorCommunity(
      JSON.stringify([
        {
          id: 3,
          timestamp: '2026-07-05 21:55:00',
          location: { id: 43, latitude: 'not-a-number', longitude: '26.1' },
          sensor: { id: 9 },
          sensordatavalues: [{ value: '5', value_type: 'P2' }],
        },
        {
          id: 4,
          timestamp: '2026-07-05 21:55:00',
          location: { id: 44, latitude: '44.5', longitude: '26.2' },
          sensor: { id: 10 },
          sensordatavalues: [{ value: '6', value_type: 'P2' }],
        },
      ]),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.locationId).toBe('44');
    expect(parsed.skipped).toBe(1);
  });

  it('ignores unknown top-level fields (lenient ACL) and a non-array body', () => {
    const lenient = parseSensorCommunity(
      JSON.stringify([
        {
          id: 5,
          timestamp: '2026-07-05 21:55:00',
          location: {
            id: 45,
            latitude: '44.5',
            longitude: '26.2',
            altitude: '75.1',
            indoor: 0,
            brand_new_field: true,
          },
          sampling_rate: null,
          sensor: {
            id: 11,
            pin: '1',
            sensor_type: { name: 'SDS011', id: 14, manufacturer: 'Nova Fitness' },
          },
          sensordatavalues: [{ value: '6', value_type: 'P2', id: 999 }],
        },
      ]),
    );
    expect(lenient.rows).toHaveLength(1);
    expect(parseSensorCommunity('{}').rows).toHaveLength(0);
  });
});

describe('isoFromTimestamp', () => {
  it("converts the upstream UTC 'YYYY-MM-DD HH:MM:SS' to ISO-8601 Z", () => {
    expect(isoFromTimestamp('2026-07-05 21:55:00')).toBe('2026-07-05T21:55:00Z');
  });

  it('returns undefined for a shape it cannot vouch for (never guesses a zone)', () => {
    expect(isoFromTimestamp('05/07/2026 21:55')).toBeUndefined();
    expect(isoFromTimestamp(null)).toBeUndefined();
  });
});

describe('sensorCommunityMapper', () => {
  it('maps a row to a canonical AirQualityReading with verbatim µg/m³ units and NO fabricated AQI', () => {
    const parsed = parseSensorCommunity(
      JSON.stringify([
        {
          id: 6,
          timestamp: '2026-07-05 21:55:00',
          location: { id: 78667, latitude: '44.42347561414', longitude: '26.14607691765' },
          sensor: { id: 87657 },
          sensordatavalues: [{ value: '6.82', value_type: 'P2' }],
        },
      ]),
    );
    const row = parsed.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    const reading = sensorCommunityMapper.toCanonical(row, CTX);
    expect(reading).toEqual({
      stationId: 'sensorcommunity:87657',
      stationName: 'Sensor.Community 87657',
      position: [26.14607691765, 44.42347561414],
      pollutant: 'PM25',
      value: 6.82,
      unit: 'µg/m³',
      observedAt: '2026-07-05T21:55:00Z',
      sourceId: 'sid-sc',
    });
    expect(reading.aqi).toBeUndefined();
    expect(reading.aqiCategory).toBeUndefined();
  });

  it('throws a typed PARSE if handed a row with a non-finite value directly', () => {
    expect(() =>
      sensorCommunityMapper.toCanonical(
        {
          sensorId: '1',
          locationId: '1',
          lon: 26,
          lat: 44,
          pollutant: 'PM25',
          value: Number.NaN,
          observedAt: '2026-07-05T21:55:00Z',
        },
        CTX,
      ),
    ).toThrow(/invalid value\/position/);
  });
});
