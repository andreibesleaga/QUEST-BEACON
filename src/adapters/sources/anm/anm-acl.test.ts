// BEACON — ANM ACL tests (S2·Lane A3; adapter-contract §4, P3). The RECORDED REAL `starea-vremii` response
// round-trips to valid WeatherObservations; EPSG:3857 station coordinates are inverse-projected to real
// Romanian geography; the Romanian wind string ("1.6 m/s, directia : VNV") and the "indisponibil" marker are
// decoded; unknown properties are ignored (LENIENT); malformed features are dropped AND COUNTED.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import { anmMapper, parseAnmObservations, parseVant, webMercatorToWgs84 } from './anm-acl.js';

const body = readFileSync(
  fileURLToPath(new URL('./__fixtures__/starea-vremii.json', import.meta.url)),
  'utf8',
);
const CTX = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-anm' };

describe('parseAnmObservations', () => {
  it('flattens every recorded station onto the collection instant, normalized to UTC', () => {
    const { rows, skipped } = parseAnmObservations(body);
    expect(rows).toHaveLength(5);
    expect(skipped).toBe(0);
    // ANM publishes "2026-07-02T06:00:00+03:00" (Romanian local time) — stored as the UTC instant.
    expect(rows[0]?.at).toBe('2026-07-02T03:00:00.000Z');
    expect(rows[0]?.name).toBe('ADAMCLISI');
    expect(rows[0]?.easting).toBe(3113115.07); // still raw EPSG:3857 metres at this stage
  });

  it('ignores unknown/extra properties rather than failing (LENIENT)', () => {
    const doc = {
      date: '2026-07-05T22:00:00+00:00',
      features: [
        {
          geometry: { type: 'Point', coordinates: ['3113115.07', '5479112.02'], zoom: 0 },
          properties: { nume: 'X', tempe: '10', a_brand_new_anm_field: 'whatever', icon: '84' },
        },
      ],
    };
    const { rows, skipped } = parseAnmObservations(JSON.stringify(doc));
    expect(skipped).toBe(0);
    expect(rows[0]?.tempe).toBe('10');
  });

  it('DROPS AND COUNTS malformed features (no properties, no geometry, non-numeric coordinates)', () => {
    const doc = {
      date: '2026-07-05T22:00:00+00:00',
      features: [
        { geometry: { coordinates: ['1', '2'] }, properties: { nume: 'ok' } },
        { properties: { nume: 'no geometry' } },
        { geometry: { coordinates: ['1', '2'] } }, // no properties
        { geometry: { coordinates: ['x', 'y'] }, properties: { nume: 'bad coords' } },
        null,
      ],
    };
    const { rows, skipped } = parseAnmObservations(JSON.stringify(doc));
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(4);
  });

  it('yields no rows (all features counted skipped) when the collection instant is missing/unparseable', () => {
    const doc = { features: [{ geometry: { coordinates: ['1', '2'] }, properties: {} }] };
    expect(parseAnmObservations(JSON.stringify(doc))).toEqual({ rows: [], skipped: 1 });
    const bad = { date: 'candva', features: [{ geometry: { coordinates: ['1', '2'] }, properties: {} }] };
    expect(parseAnmObservations(JSON.stringify(bad))).toEqual({ rows: [], skipped: 1 });
  });

  it('returns an empty result on invalid JSON or the "Nu exista date" body ANM serves when idle', () => {
    expect(parseAnmObservations('<html>503</html>')).toEqual({ rows: [], skipped: 0 });
    expect(parseAnmObservations('"Nu exista date"')).toEqual({ rows: [], skipped: 0 });
  });
});

describe('webMercatorToWgs84', () => {
  it('inverse-projects ANM EPSG:3857 metres onto real Romanian geography', () => {
    // Adamclisi, Constanța county — independently known to sit near 44.09 N, 27.96 E.
    expect(webMercatorToWgs84(3113115.07, 5479112.02)).toEqual([27.965588, 44.088268]);
    // Galați (the RO demo region) — near 45.47 N, 28.03 E.
    expect(webMercatorToWgs84(3120099.53, 5695176.06)[0]).toBeCloseTo(28.03, 2);
    expect(webMercatorToWgs84(0, 0)).toEqual([0, 0]);
  });
});

describe('parseVant (Romanian wind string)', () => {
  it('decodes speed + the 16-point ROMANIAN rose, where V = vest = west (not "missing")', () => {
    expect(parseVant('1.6 m/s, directia : VNV')).toEqual({ speedMs: 1.6, dirDeg: 292.5 });
    expect(parseVant('0.9 m/s, directia : N')).toEqual({ speedMs: 0.9, dirDeg: 0 });
    expect(parseVant('1.9 m/s, directia : SSV')).toEqual({ speedMs: 1.9, dirDeg: 202.5 });
    expect(parseVant('3 m/s, directia : V')).toEqual({ speedMs: 3, dirDeg: 270 });
  });

  it('returns an empty result for "indisponibil"/absent, and keeps whichever half is present', () => {
    expect(parseVant('indisponibil')).toEqual({});
    expect(parseVant(null)).toEqual({});
    expect(parseVant('')).toEqual({});
    expect(parseVant('4.2 m/s')).toEqual({ speedMs: 4.2 });
    expect(parseVant('directia : NE')).toEqual({ dirDeg: 45 });
    expect(parseVant('2 m/s, directia : ZZZ')).toEqual({ speedMs: 2 }); // unknown token → no invented bearing
  });
});

describe('anmMapper.toCanonical (golden round-trip on the recorded response)', () => {
  it('maps every recorded station to a WeatherObservation in WGS-84 with decoded values', () => {
    const { rows } = parseAnmObservations(body);
    const obs = rows.map((r) => anmMapper.toCanonical(r, CTX));
    expect(obs).toHaveLength(5);
    expect(obs[0]).toEqual({
      at: '2026-07-02T03:00:00.000Z',
      position: [27.965588, 44.088268],
      windSpeedMs: 1.6,
      windDirDeg: 292.5,
      tempC: 20.5,
      humidityPct: 96,
    });
    for (const o of obs) {
      expect(Number.isNaN(Date.parse(o.at))).toBe(false);
      expect(o.position[0]).toBeGreaterThan(20); // every station inside Romania's longitude band
      expect(o.position[0]).toBeLessThan(30);
      expect(o.position[1]).toBeGreaterThan(43);
      expect(o.position[1]).toBeLessThan(49);
    }
  });

  it('omits (never zero-fills) a variable ANM published as "indisponibil"', () => {
    const raw = {
      at: '2026-07-05T22:00:00.000Z',
      name: 'X',
      easting: 3113115.07,
      northing: 5479112.02,
      tempe: 'indisponibil',
      umezeala: 90,
      vant: 'indisponibil',
    };
    expect(anmMapper.toCanonical(raw, CTX)).toEqual({
      at: '2026-07-05T22:00:00.000Z',
      position: [27.965588, 44.088268],
      humidityPct: 90,
    });
  });

  it('raises a typed PARSE on a station that cannot be placed (defensive ACL boundary)', () => {
    try {
      anmMapper.toCanonical({ at: '2026-07-05T22:00:00Z', name: 'X', easting: Number.NaN, northing: 0 }, CTX);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
