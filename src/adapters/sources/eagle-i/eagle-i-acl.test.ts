// BEACON — EAGLE-I ACL tests (E4·T-166; adapter-contract §4). The recorded fixture round-trips to valid
// OutageRecord DTOs (area bbox derived from the builtin county-centroid map, customersOut, observedAt);
// structurally malformed rows are SKIPPED and COUNTED at parse time (never silently dropped, never fail
// the whole batch); a well-formed-but-unmappable row (unknown county, bad timestamp) raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { eagleIMapper, parseEagleIRecords } from './eagle-i-acl.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('./__fixtures__/outages.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseEagleIRecords', () => {
  it('parses the 5 well-formed fixture rows with zero skipped', () => {
    const { rows, skipped } = parseEagleIRecords(fixtureText);
    expect(rows).toHaveLength(5);
    expect(skipped).toBe(0);
    expect(rows[0]?.county).toBe('Butte');
    expect(rows[0]?.state).toBe('California');
  });

  it('returns { rows: [], skipped: 0 } for unparseable JSON (no crash)', () => {
    expect(parseEagleIRecords('not json')).toEqual({ rows: [], skipped: 0 });
  });

  it('returns { rows: [], skipped: 0 } when there is no records array', () => {
    expect(parseEagleIRecords('{}')).toEqual({ rows: [], skipped: 0 });
  });

  it('skips and counts structurally malformed rows without dropping the well-formed ones', () => {
    const text = JSON.stringify({
      records: [
        {
          county: 'Butte',
          state: 'California',
          customers_out: 10,
          last_updated: '2026-07-05T21:15:00Z',
        },
        { county: 'Butte', state: 'California', last_updated: '2026-07-05T21:15:00Z' }, // ok: customers_out optional
        { state: 'California', customers_out: 5, last_updated: '2026-07-05T21:15:00Z' }, // malformed: no county
        { county: 'Butte', customers_out: 5, last_updated: '2026-07-05T21:15:00Z' }, // malformed: no state
        { county: 'Butte', state: 'California', customers_out: 5 }, // malformed: no last_updated
        'not-an-object', // malformed
        null, // malformed
      ],
    });
    const { rows, skipped } = parseEagleIRecords(text);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(5);
  });
});

describe('eagleIMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture row to a valid OutageRecord with a centroid-derived area bbox', () => {
    const { rows } = parseEagleIRecords(fixtureText);
    const outages = rows.map((r) => eagleIMapper.toCanonical(r, ctx));
    expect(outages).toHaveLength(5);
    for (const o of outages) {
      expect(o.area).toHaveLength(4);
      expect(Number.isNaN(Date.parse(o.observedAt))).toBe(false);
    }
    const butte = outages[0];
    expect(butte).toBeDefined();
    const area = butte!.area;
    expect(area[0]).toBeCloseTo(-121.7669, 10);
    expect(area[1]).toBeCloseTo(39.4755, 10);
    expect(area[2]).toBeCloseTo(-121.4669, 10);
    expect(area[3]).toBeCloseTo(39.7755, 10); // centroid ± 0.15°
    expect(butte?.customersOut).toBe(4820);
    expect(butte?.observedAt).toBe('2026-07-05T21:15:00Z');
  });

  it('keeps a zero customersOut (falsy but valid) rather than dropping it', () => {
    const { rows } = parseEagleIRecords(fixtureText);
    const sutter = rows.find((r) => r.county === 'Sutter');
    expect(sutter).toBeDefined();
    const outage = eagleIMapper.toCanonical(sutter!, ctx);
    expect(outage.customersOut).toBe(0);
  });

  it('omits customersOut when absent/invalid rather than raising PARSE (it is optional on the DTO)', () => {
    const outage = eagleIMapper.toCanonical(
      {
        county: 'Butte',
        state: 'California',
        last_updated: '2026-07-05T21:15:00Z',
      },
      ctx,
    );
    expect(outage.customersOut).toBeUndefined();
    expect(outage.area).toBeDefined();
  });

  it('raises a typed PARSE when county/state is missing', () => {
    try {
      eagleIMapper.toCanonical({ state: 'California', last_updated: '2026-07-05T21:15:00Z' }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE for a county absent from the builtin centroid map', () => {
    try {
      eagleIMapper.toCanonical(
        { county: 'Los Angeles', state: 'California', last_updated: '2026-07-05T21:15:00Z' },
        ctx,
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE on an invalid last_updated timestamp', () => {
    try {
      eagleIMapper.toCanonical(
        { county: 'Butte', state: 'California', last_updated: 'not-a-date' },
        ctx,
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('normalizes "County" suffix and USPS abbreviation vs. full state name identically', () => {
    const full = eagleIMapper.toCanonical(
      {
        county: 'Butte County',
        state: 'California',
        last_updated: '2026-07-05T21:15:00Z',
      },
      ctx,
    );
    const abbrev = eagleIMapper.toCanonical(
      {
        county: 'Butte',
        state: 'CA',
        last_updated: '2026-07-05T21:15:00Z',
      },
      ctx,
    );
    expect(full.area).toEqual(abbrev.area);
  });
});
