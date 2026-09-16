// BEACON — WorldPop ACL tests (E4·T-worldpop; adapter-contract §4, PopulationPort P12). The recorded
// stats-API response maps to a valid PopulationEstimate bound to the queried bbox, with a deterministic
// rounded count; an upstream task error or a missing/invalid total_population raises a typed PARSE
// (never silently dropped, never a fabricated count — Art. XII).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { worldPopMapper, parseWorldPopResponse } from './worldpop-acl.js';
import type { WorldPopRaw } from './worldpop-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/population.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-15T09:02:34Z', sourceRecordId: 'sid-1' };
const bbox = [-121.9, 39.4, -121.35, 39.85] as const;

describe('parseWorldPopResponse', () => {
  it('parses the recorded stats-API body', () => {
    const body = parseWorldPopResponse(json);
    expect(body.status).toBe('started');
    expect(body.error).toBe(false);
    expect(body.data?.total_population).toBeCloseTo(215182.79);
  });
});

describe('worldPopMapper.toCanonical (golden round-trip)', () => {
  it('maps the recorded response to a PopulationEstimate bound to the queried bbox, count rounded', () => {
    const body = parseWorldPopResponse(json);
    const raw: WorldPopRaw = { ...body, bbox };
    const est = worldPopMapper.toCanonical(raw, ctx);
    expect(est.area).toEqual(bbox);
    expect(est.count).toBe(215183); // Math.round(215182.79)
    expect(Number.isInteger(est.count)).toBe(true);
  });

  it('raises a typed PARSE when data.total_population is missing', () => {
    const raw: WorldPopRaw = { status: 'finished', error: false, data: {}, bbox };
    try {
      worldPopMapper.toCanonical(raw, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE when the upstream task reports an error', () => {
    const raw: WorldPopRaw = {
      status: 'error',
      error: true,
      error_message: 'no data intersects the AOI',
      bbox,
    };
    expect(() => worldPopMapper.toCanonical(raw, ctx)).toThrow();
  });

  it('raises a typed PARSE on a negative total_population', () => {
    const raw: WorldPopRaw = { error: false, data: { total_population: -5 }, bbox };
    expect(() => worldPopMapper.toCanonical(raw, ctx)).toThrow();
  });

  it('raises a typed PARSE on a non-finite total_population', () => {
    const raw: WorldPopRaw = { error: false, data: { total_population: Number.NaN }, bbox };
    expect(() => worldPopMapper.toCanonical(raw, ctx)).toThrow();
  });
});
