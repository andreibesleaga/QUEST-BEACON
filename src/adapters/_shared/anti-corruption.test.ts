// BEACON — Anti-corruption runner tests (E4·T-131; adapter-contract §4). Every mapped row pairs with the
// shared provenance; an unmappable row surfaces a typed PARSE (never silently dropped).
import { describe, it, expect } from 'vitest';
import type { AntiCorruptionMapper, MapContext, SourceRecord } from './contract.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import { mapRows } from './anti-corruption.js';
import { makeAdapterError, isAdapterError } from './errors.js';

interface Raw {
  readonly v: string;
}

const ctx: MapContext = { fetchedAt: '2026-07-05T10:00:00Z', sourceRecordId: 'sid-1' };
const provenance: SourceRecord = {
  id: asId<SourceId>('11111111-1111-4111-8111-111111111111'),
  source: 'S',
  adapter: 's',
  fetchedAt: ctx.fetchedAt,
  license: 'Public Domain',
  mode: 'LIVE',
};

const doubler: AntiCorruptionMapper<Raw, number> = {
  toCanonical(raw) {
    const n = Number(raw.v);
    if (!Number.isFinite(n)) throw makeAdapterError('PARSE', `not a number: ${raw.v}`);
    return n * 2;
  },
};

describe('mapRows', () => {
  it('maps every row and attaches the shared provenance', () => {
    const out = mapRows<Raw, number>([{ v: '2' }, { v: '3' }], doubler, ctx, provenance);
    expect(out.map((r) => r.entity)).toEqual([4, 6]);
    expect(out.every((r) => r.provenance === provenance)).toBe(true);
  });

  it('throws a typed PARSE on an unmappable row', () => {
    try {
      mapRows<Raw, number>([{ v: 'x' }], doubler, ctx, provenance);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('wraps a non-adapter throw (e.g. a domain invariant) as PARSE', () => {
    const boom: AntiCorruptionMapper<Raw, number> = {
      toCanonical() {
        throw new Error('invariant broken');
      },
    };
    try {
      mapRows<Raw, number>([{ v: '1' }], boom, ctx, provenance);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(isAdapterError(e) && e.kind).toBe('PARSE');
    }
  });
});
