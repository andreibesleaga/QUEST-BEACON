// BEACON — FR-D6-1 volunteer TEAM aggregate fields (ADR-035 §4; FEATURE_D6_VOLUNTEER_TEAMS).
// A volunteer team is registered, tasked and tracked as a UNIT — a callsign, a headcount, capability tags
// and a duty state. There is no roster, no member list and no way to add one: `name`/`firstName`/`email`/
// `phone`/`contact` are all in PERSON_IDENTIFYING_KEYS, so `AggregateOnly<VolunteerTeamFields>` (the return
// type below) turns any such addition into a `tsc --noEmit` error naming the offending key (Layer A,
// ADR-035 §4). Layers B/C/D are exercised in volunteer-team.test.ts and d6-modules-aggregate-only.test.ts.
//
// SCOPE, stated so the claim is not read as more than it is: this module owns the NEW aggregate fields only.
// It does NOT add 'TEAM' to RESOURCE_KINDS (src/domain/resource.ts:9), the DB CHECK, the logistics port or
// the board icon map — those are pre-existing files this lane does not own, and ADR-035 §4 additionally
// blocks the "taskable via the existing board" claim on F15/F-140 being fixed first. So: the fields, their
// invariants and their guard are real and tested; "a volunteer team is taskable end-to-end in the running
// browser" is NOT claimed here and is not true yet.
//
// The callsign SHAPE is not re-declared: the pattern and maxLength are READ from
// schemas/d6-volunteer-team.schema.json, the same document Layer B walks, so the regex has exactly one
// definition in the repo (the F-24/F-140/F-141 "derive, never retype" lesson).
import volunteerTeamSchema from '../../../schemas/d6-volunteer-team.schema.json';
import type { AggregateOnly } from '@/domain/shared/aggregate-only.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { definedOnly } from '@/domain/shared/guard.js';

/** Team-level duty state. Drift-guarded against the schema `enum` in d6-modules-aggregate-only.test.ts. */
export const TEAM_AVAILABILITY = ['AVAILABLE', 'COMMITTED', 'OFF_DUTY'] as const;
export type TeamAvailability = (typeof TEAM_AVAILABILITY)[number];

/** DERIVED from the schema — never a second copy of the regex. */
const CALLSIGN_PATTERN = new RegExp(volunteerTeamSchema.properties.callsign.pattern);
const CALLSIGN_MAX_LENGTH = volunteerTeamSchema.properties.callsign.maxLength;
/** Capability tags are team-level; the bound comes from the schema's `items.maxLength`. */
const SKILL_MAX_LENGTH = volunteerTeamSchema.properties.skills.items.maxLength;

export interface VolunteerTeamFields {
  readonly kind: 'TEAM';
  /**
   * Free-text UNIT designator, e.g. 'TEAM ALPHA 3'. RECORDED RESIDUAL RISK (ADR-035 §4, restated here at
   * the code that accepts the value): structure cannot stop a human typing a person's name into a free-text
   * field. The pattern + maxLength enforced below MITIGATE the risk by constraining the shape to an
   * uppercase unit designator — they do NOT eliminate it. A human can still type a shaped string that reads
   * as initials ('J D SMITH' fails the pattern only because of the lowercase rule, not because BEACON can
   * tell it is a name). Accepted and documented, not claimed solved.
   */
  readonly callsign?: string;
  /** AGGREGATE count of people on the team — a tally, never a roster (Art. XIV). */
  readonly headcount?: number;
  /** Team-level capability tags, never tied to a named individual. */
  readonly skills?: readonly string[];
  readonly availability?: TeamAvailability;
}

export interface MakeVolunteerTeamFieldsInput {
  readonly callsign?: string;
  readonly headcount?: number;
  readonly skills?: readonly string[];
  readonly availability?: TeamAvailability;
}

function checkCallsign(callsign: string | undefined): string | null {
  if (callsign === undefined) return null;
  if (callsign.length > CALLSIGN_MAX_LENGTH) {
    return `VolunteerTeamFields.callsign exceeds maxLength ${CALLSIGN_MAX_LENGTH}`;
  }
  return CALLSIGN_PATTERN.test(callsign)
    ? null
    : `VolunteerTeamFields.callsign must be an uppercase unit designator matching ${CALLSIGN_PATTERN.source} — never a person's name`;
}

function checkHeadcount(headcount: number | undefined): string | null {
  if (headcount === undefined) return null;
  return Number.isInteger(headcount) && headcount >= 0
    ? null
    : 'VolunteerTeamFields.headcount must be a non-negative integer (an aggregate tally, never a roster)';
}

function checkSkills(skills: readonly string[] | undefined): string | null {
  if (skills === undefined) return null;
  const bad = skills.find((s) => s.trim().length === 0 || s.length > SKILL_MAX_LENGTH);
  return bad === undefined
    ? null
    : `VolunteerTeamFields.skills entries must be non-empty and at most ${SKILL_MAX_LENGTH} characters`;
}

function checkAvailability(availability: TeamAvailability | undefined): string | null {
  if (availability === undefined) return null;
  return TEAM_AVAILABILITY.includes(availability)
    ? null
    : `VolunteerTeamFields.availability must be one of ${TEAM_AVAILABILITY.join('|')}`;
}

/**
 * Build the FR-D6-1 aggregate fields for a volunteer team.
 *
 * The return type is the Layer A assertion in its load-bearing position: `AggregateOnly<VolunteerTeamFields>`
 * resolves to `VolunteerTeamFields` only while the DTO carries no person-identifying key. Add `contactName`
 * to the interface above and this function stops compiling — the guarantee is on the real API, not on a
 * decorative `const _check`.
 */
export function makeVolunteerTeamFields(
  input: MakeVolunteerTeamFieldsInput,
): Result<AggregateOnly<VolunteerTeamFields>, DomainError> {
  const problem =
    checkCallsign(input.callsign) ??
    checkHeadcount(input.headcount) ??
    checkSkills(input.skills) ??
    checkAvailability(input.availability);
  if (problem !== null) return err(new DomainError('INVARIANT_VIOLATION', problem));
  // definedOnly drops absent optional keys, so exactOptionalPropertyTypes stays satisfied without N
  // conditional spreads (the established factory idiom — src/domain/public-report.ts:120-134).
  return ok(
    definedOnly({
      kind: 'TEAM',
      callsign: input.callsign,
      headcount: input.headcount,
      skills: input.skills === undefined ? undefined : [...input.skills],
      availability: input.availability,
    }) as VolunteerTeamFields,
  );
}
