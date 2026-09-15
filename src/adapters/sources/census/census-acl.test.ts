// BEACON — Census ACL tests (E4·T-1xx; PopulationPort P12/adapter-contract §4). The recorded array-of-
// arrays JSON round-trips to valid PopulationEstimate entities for the builtin CA counties; the header
// row is never treated as data; malformed/out-of-scope rows are skipped (not thrown); a row that reaches
// the mapper referencing an unknown county still raises a typed PARSE (never silently accepted).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import {
  CA_COUNTY_CENTROIDS,
  bboxCenter,
  censusMapper,
  parseCensusAcsRows,
  pointInBBox,
} from './census-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/acs.json', import.meta.url)),
  'utf8',
);

describe('parseCensusAcsRows', () => {
  it('skips the header row and parses each builtin-known CA county into a CensusRow', () => {
    const rows = parseCensusAcsRows(json);
    expect(rows).toHaveLength(5); // 5 known counties out of 8 data rows in the fixture
    expect(rows.map((r) => r.county).sort()).toEqual(['007', '021', '067', '101', '113']);
    const butte = rows.find((r) => r.county === '007');
    expect(butte?.population).toBe(208368);
    expect(butte?.name).toContain('Butte');
  });

  it('skips a row with a non-numeric population', () => {
    const rows = parseCensusAcsRows(
      JSON.stringify([
        ['B01003_001E', 'NAME', 'state', 'county'],
        ['N', 'Malformed County, California', '06', '999'],
      ]),
    );
    expect(rows).toEqual([]);
  });

  it('skips a row for a county outside the builtin demo set', () => {
    const rows = parseCensusAcsRows(
      JSON.stringify([
        ['B01003_001E', 'NAME', 'state', 'county'],
        ['21507', 'Colusa County, California', '06', '011'],
      ]),
    );
    expect(rows).toEqual([]);
  });

  it('skips a row with the wrong column count', () => {
    const rows = parseCensusAcsRows(
      JSON.stringify([
        ['B01003_001E', 'NAME', 'state', 'county'],
        ['208368', 'Butte County, California', '06'], // missing county column
      ]),
    );
    expect(rows).toEqual([]);
  });

  it('returns [] for an empty array and for a header-only response', () => {
    expect(parseCensusAcsRows('[]')).toEqual([]);
    expect(
      parseCensusAcsRows(JSON.stringify([['B01003_001E', 'NAME', 'state', 'county']])),
    ).toEqual([]);
  });
});

describe('censusMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture row to a PopulationEstimate boxed around its builtin centroid', () => {
    const rows = parseCensusAcsRows(json);
    const estimates = rows.map((r) =>
      censusMapper.toCanonical(r, { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' }),
    );
    expect(estimates).toHaveLength(5);
    const butteRow = rows.find((r) => r.county === '007');
    expect(butteRow).toBeDefined();
    const butteEstimate = censusMapper.toCanonical(butteRow!, {
      fetchedAt: '2026-07-05T22:00:00Z',
      sourceRecordId: 'sid-1',
    });
    expect(butteEstimate.count).toBe(208368);
    const center = bboxCenter(butteEstimate.area);
    expect(center).toEqual(CA_COUNTY_CENTROIDS['007']);
    expect(pointInBBox(CA_COUNTY_CENTROIDS['007']!, butteEstimate.area)).toBe(true);
  });

  it('raises a typed PARSE when given a row referencing an unknown county (defensive boundary)', () => {
    const bogus = { population: 1, name: 'Nowhere', state: '06', county: '999' };
    try {
      censusMapper.toCanonical(bogus, {
        fetchedAt: '2026-07-05T22:00:00Z',
        sourceRecordId: 'sid-1',
      });
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});

describe('pointInBBox', () => {
  it('is inclusive of the bbox edges', () => {
    expect(pointInBBox([0, 0], [0, 0, 10, 10])).toBe(true);
    expect(pointInBBox([10, 10], [0, 0, 10, 10])).toBe(true);
    expect(pointInBBox([-1, 5], [0, 0, 10, 10])).toBe(false);
  });
});
