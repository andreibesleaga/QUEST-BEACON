// BEACON — FR-D6-5 aggregate CASUALTY TALLY (ADR-035 §4; FEATURE_D6_CASUALTY_TALLY).
// A COUNT, never a record. There is no row per person here: no name, no age, no gender, no triage tag, no
// injury description, no medical detail — individual medical/triage data is PERMANENTLY OUT of scope
// (ADR-035 §4), and `age`, `gender`, `patientId`, `medicalRecord`, `diagnosis`, `triageTag`, `injuries` and
// `bloodType` are all in PERSON_IDENTIFYING_KEYS, so `AggregateOnly<CasualtyTally>` (the factory's return
// type) makes adding one a `tsc --noEmit` error naming the key (Layer A).
//
// THE LABEL TRAVELS WITH THE NUMBER. ADR-035 §4 requires the caveat "unverified — not authoritative" at
// EVERY render and export site. Writing it beside the number at each site is exactly how a caveat gets
// dropped by the next mapper that copies only `count`; so it is a REQUIRED FIELD of the value itself, its
// string is READ from schemas/d6-casualty-tally.schema.json (one definition in the repo, not two), and the
// schema pins it with `const` so no surface can soften the wording.
//
// HONEST LIMITATION: the four guard layers constrain the SHAPE of this object. They cannot make the number
// true. A tally is field-reported, unverified, and never authoritative — which is what `label` and
// `authoritative:false` say, structurally, to every consumer.
import casualtyTallySchema from '../../../schemas/d6-casualty-tally.schema.json';
import type { AggregateOnly } from '@/domain/shared/aggregate-only.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { definedOnly } from '@/domain/shared/guard.js';

/** The mandatory caveat, DERIVED from the schema's `const` — never a second copy of the string. */
export const CASUALTY_TALLY_LABEL: string = casualtyTallySchema.properties.label.const;

/** Structural restatement of the caveat for consumers that branch rather than render. Always `false`. */
export const CASUALTY_TALLY_AUTHORITATIVE = false;

export interface CasualtyTally {
  /** Id of the damage REPORT this tally summarises — an entity id, never `reporterId` (a person). */
  readonly reportId?: string;
  /** Site-level aggregate count. Zero is meaningful ("none observed here") and is preserved. */
  readonly count: number;
  /** ISO-8601 UTC observation instant, supplied by the caller from the injected clock. */
  readonly asOf?: string;
  readonly label: string;
  readonly authoritative: false;
}

export interface MakeCasualtyTallyInput {
  readonly reportId?: string;
  readonly count: number;
  readonly asOf?: string;
}

function checkCount(count: number): string | null {
  return Number.isInteger(count) && count >= 0
    ? null
    : 'CasualtyTally.count must be a non-negative integer (a site-level aggregate, never a per-person record)';
}

function checkReportId(reportId: string | undefined): string | null {
  if (reportId === undefined) return null;
  return reportId.trim().length > 0 ? null : 'CasualtyTally.reportId must be a non-empty entity id when present';
}

function checkAsOf(asOf: string | undefined): string | null {
  if (asOf === undefined) return null;
  return Number.isNaN(Date.parse(asOf)) ? `CasualtyTally.asOf must be an ISO-8601 instant, got ${asOf}` : null;
}

/**
 * Build an aggregate casualty tally. `label` and `authoritative` are set by this factory from the schema
 * constants and are NOT caller-supplied — a caller cannot construct a tally that omits or weakens its own
 * caveat through this path.
 */
export function makeCasualtyTally(
  input: MakeCasualtyTallyInput,
): Result<AggregateOnly<CasualtyTally>, DomainError> {
  const problem = checkCount(input.count) ?? checkReportId(input.reportId) ?? checkAsOf(input.asOf);
  if (problem !== null) return err(new DomainError('INVARIANT_VIOLATION', problem));
  return ok(
    definedOnly({
      reportId: input.reportId,
      count: input.count,
      asOf: input.asOf,
      label: CASUALTY_TALLY_LABEL,
      authoritative: CASUALTY_TALLY_AUTHORITATIVE,
    }) as CasualtyTally,
  );
}
