// BEACON — ITU ACL tests (TelecomPort P13; adapter-contract §4). The recorded (schema-crafted) rows
// round-trip to valid TelecomCoverage entities at region-centroid positions; a malformed row raises a
// typed PARSE (never silently dropped); the honest aggregate-connectivity semantics hold (online:true,
// technology:'aggregate-connectivity').
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import { ituMapper, parseItuRows } from './itu-acl.js';
import type { ItuConnectivityRow } from './itu-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/connectivity.json', import.meta.url)),
  'utf8',
);

describe('parseItuRows', () => {
  it('parses the fixture rows array', () => {
    const rows = parseItuRows(json);
    expect(rows.length).toBe(4);
    expect(rows[0]?.area).toBe('US-CA');
  });

  it('returns [] when the document has no rows array', () => {
    expect(parseItuRows('{}')).toEqual([]);
  });
});

describe('ituMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture row to a TelecomCoverage at the region centroid with honest aggregate semantics', () => {
    const rows = parseItuRows(json);
    const ctx = { fetchedAt: '2026-07-15T00:00:00Z', sourceRecordId: 'sid-1' };
    const coverage = rows.map((r) => ituMapper.toCanonical(r, ctx));
    expect(coverage).toHaveLength(4);
    for (const c of coverage) {
      expect(c.online).toBe(true);
      expect(c.technology).toBe('aggregate-connectivity');
    }
    expect(coverage[0]).toEqual({
      position: [-119.4179, 36.7783],
      technology: 'aggregate-connectivity',
      online: true,
    });
    const ro = coverage[2];
    expect(ro?.position).toEqual([24.9668, 45.9432]);
  });

  it('raises a typed PARSE on a row with a missing/invalid centroid', () => {
    const bad: ItuConnectivityRow = { area: 'ZZ', internetPenetration: 0.5, mobileCoverage: 0.5 };
    try {
      ituMapper.toCanonical(bad, { fetchedAt: '2026-07-15T00:00:00Z', sourceRecordId: 'sid-1' });
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE on a row with a missing area code', () => {
    const bad: ItuConnectivityRow = {
      centroid: [0, 0],
      internetPenetration: 0.5,
      mobileCoverage: 0.5,
    };
    expect(() =>
      ituMapper.toCanonical(bad, { fetchedAt: '2026-07-15T00:00:00Z', sourceRecordId: 'sid-1' }),
    ).toThrow();
  });

  it('raises a typed PARSE on an out-of-range indicator fraction', () => {
    const bad: ItuConnectivityRow = {
      area: 'ZZ',
      centroid: [0, 0],
      internetPenetration: 1.5,
      mobileCoverage: 0.5,
    };
    try {
      ituMapper.toCanonical(bad, { fetchedAt: '2026-07-15T00:00:00Z', sourceRecordId: 'sid-1' });
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
