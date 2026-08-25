// BEACON — HDX COD-PS ACL tests (S2·Lane A3; adapter-contract §4, P12). The RECORDED REAL COD-PS CSV
// round-trips to valid PopulationEstimates; the 67 age/sex band columns are ignored, not folded into the
// count; unknown columns are ignored (LENIENT); mis-shaped/unplaceable/non-numeric rows are dropped AND
// COUNTED; a row that reaches the mapper unplaceable raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import {
  RO_ADM1_CENTROIDS,
  bboxCenter,
  hdxPopMapper,
  parseHdxPopCsv,
  pointInBBox,
} from './hdxpop-acl.js';

const csv = readFileSync(
  fileURLToPath(new URL('./__fixtures__/rou-admpop-adm1.csv', import.meta.url)),
  'utf8',
);
const CTX = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-hdxpop' };

describe('parseHdxPopCsv', () => {
  it("reads the recorded resource's 8 NUTS-2 regions, keeping only P-code + total (BOM stripped)", () => {
    const { rows, skipped } = parseHdxPopCsv(csv);
    expect(rows).toHaveLength(8);
    expect(skipped).toBe(0);
    expect(rows[0]).toEqual({ pcode: 'RO006', name: 'Nord-Vest', total: 2514357 });
    // Σ of the recorded totals ≈ Romania's 2021 census population — the file was not silently truncated.
    const total = rows.reduce((s, r) => s + r.total, 0);
    expect(total).toBe(18983507);
  });

  it('ignores unknown/extra columns rather than failing (LENIENT — COD-PS gains columns per vintage)', () => {
    const text = 'ADM1_PCODE,ADM1_RO,T_TL,SOME_NEW_2027_COLUMN\nRO008,București-Ilfov,2318824,whatever\n';
    const { rows, skipped } = parseHdxPopCsv(text);
    expect(skipped).toBe(0);
    expect(rows).toEqual([{ pcode: 'RO008', name: 'București-Ilfov', total: 2318824 }]);
  });

  it('DROPS AND COUNTS rows that are mis-shaped, unplaceable, or non-numeric', () => {
    const text = [
      'ADM1_PCODE,ADM1_RO,T_TL',
      'RO005,Vest,1745587', // good
      'RO005,Vest', // wrong cell count → never mis-keyed into columns
      'XX999,Atlantis,1000', // P-code with no builtin centroid → unplaceable
      ',Anonymous,1000', // no P-code
      'RO004,Sud-Vest,not-a-number', // non-numeric total
      'RO004,Sud-Vest,-5', // negative population
    ].join('\n');
    const { rows, skipped } = parseHdxPopCsv(text);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(5);
  });

  it('returns an empty result for an empty/headerless body instead of throwing', () => {
    expect(parseHdxPopCsv('')).toEqual({ rows: [], skipped: 0 });
    expect(parseHdxPopCsv('\n\n')).toEqual({ rows: [], skipped: 0 });
  });
});

describe('hdxPopMapper.toCanonical (golden round-trip on the recorded resource)', () => {
  it('maps every recorded region to a PopulationEstimate placed by its builtin centroid', () => {
    const { rows } = parseHdxPopCsv(csv);
    const estimates = rows.map((r) => hdxPopMapper.toCanonical(r, CTX));
    expect(estimates).toHaveLength(8);
    expect(estimates[0]).toEqual({ area: [22.3, 46.0, 24.3, 48.0], count: 2514357 }); // RO006 Nord-Vest
    for (const e of estimates) {
      expect(e.count).toBeGreaterThan(0);
      expect(bboxCenter(e.area)[0]).toBeGreaterThan(20); // every centroid inside Romania's lon/lat band
      expect(bboxCenter(e.area)[0]).toBeLessThan(30);
      expect(bboxCenter(e.area)[1]).toBeGreaterThan(43);
      expect(bboxCenter(e.area)[1]).toBeLessThan(49);
    }
  });

  it('carries the total straight through — the 67 age/sex bands never alter the count (Art. XII)', () => {
    const { rows } = parseHdxPopCsv(csv);
    const bucuresti = rows.find((r) => r.pcode === 'RO008');
    expect(hdxPopMapper.toCanonical(bucuresti!, CTX).count).toBe(2318824); // === T_TL, verbatim
  });

  it('raises a typed PARSE on a row with no builtin centroid (defensive ACL boundary)', () => {
    try {
      hdxPopMapper.toCanonical({ pcode: 'ZZ000', name: 'Nowhere', total: 1 }, CTX);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});

describe('bbox helpers', () => {
  it('recovers a region centroid from its stored area and tests inclusive membership', () => {
    expect(bboxCenter([22.3, 46.0, 24.3, 48.0])).toEqual([23.3, 47.0]);
    expect(pointInBBox([23.3, 47.0], [22, 46, 25, 48])).toBe(true);
    expect(pointInBBox([23.3, 47.0], [22, 46, 23, 48])).toBe(false);
    expect(pointInBBox([22, 46], [22, 46, 25, 48])).toBe(true); // bounds are inclusive
  });

  it('publishes exactly the 8 Romanian NUTS-2 P-codes the recorded resource contains', () => {
    expect(Object.keys(RO_ADM1_CENTROIDS).sort()).toEqual([
      'RO001', 'RO002', 'RO003', 'RO004', 'RO005', 'RO006', 'RO007', 'RO008',
    ]);
  });
});
