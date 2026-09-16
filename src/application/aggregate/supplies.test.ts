// BEACON — FR-D6-2 relief SUPPLY aggregate fields (ADR-035 §4), incl. this module's Layer C exercise.
import { describe, it, expect } from 'vitest';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { makeSupplyFields, SUPPLY_UNITS, type SupplyFields, type SupplyUnit } from './supplies.js';

const FIXED_EXPIRY = '2026-07-05T22:00:00.000Z'; // fixed clock — no wall-clock dependence

function maximalSupplyFields(): SupplyFields {
  const res = makeSupplyFields({ quantity: 240, unit: 'CASE', expiresAt: FIXED_EXPIRY });
  if (!res.ok) throw res.error;
  return res.value;
}

describe('makeSupplyFields (FR-D6-2)', () => {
  it('builds the maximal aggregate shape', () => {
    expect(maximalSupplyFields()).toEqual({
      kind: 'SUPPLY',
      quantity: 240,
      unit: 'CASE',
      expiresAt: FIXED_EXPIRY,
    });
  });

  it('omits absent optionals entirely (only the kind discriminator remains)', () => {
    const res = makeSupplyFields({});
    expect(res.ok ? Object.keys(res.value) : []).toEqual(['kind']);
  });

  it('rejects a non-integer or negative quantity (a stock count, never a currency amount)', () => {
    expect(makeSupplyFields({ quantity: -1, unit: 'EACH' }).ok).toBe(false);
    expect(makeSupplyFields({ quantity: 1.5, unit: 'EACH' }).ok).toBe(false);
    expect(makeSupplyFields({ quantity: 0, unit: 'EACH' }).ok).toBe(true); // an emptied lot is still a fact
  });

  it('rejects a unit outside the enum', () => {
    const res = makeSupplyFields({ unit: 'TRUCKLOAD' as SupplyUnit });
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.message).toMatch(/EACH\|CASE\|PALLET\|LITRE\|KILOGRAM/);
  });

  it('rejects a quantity with no unit — a bare number is not a comparable stock figure', () => {
    const res = makeSupplyFields({ quantity: 12 });
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.message).toMatch(/requires a unit/);
  });

  it('accepts a unit with no quantity (a lot whose count is not yet known)', () => {
    expect(makeSupplyFields({ unit: 'PALLET' }).ok).toBe(true);
  });

  it('rejects an unparseable expiresAt', () => {
    const res = makeSupplyFields({ expiresAt: 'next tuesday' });
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.message).toMatch(/ISO-8601/);
  });

  it('accepts every declared unit', () => {
    for (const unit of SUPPLY_UNITS) expect(makeSupplyFields({ unit, quantity: 1 }).ok).toBe(true);
  });

  // ── Layer C ────────────────────────────────────────────────────────────────────────────────────────────
  it('Layer C: the MAXIMAL factory output carries no person-identifying key', () => {
    expect(findPersonIdentifyingRuntimeKeys(maximalSupplyFields())).toEqual([]);
  });

  it('Layer C: a donation-shaped spread over the maximal output IS caught (donor/payment are PERMANENTLY OUT)', () => {
    const polluted = {
      ...maximalSupplyFields(),
      donorId: 'd-1',
      payment: { amount: 100, iban: 'XX' },
    };
    expect(findPersonIdentifyingRuntimeKeys(polluted)).toEqual([
      'donorId',
      'payment',
      'payment.amount',
      'payment.iban',
    ]);
  });
});
