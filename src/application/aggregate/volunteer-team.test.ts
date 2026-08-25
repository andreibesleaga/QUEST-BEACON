// BEACON — FR-D6-1 volunteer TEAM aggregate fields (ADR-035 §4). Includes this module's own Layer C
// exercise: a runtime Object.keys() walk over the factory's MAXIMAL output (every optional field supplied).
import { describe, it, expect } from 'vitest';
import volunteerTeamSchema from '../../../schemas/d6-volunteer-team.schema.json';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { makeVolunteerTeamFields, TEAM_AVAILABILITY, type VolunteerTeamFields } from './volunteer-team.js';

/** Every optional field populated — the shape ADR-035 §4 Layer C requires be walked. */
function maximalVolunteerTeamFields(): VolunteerTeamFields {
  const res = makeVolunteerTeamFields({
    callsign: 'TEAM ALPHA 3',
    headcount: 6,
    skills: ['chainsaw', 'swiftwater'],
    availability: 'COMMITTED',
  });
  if (!res.ok) throw res.error;
  return res.value;
}

describe('makeVolunteerTeamFields (FR-D6-1)', () => {
  it('builds the maximal aggregate shape', () => {
    expect(maximalVolunteerTeamFields()).toEqual({
      kind: 'TEAM',
      callsign: 'TEAM ALPHA 3',
      headcount: 6,
      skills: ['chainsaw', 'swiftwater'],
      availability: 'COMMITTED',
    });
  });

  it('omits absent optionals entirely rather than setting them to undefined', () => {
    const res = makeVolunteerTeamFields({});
    expect(res.ok).toBe(true);
    expect(res.ok ? Object.keys(res.value) : []).toEqual(['kind']);
  });

  it('copies the skills array (a later mutation of the caller\'s array cannot reach the built value)', () => {
    const skills = ['chainsaw'];
    const res = makeVolunteerTeamFields({ skills });
    skills.push('contact tracing');
    expect(res.ok ? res.value.skills : []).toEqual(['chainsaw']);
  });

  it('rejects a callsign that does not match the schema pattern — including a person\'s name', () => {
    const res = makeVolunteerTeamFields({ callsign: 'John Smith' });
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.message).toMatch(/never a person's name/);
    expect(res.ok ? '' : res.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('rejects a callsign over the schema maxLength before testing the pattern', () => {
    const res = makeVolunteerTeamFields({ callsign: 'A'.repeat(25) });
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.message).toMatch(/maxLength 24/);
  });

  it('rejects a non-integer or negative headcount (an aggregate tally, never a roster)', () => {
    expect(makeVolunteerTeamFields({ headcount: -1 }).ok).toBe(false);
    expect(makeVolunteerTeamFields({ headcount: 2.5 }).ok).toBe(false);
    expect(makeVolunteerTeamFields({ headcount: 0 }).ok).toBe(true); // zero is a legitimate tally
  });

  it('rejects an empty or over-long skill tag', () => {
    expect(makeVolunteerTeamFields({ skills: ['  '] }).ok).toBe(false);
    expect(makeVolunteerTeamFields({ skills: ['x'.repeat(41)] }).ok).toBe(false);
    expect(makeVolunteerTeamFields({ skills: [] }).ok).toBe(true);
  });

  it('rejects an availability outside the enum (a JS caller can still pass one)', () => {
    const res = makeVolunteerTeamFields({ availability: 'ON_LEAVE' as (typeof TEAM_AVAILABILITY)[number] });
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.message).toMatch(/AVAILABLE\|COMMITTED\|OFF_DUTY/);
  });

  it('accepts every declared availability value', () => {
    for (const availability of TEAM_AVAILABILITY) {
      expect(makeVolunteerTeamFields({ availability }).ok).toBe(true);
    }
  });

  // ── Layer C (ADR-035 §4) ────────────────────────────────────────────────────────────────────────────────
  it('Layer C: the MAXIMAL factory output carries no person-identifying key', () => {
    expect(findPersonIdentifyingRuntimeKeys(maximalVolunteerTeamFields())).toEqual([]);
  });

  it('Layer C: a spread that widens the maximal output at runtime IS caught (what Layer A cannot see)', () => {
    const polluted = { ...maximalVolunteerTeamFields(), members: [{ fullName: 'Jane Doe' }] };
    expect(findPersonIdentifyingRuntimeKeys(polluted)).toEqual(['members[0].fullName']);
  });

  // ── V12 residual risk, restated at the module that accepts the value ────────────────────────────────────
  it('MITIGATES but does not ELIMINATE the free-text callsign risk — stated, not claimed solved', () => {
    // The pattern rejects the obvious case…
    expect(makeVolunteerTeamFields({ callsign: 'John Smith' }).ok).toBe(false);
    // …and CANNOT reject a shaped string a human typed that still reads as a person. This assertion exists
    // to record the residual risk honestly (ADR-035 §4), not to celebrate a guarantee BEACON does not have.
    expect(makeVolunteerTeamFields({ callsign: 'J D SMITH' }).ok).toBe(true);
    expect(volunteerTeamSchema.properties.callsign.description).toMatch(/RESIDUAL RISK/);
  });
});
