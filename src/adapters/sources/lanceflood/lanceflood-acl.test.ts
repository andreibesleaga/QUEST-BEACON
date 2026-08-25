// BEACON — NASA LANCE NRT flood ACL tests (S2·Lane-A2; F1/adapter-contract §4). The RECORDED REAL
// listing decodes to tile+day granules; malformed entries are dropped AND counted; the derived tile grid
// is pinned against the product's published extremes; the emitted NewsItem states in words that NO flood
// geometry is claimed; leap-year day-of-year arithmetic is exact.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import {
  lanceMapper,
  parseLanceGranules,
  tileBBox,
  tileIntersects,
  yearDayToIso,
} from './lanceflood-acl.js';

const json = readFileSync(fileURLToPath(new URL('./__fixtures__/granules.json', import.meta.url)), 'utf8');
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseLanceGranules', () => {
  it('decodes every recorded granule filename into its tile + composite day', () => {
    const res = parseLanceGranules(json);
    expect(res.granules).toHaveLength(10);
    expect(res.skipped).toBe(0);
    const first = res.granules[0];
    expect(first?.h).toBe(5);
    expect(first?.v).toBe(4);
    expect(first?.dayIso).toBe('2026-08-06'); // A2026218 = day 218 of 2026
  });

  it('drops AND counts entries with an off-convention name or no download link', () => {
    const res = parseLanceGranules(
      JSON.stringify({
        content: [
          { name: 'MCDWD_L3_NRT.A2026219.h05v04.061.hdf' }, // no downloadsLink
          { name: 'README.txt', downloadsLink: 'https://x/README.txt' },
          { name: 'MCDWD_L3_NRT.A2026999.h05v04.061.hdf', downloadsLink: 'https://x/a.hdf' }, // day 999
          { name: 'MCDWD_L3_NRT.A2026219.h06v05.061.hdf', downloadsLink: 'https://x/b.hdf' },
        ],
      }),
    );
    expect(res.granules).toHaveLength(1);
    expect(res.skipped).toBe(3);
  });

  it('also decodes the composite-period variants of the product name (F1C/F2/F3)', () => {
    const res = parseLanceGranules(
      JSON.stringify({
        content: [{ name: 'MCDWD_L3_F3_NRT.A2026219.h20v04.061.hdf', downloadsLink: 'https://x/c.hdf' }],
      }),
    );
    expect(res.granules[0]?.h).toBe(20);
  });

  it('returns an empty result for a body with no content array', () => {
    expect(parseLanceGranules('{}')).toEqual({ granules: [], skipped: 0 });
  });
});

describe('MCDWD tile grid (derived from the live listing + the product title — see the ACL header)', () => {
  it('places h00v01 and h35v14 at the product coverage extremes (80°N to 60°S)', () => {
    expect(tileBBox(0, 1)).toEqual([-180, 70, -170, 80]);
    expect(tileBBox(35, 14)).toEqual([170, -60, 180, -50]);
  });

  it('places the California and Romania tiles where those countries actually are', () => {
    expect(tileBBox(5, 4)).toEqual([-130, 40, -120, 50]); // N California / Oregon
    expect(tileBBox(6, 5)).toEqual([-120, 30, -110, 40]); // SE California / Nevada
    expect(tileBBox(20, 4)).toEqual([20, 40, 30, 50]); // Romania
  });

  it('treats an edge-touching bbox as an overlap and a disjoint one as no overlap', () => {
    const ca: readonly [number, number, number, number] = [-124.5, 32.5, -114, 42.1];
    expect(tileIntersects(5, 4, ca)).toBe(true);
    expect(tileIntersects(6, 5, ca)).toBe(true);
    expect(tileIntersects(20, 4, ca)).toBe(false);
    expect(tileIntersects(5, 4, [-130, 50, -120, 60])).toBe(true); // shares the 50°N edge
  });
});

describe('yearDayToIso', () => {
  it('is leap-year correct by construction', () => {
    expect(yearDayToIso(2026, 218)).toBe('2026-08-06');
    expect(yearDayToIso(2024, 60)).toBe('2024-02-29'); // leap year
    expect(yearDayToIso(2023, 60)).toBe('2023-03-01'); // non-leap
    expect(yearDayToIso(2024, 366)).toBe('2024-12-31');
  });

  it('rejects an out-of-range day rather than silently shifting the date', () => {
    expect(yearDayToIso(2023, 366)).toBeUndefined();
    expect(yearDayToIso(2026, 0)).toBeUndefined();
    expect(yearDayToIso(2026, 400)).toBeUndefined();
    expect(yearDayToIso(Number.NaN, 10)).toBeUndefined();
  });
});

describe('lanceMapper.toCanonical (golden round-trip over the recorded listing)', () => {
  it('maps each granule to an OFFICIAL availability advisory that DISCLAIMS any flood geometry', () => {
    const { granules } = parseLanceGranules(json);
    const items = granules.map((g) => lanceMapper.toCanonical(g, ctx));
    expect(items).toHaveLength(10);
    const first = items[0];
    expect(first?.title).toBe('NASA LANCE NRT observed-flood product available — tile h05v04 (2026-08-06)');
    expect(first?.publishedAt).toBe('2026-08-06T00:00:00Z');
    expect(first?.sourceAuthority).toBe('OFFICIAL');
    expect(first?.credibility).toBe(0.9);
    expect(first?.url).toContain('MCDWD_L3_NRT.A2026218.h05v04.061');
    expect(first?.summary).toContain('-130,40 to -120,50');
    expect(first?.summary).toContain('no flood geometry is claimed from this source');
    expect(first?.summary).toContain('Earthdata Login token');
  });

  it('raises a typed PARSE for a granule with no download link', () => {
    try {
      lanceMapper.toCanonical({ granule: { name: 'x.hdf' }, h: 5, v: 4, dayIso: '2026-08-06' }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
