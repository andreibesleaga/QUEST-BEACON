// BEACON — FR-D6-2 relief SUPPLY aggregate fields (ADR-035 §4; FEATURE_D6_SUPPLIES).
// A supply lot is stock: how much, in what unit, expiring when. `SUPPLY` already exists in RESOURCE_KINDS
// (src/domain/resource.ts:9), so FR-D6-2 adds three optional fields and no new kind.
//
// PERMANENTLY OUT, restated at the code rather than only in the ADR so it cannot creep back as a small
// addition: NO donor field and NO payment field, ever (ADR-035 §4; CURRENT-MASTER-PLAN.md:123-124). This is
// not a convention here — `donor`, `donorId`, `payment`, `amount`, `cardNumber`, `iban` and `account` are all
// in PERSON_IDENTIFYING_KEYS, so `AggregateOnly<SupplyFields>` (the return type below) makes adding one a
// `tsc --noEmit` error, schemas/d6-supply.schema.json makes it a Layer B test failure, and the runtime walk
// makes it a Layer C failure. The quantity field is deliberately `quantity`, not `amount`, for that reason.
//
// SCOPE, stated so the claim is not read as more than it is: this module owns the NEW aggregate fields only.
// It does NOT wire supplies into `rankByExtent` (src/application/pre-positioning/pre-positioning.ts:118) —
// that is a pre-existing file this lane does not own. ADR-035 §4's own honest scope note applies unchanged:
// there is no generic capacity-vs-demand matcher in this codebase, and this module does not add one.
import supplySchema from '../../../schemas/d6-supply.schema.json';
import type { AggregateOnly } from '@/domain/shared/aggregate-only.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { definedOnly } from '@/domain/shared/guard.js';

/** Stock units. Drift-guarded against the schema `enum` in d6-modules-aggregate-only.test.ts. */
export const SUPPLY_UNITS = ['EACH', 'CASE', 'PALLET', 'LITRE', 'KILOGRAM'] as const;
export type SupplyUnit = (typeof SUPPLY_UNITS)[number];

/** The `SUPPLY` discriminator, READ from the schema rather than retyped beside it. */
const SUPPLY_KIND = supplySchema.properties.kind.const;

export interface SupplyFields {
  readonly kind: 'SUPPLY';
  /** AGGREGATE stock count of the lot, in `unit`. An integer count — never a currency value. */
  readonly quantity?: number;
  readonly unit?: SupplyUnit;
  /** ISO-8601 UTC expiry of the lot. A property of the STOCK; no recipient is modelled or retained. */
  readonly expiresAt?: string;
}

export interface MakeSupplyFieldsInput {
  readonly quantity?: number;
  readonly unit?: SupplyUnit;
  readonly expiresAt?: string;
}

function checkQuantity(quantity: number | undefined): string | null {
  if (quantity === undefined) return null;
  return Number.isInteger(quantity) && quantity >= 0
    ? null
    : 'SupplyFields.quantity must be a non-negative integer (a stock count, never a currency amount)';
}

function checkUnit(unit: SupplyUnit | undefined): string | null {
  if (unit === undefined) return null;
  return SUPPLY_UNITS.includes(unit) ? null : `SupplyFields.unit must be one of ${SUPPLY_UNITS.join('|')}`;
}

/** A quantity without a unit is an uninterpretable number — reject rather than guess a unit. */
function checkQuantityHasUnit(input: MakeSupplyFieldsInput): string | null {
  return input.quantity !== undefined && input.unit === undefined
    ? 'SupplyFields.quantity requires a unit — a bare number is not a comparable stock figure'
    : null;
}

function checkExpiresAt(expiresAt: string | undefined): string | null {
  if (expiresAt === undefined) return null;
  return Number.isNaN(Date.parse(expiresAt))
    ? `SupplyFields.expiresAt must be an ISO-8601 instant, got ${expiresAt}`
    : null;
}

/**
 * Build the FR-D6-2 aggregate fields for a supply lot. `AggregateOnly<SupplyFields>` is the Layer A
 * assertion in load-bearing position: adding a `donor`/`payment`/`amount` field to the DTO above stops this
 * function compiling.
 */
export function makeSupplyFields(
  input: MakeSupplyFieldsInput,
): Result<AggregateOnly<SupplyFields>, DomainError> {
  const problem =
    checkQuantity(input.quantity) ??
    checkUnit(input.unit) ??
    checkQuantityHasUnit(input) ??
    checkExpiresAt(input.expiresAt);
  if (problem !== null) return err(new DomainError('INVARIANT_VIOLATION', problem));
  return ok(
    definedOnly({
      kind: SUPPLY_KIND,
      quantity: input.quantity,
      unit: input.unit,
      expiresAt: input.expiresAt,
    }) as SupplyFields,
  );
}
