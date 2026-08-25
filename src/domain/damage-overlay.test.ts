// BEACON — damage-overlay product tests (MW-D/D5.5; FR-D4-5, FEV-24).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { InvariantViolation } from './errors.js';
import { findPersonIdentifyingRuntimeKeys } from './shared/aggregate-only.js';
import {
  OVERLAY_PRODUCT_TYPES,
  makeDamageOverlayProduct,
  type MakeDamageOverlayProductInput,
} from './damage-overlay.js';

const FIXTURE = JSON.parse(readFileSync('fixtures/coordination/ems-products.json', 'utf8')) as {
  products: readonly MakeDamageOverlayProductInput[];
};

const VALID: MakeDamageOverlayProductInput = FIXTURE.products[0]!;

describe('makeDamageOverlayProduct', () => {
  it('constructs every fixture product unchanged', () => {
    for (const input of FIXTURE.products) {
      expect(makeDamageOverlayProduct(input)).toEqual(input);
    }
  });

  it('requires attribution, licence and a production date — FEV-24 is an invariant, not a render option', () => {
    expect(() => makeDamageOverlayProduct({ ...VALID, provider: '  ' })).toThrow(/provider must be a non-empty string/);
    expect(() => makeDamageOverlayProduct({ ...VALID, licence: '' })).toThrow(/licence must be a non-empty string/);
    expect(() => makeDamageOverlayProduct({ ...VALID, producedAt: 'soon' })).toThrow(/producedAt must be a valid ISO timestamp/);
    expect(() => makeDamageOverlayProduct({ ...VALID, producedAt: '' })).toThrow(/producedAt must be a valid ISO timestamp/);
  });

  it('requires the identifying product metadata', () => {
    expect(() => makeDamageOverlayProduct({ ...VALID, productId: '' })).toThrow(/productId must be a non-empty string/);
    expect(() => makeDamageOverlayProduct({ ...VALID, activationCode: '' })).toThrow(/activationCode must be a non-empty string/);
    expect(() => makeDamageOverlayProduct({ ...VALID, areaOfInterest: '' })).toThrow(/areaOfInterest must be a non-empty string/);
  });

  it('rejects an unknown product type', () => {
    expect(() =>
      makeDamageOverlayProduct({ ...VALID, productType: 'ASSESSMENT' as 'GRADING' }),
    ).toThrow(InvariantViolation);
    expect(OVERLAY_PRODUCT_TYPES).toEqual(['DELINEATION', 'GRADING']);
  });

  it('enforces the link-only policy on viewUrl (no http, no IP literal, no javascript:)', () => {
    for (const viewUrl of ['http://emergency.copernicus.eu/x', 'https://127.0.0.1/x', 'javascript:alert(1)']) {
      expect(() => makeDamageOverlayProduct({ ...VALID, viewUrl }), viewUrl).toThrow(
        /DamageOverlayProduct\.viewUrl must be an https:\/\/ URL/,
      );
    }
  });
});

describe('aggregate-only + consume-only (Art. XIV; ADR-027/028)', () => {
  it('a MAXIMAL product carries no person-identifying key at runtime (Layer C)', () => {
    expect(findPersonIdentifyingRuntimeKeys(makeDamageOverlayProduct(VALID))).toEqual([]);
  });

  it('carries NO geometry — a foreign product polygon can never reach the exposure engine (the F-48 lesson)', () => {
    const product = makeDamageOverlayProduct(VALID) as unknown as Record<string, unknown>;
    for (const key of ['geom', 'geometry', 'footprint', 'coordinates', 'bbox']) {
      expect(key in product).toBe(false);
    }
  });

  it('the module has no network primitive — consume-only is structural, not a convention', () => {
    const source = readFileSync('src/domain/damage-overlay.ts', 'utf8');
    for (const primitive of ['fetch(', 'XMLHttpRequest', 'axios', 'node:http', 'require(']) {
      expect(source.includes(primitive), primitive).toBe(false);
    }
  });
});
