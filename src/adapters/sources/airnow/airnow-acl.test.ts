// BEACON — AirNow ACL tests (S2 Lane A4; adapter-contract §4, AirQualityPort P17, Art. XII). The RECORDED
// Hourly AQ Obs fixture maps to canonical AirQualityReadings; the EPA AQI→category table is applied at its
// published breakpoints; a site with no readable PM channel is SKIPPED **and COUNTED**; the quote-aware
// splitter survives a comma inside SiteName; UTC date/time are combined losslessly; no figure is invented.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { MapContext } from '@/adapters/_shared/index.js';
import { airNowMapper, airNowObservedAt, aqiCategory, parseAirNow, splitCsvLine } from './airnow-acl.js';

const CTX: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-airnow' };
const FIXTURE = fileURLToPath(new URL('./__fixtures__/hourly-aq-obs.csv', import.meta.url));

const fixtureText = (): Promise<string> => readFile(FIXTURE, 'utf8');

describe('aqiCategory (EPA breakpoints, docs.airnowapi.org/aq101)', () => {
  it('maps each published band, inclusive of its upper bound', () => {
    expect([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 500].map(aqiCategory)).toEqual([
      'GOOD',
      'GOOD',
      'MODERATE',
      'MODERATE',
      'UNHEALTHY_SENSITIVE',
      'UNHEALTHY_SENSITIVE',
      'UNHEALTHY',
      'UNHEALTHY',
      'VERY_UNHEALTHY',
      'VERY_UNHEALTHY',
      'HAZARDOUS',
      'HAZARDOUS',
    ]);
  });
});

describe('splitCsvLine', () => {
  it('keeps a comma that is INSIDE a quoted SiteName in the same cell, and unwraps the quotes', () => {
    expect(splitCsvLine('"060374009","Long Beach, Signal Hill","Active"')).toEqual([
      '060374009',
      'Long Beach, Signal Hill',
      'Active',
    ]);
  });

  it('also handles an unquoted line (the fact sheet quotes every field, but leniency costs nothing)', () => {
    expect(splitCsvLine('1,X,44.4')).toEqual(['1', 'X', '44.4']);
  });
});

describe('airNowObservedAt', () => {
  it('combines ValidDate (MM/DD/YYYY) + ValidTime (HH:MM), both GMT per the fact sheet', () => {
    expect(airNowObservedAt({ ValidDate: '08/08/2026', ValidTime: '04:00' })).toBe('2026-08-08T04:00:00Z');
  });

  it('returns undefined rather than guessing a malformed instant', () => {
    expect(airNowObservedAt({ ValidDate: '2026-08-08', ValidTime: '04:00' })).toBeUndefined();
    expect(airNowObservedAt({})).toBeUndefined();
  });
});

describe('parseAirNow', () => {
  it('parses the recorded fixture into PM rows carrying the source-published AQI', async () => {
    const parsed = parseAirNow(await fixtureText());
    expect(parsed.rows.length).toBeGreaterThan(0);
    const worst = parsed.rows.find((r) => r.siteName === 'Omak-Colville Tribe' && r.pollutant === 'PM25');
    expect(worst).toBeDefined();
    expect(worst?.aqi).toBe(284);
    expect(worst?.value).toBe(205);
    expect(worst?.unit).toBe('UG/M3');
    expect(worst?.observedAt).toBe('2026-08-08T04:00:00Z');
  });

  it('SKIPS and COUNTS a real site record that publishes no readable PM channel', async () => {
    const parsed = parseAirNow(await fixtureText());
    // The recorded fixture deliberately includes a real ozone-only WA site (empty PM25_AQI/PM10_AQI).
    expect(parsed.skipped).toBe(1);
  });

  it('applies the caller spatial predicate so a nationwide file answers a bbox query', async () => {
    const text = await fixtureText();
    const oregonOnly = parseAirNow(text, (lon, lat) => lon > -118.5 && lat < 46);
    expect(oregonOnly.rows.map((r) => r.siteName)).toEqual(['Cove - City Hall']);
    expect(parseAirNow(text, () => false).rows).toHaveLength(0);
  });

  it('is lenient: unknown extra columns and a header-only file do not throw', () => {
    const header = 'AQSID,SiteName,Latitude,Longitude,ValidDate,ValidTime,PM25_AQI,PM25,PM25_Unit,BRAND_NEW_COLUMN';
    expect(parseAirNow(header).rows).toHaveLength(0);
    const one = parseAirNow(`${header}\n"1","X","44.4","26.1","08/08/2026","04:00","55","13.2","UG/M3","ignored"`);
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0]?.aqi).toBe(55);
    expect(parseAirNow('').rows).toHaveLength(0);
  });
});

describe('airNowMapper', () => {
  it('maps a row to a canonical AirQualityReading with the EPA category and a verbatim unit', async () => {
    const parsed = parseAirNow(await fixtureText());
    const row = parsed.rows.find((r) => r.siteName === 'Omak-Colville Tribe' && r.pollutant === 'PM25');
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(airNowMapper.toCanonical(row, CTX)).toEqual({
      stationId: 'airnow:530470013',
      stationName: 'Omak-Colville Tribe',
      position: [-119.518959, 48.39999],
      pollutant: 'PM25',
      value: 205,
      unit: 'UG/M3',
      aqi: 284,
      aqiCategory: 'VERY_UNHEALTHY',
      observedAt: '2026-08-08T04:00:00Z',
      sourceId: 'sid-airnow',
    });
  });

  it('throws a typed PARSE if handed a row with a non-finite AQI directly', () => {
    expect(() =>
      airNowMapper.toCanonical(
        {
          siteId: '1',
          siteName: 'X',
          lon: -119,
          lat: 48,
          pollutant: 'PM25',
          value: 10,
          unit: 'UG/M3',
          aqi: Number.NaN,
          observedAt: '2026-08-08T04:00:00Z',
        },
        CTX,
      ),
    ).toThrow(/invalid AQI\/value/);
  });
});
