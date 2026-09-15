// BEACON — D6 flag contract (ADR-035 §4; FR-D6-1…FR-D6-5). The five flags are DERIVED from the boot schema,
// so this file tests the derivation, not a second copy of the names.
import { describe, it, expect } from 'vitest';
import { loadConfig } from '@/config/index.js';
import {
  D6_FLAGS,
  D6_FLAGS_ARE_ENV_KEYS,
  isD6Enabled,
  enabledD6Flags,
  type D6FlagState,
} from './d6-flags.js';

const OFF: D6FlagState = {
  FEATURE_D6_VOLUNTEER_TEAMS: 'off',
  FEATURE_D6_SUPPLIES: 'off',
  FEATURE_D6_REUNIFICATION_LINKS: 'off',
  FEATURE_D6_INCIDENT_EXPORT: 'off',
  FEATURE_D6_CASUALTY_TALLY: 'off',
};

describe('D6 feature flags', () => {
  it('declares exactly the five FR-D6-1…FR-D6-5 flags, in FR order', () => {
    expect(D6_FLAGS).toEqual([
      'FEATURE_D6_VOLUNTEER_TEAMS',
      'FEATURE_D6_SUPPLIES',
      'FEATURE_D6_REUNIFICATION_LINKS',
      'FEATURE_D6_INCIDENT_EXPORT',
      'FEATURE_D6_CASUALTY_TALLY',
    ]);
    expect(new Set(D6_FLAGS).size).toBe(D6_FLAGS.length);
  });

  it(
    'every flag name is a real key of the validated Env — the assertion below is the GUARANTEE: rename a ' +
      'flag in src/config/index.ts and `D6_FLAGS_ARE_ENV_KEYS` stops type-checking (Gate 2), it does not ' +
      'silently read undefined and stay off forever',
    () => {
      expect(D6_FLAGS_ARE_ENV_KEYS).toBe(true);
      const env = loadConfig({});
      for (const flag of D6_FLAGS) expect(Object.hasOwn(env, flag)).toBe(true);
    },
  );

  // F-170, resolved by the entrant 2026-07-31: the default is `on`. Two documents disagreed
  // (SPEC-FINAL-VERSION-DELTA.md:131 said `on`, the build brief said `off`); the lane shipped `off` as the
  // safe reading and raised it rather than choosing silently. See the dated Resolution note appended to
  // ADR-035 for the reasoning — in short, the Art. XIV argument for `off` is answered STRUCTURALLY (a D6
  // entity cannot carry a person-identifying field at four independent layers, each proven by planting a
  // violation), so a flag default cannot leak what the type system cannot express.
  //
  // This test asserts the default MATCHES THE DOCUMENTED DECISION. It is not "the defaults are on" as a
  // value judgement — it is the pin that makes a silent, undocumented drift in either direction fail.
  it('every D6 flag defaults ON, matching the F-170 resolution recorded in ADR-035', () => {
    const env = loadConfig({});
    for (const flag of D6_FLAGS) expect(env[flag], flag).toBe('on');
  });

  // ADR-035 V13 is UNCHANGED by the F-170 decision and is the guarantee that actually protects the
  // operator: the default moved, the off state did not. An operator who sets all five off must get
  // exactly nothing composed — so this is asserted explicitly rather than left implied by the default.
  it('V13 still holds — with every flag explicitly OFF, nothing is enabled (the default moved, the off state did not)', () => {
    const env = loadConfig({
      FEATURE_D6_VOLUNTEER_TEAMS: 'off',
      FEATURE_D6_SUPPLIES: 'off',
      FEATURE_D6_REUNIFICATION_LINKS: 'off',
      FEATURE_D6_INCIDENT_EXPORT: 'off',
      FEATURE_D6_CASUALTY_TALLY: 'off',
    });
    for (const flag of D6_FLAGS) expect(isD6Enabled(env, flag), flag).toBe(false);
    expect(enabledD6Flags(env)).toEqual([]);
  });

  it('rejects an invalid flag VALUE at boot rather than silently defaulting it', () => {
    expect(() => loadConfig({ FEATURE_D6_SUPPLIES: 'maybe' })).toThrow(/FEATURE_D6_SUPPLIES/);
  });

  it('isD6Enabled is true only for an explicit "on"', () => {
    expect(isD6Enabled(OFF, 'FEATURE_D6_SUPPLIES')).toBe(false);
    expect(isD6Enabled({ ...OFF, FEATURE_D6_SUPPLIES: 'on' }, 'FEATURE_D6_SUPPLIES')).toBe(true);
  });

  it('enabledD6Flags reports the enabled subset in FR order', () => {
    expect(enabledD6Flags(OFF)).toEqual([]);
    expect(
      enabledD6Flags({ ...OFF, FEATURE_D6_CASUALTY_TALLY: 'on', FEATURE_D6_VOLUNTEER_TEAMS: 'on' }),
    ).toEqual(['FEATURE_D6_VOLUNTEER_TEAMS', 'FEATURE_D6_CASUALTY_TALLY']);
  });

  it('the five flags are INDEPENDENT — enabling one never enables another (ADR-035 §4 rejects a single flag)', () => {
    for (const flag of D6_FLAGS) {
      expect(enabledD6Flags({ ...OFF, [flag]: 'on' })).toEqual([flag]);
    }
  });
});
