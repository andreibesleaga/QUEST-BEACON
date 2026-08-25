import { describe, it, expect } from 'vitest';
import { makeRegion, REGION_SCOPES } from './region.js';
import { InvariantViolation } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { RegionId } from './value-objects/ids.js';
import type { BBox } from './value-objects/geo.js';

const id = asId<RegionId>('11111111-1111-1111-1111-111111111111');
const bbox: BBox = [-123, 37, -121, 39];

describe('makeRegion', () => {
  it('builds a valid region', () => {
    const r = makeRegion({ id, name: 'Bay Area', scope: 'COMMUNITY', bbox, enabledAdapters: ['firms-adapter'] });
    expect(r.scope).toBe('COMMUNITY');
    expect(r.enabledAdapters).toEqual(['firms-adapter']);
  });

  it('defaults enabledAdapters to []', () => {
    expect(makeRegion({ id, name: 'X', scope: 'STATE', bbox }).enabledAdapters).toEqual([]);
  });

  it('accepts every schema scope value', () => {
    for (const scope of REGION_SCOPES) {
      expect(makeRegion({ id, name: 'X', scope, bbox }).scope).toBe(scope);
    }
  });

  it('rejects a scope outside the enum', () => {
    // @ts-expect-error invalid enum at compile time; runtime guard also rejects
    expect(() => makeRegion({ id, name: 'X', scope: 'PLANET', bbox })).toThrow(InvariantViolation);
  });

  it('rejects an empty name', () => {
    expect(() => makeRegion({ id, name: '   ', scope: 'STATE', bbox })).toThrow(InvariantViolation);
  });

  it('rejects an inverted bbox (min > max)', () => {
    expect(() => makeRegion({ id, name: 'X', scope: 'STATE', bbox: [10, 10, 0, 0] })).toThrow(InvariantViolation);
  });

  it('rejects a malformed bbox', () => {
    expect(() => makeRegion({ id, name: 'X', scope: 'STATE', bbox: [1, 2, 3] as unknown as BBox })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a non-string adapter id', () => {
    expect(() =>
      makeRegion({ id, name: 'X', scope: 'STATE', bbox, enabledAdapters: [''] }),
    ).toThrow(InvariantViolation);
  });
});
