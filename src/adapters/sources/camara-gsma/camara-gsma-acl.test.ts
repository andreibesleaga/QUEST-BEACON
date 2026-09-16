// BEACON — CAMARA/GSMA ACL tests (TelecomPort P13; adapter-contract §4, Art. XIV). The recorded rows
// round-trip to valid TelecomCoverage entities; a malformed row raises a typed PARSE (never silently
// dropped); the canonical output carries no personal identifier (aggregate-only, Art. XIV).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import { camaraGsmaMapper, parseCamaraGsmaRows } from './camara-gsma-acl.js';
import type { CamaraGsmaRow } from './camara-gsma-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/coverage.json', import.meta.url)),
  'utf8',
);

describe('parseCamaraGsmaRows', () => {
  it('parses the fixture rows array', () => {
    const rows = parseCamaraGsmaRows(json);
    expect(rows.length).toBe(4);
    expect(rows[0]?.cellId).toBe('sf-bay-0001');
  });

  it('returns [] when the document has no rows array', () => {
    expect(parseCamaraGsmaRows('{}')).toEqual([]);
  });
});

describe('camaraGsmaMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture row to a valid TelecomCoverage', () => {
    const rows = parseCamaraGsmaRows(json);
    const coverage = rows.map((r) =>
      camaraGsmaMapper.toCanonical(r, {
        fetchedAt: '2026-07-15T00:00:00Z',
        sourceRecordId: 'sid-1',
      }),
    );
    expect(coverage).toHaveLength(4);
    const normal = coverage[0];
    expect(normal).toEqual({ position: [-122.44, 37.765], technology: '5G+4G', online: true });
    const degraded = coverage[1];
    expect(degraded?.online).toBe(true);
    expect(degraded?.technology).toBe('4G');
    const offline = coverage[2];
    expect(offline?.online).toBe(false);
    expect(offline?.technology).toBeUndefined(); // empty networkTypes → no technology claimed
  });

  it('raises a typed PARSE on a row missing aggregateOnly:true (Art. XIV privacy invariant)', () => {
    const bad: CamaraGsmaRow = {
      cellId: 'x',
      position: [-122, 37],
      connectivityStatus: 'NORMAL',
      aggregateOnly: false,
    };
    try {
      camaraGsmaMapper.toCanonical(bad, {
        fetchedAt: '2026-07-15T00:00:00Z',
        sourceRecordId: 'sid-1',
      });
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE on a row with an invalid/missing position', () => {
    const bad: CamaraGsmaRow = { cellId: 'x', connectivityStatus: 'NORMAL', aggregateOnly: true };
    expect(() =>
      camaraGsmaMapper.toCanonical(bad, {
        fetchedAt: '2026-07-15T00:00:00Z',
        sourceRecordId: 'sid-1',
      }),
    ).toThrow();
  });

  it('raises a typed PARSE on a row with an invalid connectivityStatus', () => {
    const bad: CamaraGsmaRow = {
      cellId: 'x',
      position: [-122, 37],
      connectivityStatus: 'BOGUS',
      aggregateOnly: true,
    };
    try {
      camaraGsmaMapper.toCanonical(bad, {
        fetchedAt: '2026-07-15T00:00:00Z',
        sourceRecordId: 'sid-1',
      });
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('never emits a personal identifier — canonical output is exactly {position, technology?, online} (Art. XIV)', () => {
    const rows = parseCamaraGsmaRows(json);
    const coverage = rows.map((r) =>
      camaraGsmaMapper.toCanonical(r, {
        fetchedAt: '2026-07-15T00:00:00Z',
        sourceRecordId: 'sid-1',
      }),
    );
    const allowedKeys = new Set(['position', 'technology', 'online']);
    for (const c of coverage) {
      for (const key of Object.keys(c)) {
        expect(allowedKeys.has(key)).toBe(true);
      }
    }
    // No cellId, subscriber id, device id, MSISDN/IMSI, or any raw CAMARA identifier survives the ACL.
    const serialized = JSON.stringify(coverage);
    expect(serialized).not.toMatch(/cellId|msisdn|imsi|subscriber|deviceId/i);
  });
});
