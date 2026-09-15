// BEACON — OpenCelliD ACL tests (E4·T-13x; adapter-contract §4, TelecomPort P13). The schema-crafted
// fixture (see cells.json header) round-trips to valid TelecomCoverage DTOs ([lon,lat] positions,
// technology passthrough, online always true — static tower DB, no live status); structurally malformed
// cells (missing/invalid lat or lon) are SKIPPED and COUNTED at parse time (never silently dropped, never
// fail the whole batch); a malformed cell handed directly to the mapper still raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { openCelliDMapper, parseOpenCelliDCells } from './opencellid-acl.js';

// Schema-crafted from the documented OpenCelliD `cell/getInArea` (format=json) response shape — NOT a
// captured live response (OpenCelliD is a keyed API; no key is used in tests). 6 cells around Butte
// County, CA (~39.7 lat, -121.8 lon), mixed LTE/NR/UMTS radio types.
const fixtureText = readFileSync(
  fileURLToPath(new URL('./__fixtures__/cells.json', import.meta.url)),
  'utf8',
);
// The mapper implementation omits `ctx` from its own arity (structurally valid — see opencellid-acl.ts),
// but the AntiCorruptionMapper interface still declares it, so call sites must supply it.
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseOpenCelliDCells', () => {
  it('parses the 6 well-formed fixture cells with zero skipped', () => {
    const { rows, skipped } = parseOpenCelliDCells(fixtureText);
    expect(rows).toHaveLength(6);
    expect(skipped).toBe(0);
    expect(rows[0]?.lat).toBe(39.7285);
    expect(rows[0]?.lon).toBe(-121.8375);
    expect(rows[0]?.radio).toBe('LTE');
  });

  it('returns rows: [] when there is no cells array', () => {
    expect(parseOpenCelliDCells('{}')).toEqual({ rows: [], skipped: 0 });
  });

  it('skips and counts structurally malformed cells without dropping the well-formed ones', () => {
    const text = JSON.stringify({
      cells: [
        { lat: 39.7, lon: -121.8, radio: 'LTE' }, // ok
        { lat: 39.71, lon: -121.81, radio: 'NR' }, // ok
        { lat: null, lon: -121.8, radio: 'LTE' }, // malformed: no lat
        { lat: 39.7, lon: 'not-a-number', radio: 'LTE' }, // malformed: bad lon
        { lon: -121.8, radio: 'LTE' }, // malformed: no lat key at all
        'not-an-object', // malformed
        null, // malformed
      ],
    });
    const { rows, skipped } = parseOpenCelliDCells(text);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(5);
  });
});

describe('openCelliDMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture cell to a valid TelecomCoverage with [lon,lat] position and online:true', () => {
    const { rows } = parseOpenCelliDCells(fixtureText);
    const coverage = rows.map((r) => openCelliDMapper.toCanonical(r, ctx));
    expect(coverage).toHaveLength(6);
    for (const c of coverage) {
      expect(c.position).toHaveLength(2);
      expect(c.online).toBe(true);
    }
    const first = coverage[0];
    expect(first?.position).toEqual([-121.8375, 39.7285]); // [lon,lat] — reversed from raw lat/lon
    expect(first?.technology).toBe('LTE');
    const technologies = new Set(coverage.map((c) => c.technology));
    expect(technologies).toEqual(new Set(['LTE', 'NR', 'UMTS']));
  });

  it('omits technology when radio is absent/blank rather than raising PARSE (it is optional on the DTO)', () => {
    const coverage = openCelliDMapper.toCanonical({ lat: 39.7, lon: -121.8 }, ctx);
    expect(coverage.technology).toBeUndefined();
    expect('technology' in coverage).toBe(false);
    expect(coverage.online).toBe(true);
  });

  it('raises a typed PARSE when lat/lon is missing', () => {
    try {
      openCelliDMapper.toCanonical({ radio: 'LTE' }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE on a non-finite lat/lon', () => {
    try {
      openCelliDMapper.toCanonical({ lat: 'NaN', lon: -121.8, radio: 'LTE' }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
