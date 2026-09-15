// BEACON — FIRMS ACL tests (E4·T-147/T-151; F1/adapter-contract §4). The recorded CSV round-trips to
// valid HazardGeometry (HOTSPOT) entities; a bad row raises a typed PARSE (never silently dropped);
// acq_date/acq_time map to a valid ISO instant.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { firmsMapper, firmsObservedAt, parseFirmsCsv } from './firms-acl.js';

const csv = readFileSync(
  fileURLToPath(new URL('./__fixtures__/hotspots.csv', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseFirmsCsv', () => {
  it('splits the FIRMS CSV into header-keyed rows', () => {
    const rows = parseFirmsCsv(csv);
    expect(rows.length).toBe(4);
    expect(rows[0]?.latitude).toBe('38.8921');
    expect(rows[0]?.frp).toBe('15.4');
  });

  it('returns [] for empty input', () => {
    expect(parseFirmsCsv('')).toEqual([]);
  });
});

describe('firmsMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture row to a valid HOTSPOT HazardGeometry with provenance sourceId', () => {
    const rows = parseFirmsCsv(csv);
    const geoms = rows.map((r) => firmsMapper.toCanonical(r, ctx));
    expect(geoms).toHaveLength(4);
    for (const g of geoms) {
      expect(g.kind).toBe('HOTSPOT');
      expect(g.geometry.type).toBe('Point');
      expect(g.sourceId).toBe('sid-1');
      expect(Number.isNaN(Date.parse(g.observedAt))).toBe(false);
    }
    const first = geoms[0];
    expect(first?.geometry).toEqual({ type: 'Point', coordinates: [-122.6144, 38.8921] });
    expect(first?.intensity).toBe(15.4); // FRP → intensity
    expect(first?.observedAt).toBe('2026-07-05T21:18:00Z');
  });

  it('raises a typed PARSE on a row with an invalid lat/lon', () => {
    try {
      firmsMapper.toCanonical(
        { latitude: 'NaN', longitude: '', acq_date: '2026-07-05', acq_time: '1200' },
        ctx,
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises PARSE when acq_date is missing', () => {
    expect(() => firmsObservedAt({ acq_time: '1200' })).toThrow();
  });

  it('zero-pads short acq_time', () => {
    expect(firmsObservedAt({ acq_date: '2026-07-05', acq_time: '954' })).toBe(
      '2026-07-05T09:54:00Z',
    );
  });
});
