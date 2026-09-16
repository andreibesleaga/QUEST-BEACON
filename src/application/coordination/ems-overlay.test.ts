// BEACON — Copernicus-EMS damage-overlay tests (MW-D/D5.5; FR-D4-5, FEV-24, V16).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeDamageOverlayProduct } from '@/domain/damage-overlay.js';
import type {
  DamageOverlayProduct,
  MakeDamageOverlayProductInput,
} from '@/domain/damage-overlay.js';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { EMS_OVERLAY_CAVEAT, buildEmsOverlay } from './ems-overlay.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateOverlay = ajv.compile(
  JSON.parse(readFileSync('schemas/d5-ems-overlay.schema.json', 'utf8')) as object,
);

const FIXTURE = JSON.parse(readFileSync('fixtures/coordination/ems-products.json', 'utf8')) as {
  products: readonly MakeDamageOverlayProductInput[];
};

// Through the REAL domain factory: attribution/licence/production-date invariants hold on every product.
const PRODUCTS: readonly DamageOverlayProduct[] = FIXTURE.products.map((p) =>
  makeDamageOverlayProduct(p),
);

/** The project's fixed test instant — injected, never read from a wall clock. */
const AS_OF = '2026-07-05T22:00:00Z';

function overlay(asOf = AS_OF) {
  const res = buildEmsOverlay({ products: PRODUCTS, asOf });
  if (!res.ok) throw res.error;
  return res.value;
}

describe('buildEmsOverlay', () => {
  it('renders every published product as a dated, attributed card, oldest first', () => {
    expect(overlay().products.map((c) => c.productId)).toEqual([
      'EMSR773_AOI01_DEL_PRODUCT_r1',
      'EMSR773_AOI02_GRA_PRODUCT_r1',
    ]);
    expect(overlay().products[0]!.linkOnly).toBe(true);
  });

  it('labels each card with its PRODUCTION date and age in whole days (FEV-24)', () => {
    const [delineation, grading] = overlay().products;
    expect(delineation!.ageDays).toBe(2);
    expect(delineation!.productionLabel).toBe(
      'Copernicus Emergency Management Service DELINEATION product EMSR773_AOI01_DEL_PRODUCT_r1 — ' +
        'produced 2026-07-03T08:00:00Z (2 days before this view).',
    );
    expect(grading!.ageDays).toBe(1);
    expect(grading!.productionLabel).toMatch(/\(1 day before this view\)\.$/); // singular, not "1 days"
  });

  it('publishes the distinct provider — licence credits for the render sites', () => {
    expect(overlay().attribution).toEqual([
      'Copernicus Emergency Management Service — CC BY 4.0 — © European Union, Copernicus EMS',
    ]);
  });

  it('EXCLUDES a future-dated product with its reason instead of showing a negative age', () => {
    expect(overlay().rejected).toEqual([
      {
        productId: 'EMSR773_AOI03_DEL_PRODUCT_r2',
        reason: 'PRODUCED_AFTER_AS_OF',
        producedAt: '2026-07-09T09:00:00Z',
      },
    ]);
    expect(overlay().products.every((c) => c.ageDays >= 0)).toBe(true);
  });

  it('refuses an unusable as-of instant rather than emitting NaN ages', () => {
    const res = buildEmsOverlay({ products: PRODUCTS, asOf: 'whenever' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PARSE_ERROR');
    expect(res.error.message).toMatch(/asOf must be a valid ISO timestamp/);
  });

  it('is deterministic and total — no products yields an empty, labelled overlay', () => {
    expect(overlay()).toEqual(overlay());
    const empty = buildEmsOverlay({ products: [], asOf: AS_OF });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.value.products).toEqual([]);
    expect(empty.value.attribution).toEqual([]);
    expect(empty.value.caveat).toBe(EMS_OVERLAY_CAVEAT);
  });

  it('orders same-day products by product id (a total order, no ties left to insertion chance)', () => {
    const sameDay = ['b-product', 'a-product'].map((productId) =>
      makeDamageOverlayProduct({ ...FIXTURE.products[0]!, productId }),
    );
    const res = buildEmsOverlay({ products: sameDay, asOf: AS_OF });
    expect(res.ok && res.value.products.map((c) => c.productId)).toEqual([
      'a-product',
      'b-product',
    ]);
  });

  it('states the consume-only / no-rehost doctrine on the overlay itself', () => {
    expect(overlay().caveat).toBe(EMS_OVERLAY_CAVEAT);
    expect(EMS_OVERLAY_CAVEAT).toMatch(/does not rehost/);
    expect(EMS_OVERLAY_CAVEAT).toMatch(/never requests a mapping activation/);
  });

  it('validates against schemas/d5-ems-overlay.schema.json and carries no person-identifying key', () => {
    expect(validateOverlay(overlay()), JSON.stringify(validateOverlay.errors)).toBe(true);
    expect(findPersonIdentifyingRuntimeKeys(overlay())).toEqual([]);
  });

  it('has no network primitive anywhere in the module (consume-only is structural)', () => {
    const source = readFileSync('src/application/coordination/ems-overlay.ts', 'utf8');
    for (const primitive of ['fetch(', 'XMLHttpRequest', 'axios', 'node:http', 'require(']) {
      expect(source.includes(primitive), primitive).toBe(false);
    }
  });
});
