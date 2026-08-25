// BEACON — visibleGeometry RBAC tests (E8·T-370; Art. XIV). Precise geometry is revealed ONLY to a
// responder-or-above role; PUBLIC always sees the generalized position.
import { describe, it, expect } from 'vitest';
import { isPreciseVisible, visibleGeometry } from './geometry.js';
import type { GeoFeature } from './types.js';

const feature: GeoFeature = {
  id: 'sos-1',
  position: [-120.0, 38.0], // generalized (coarsened)
  precisePosition: [-120.123, 38.456], // responder-only
};

describe('visibleGeometry (precise-PII gating, T-370)', () => {
  it('hides precise geometry from PUBLIC (returns the generalized position)', () => {
    expect(visibleGeometry(feature, 'PUBLIC')).toEqual([-120.0, 38.0]);
  });

  it('reveals precise geometry to RESPONDER', () => {
    expect(visibleGeometry(feature, 'RESPONDER')).toEqual([-120.123, 38.456]);
  });

  it('reveals precise geometry to VERIFIER and EM (responder-or-above)', () => {
    expect(visibleGeometry(feature, 'VERIFIER')).toEqual([-120.123, 38.456]);
    expect(visibleGeometry(feature, 'EM')).toEqual([-120.123, 38.456]);
  });

  it('falls back to the generalized position when no precise geometry exists', () => {
    const noPrecise: GeoFeature = { id: 'x', position: [-121, 39] };
    expect(visibleGeometry(noPrecise, 'RESPONDER')).toEqual([-121, 39]);
  });

  it('isPreciseVisible tracks the responder gate', () => {
    expect(isPreciseVisible('PUBLIC')).toBe(false);
    expect(isPreciseVisible('RESPONDER')).toBe(true);
    expect(isPreciseVisible('EM')).toBe(true);
  });
});
