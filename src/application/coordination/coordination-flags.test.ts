// BEACON — D5 feature-gate tests (MW-D/D5; ADR-036 §7, V17/NFR-F5 flag isolation).
import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '@/config/index.js';
import {
  D5_FEATURE_FLAGS,
  DEFAULT_COORDINATION_FLAGS,
  gateCoordinationFeature,
  isCoordinationFeatureEnabled,
  type CoordinationFlags,
} from './coordination-flags.js';

// An EXPLICIT all-off state. Tests that exercise gating must CONSTRUCT the state they are testing rather
// than borrow whatever `DEFAULT_COORDINATION_FLAGS` currently happens to be — otherwise a change to the
// shipped default silently rewrites what these tests assert. That is exactly what happened when the default
// moved off→on (F-193): three gating tests broke, not because gating regressed, but because they had been
// leaning on the default's VALUE. The default is pinned by its own mirror test above; gating is pinned here.
const ALL_OFF: CoordinationFlags = Object.freeze({
  FEATURE_D4_RUMOR_BOARD: 'off',
  FEATURE_D4_MUTUAL_AID: 'off',
  FEATURE_D4_SHELTER_STATUS: 'off',
  FEATURE_D4_DAMAGE_REPORTS: 'off',
  FEATURE_D4_EMS_OVERLAY: 'off',
});

describe('D5 feature flags', () => {
  it('names exactly the five ADR-036 §7 surfaces, in FR order', () => {
    expect(D5_FEATURE_FLAGS).toEqual([
      'FEATURE_D4_RUMOR_BOARD',
      'FEATURE_D4_MUTUAL_AID',
      'FEATURE_D4_SHELTER_STATUS',
      'FEATURE_D4_DAMAGE_REPORTS',
      'FEATURE_D4_EMS_OVERLAY',
    ]);
  });

  // F-193/F-155, resolved by the entrant 2026-07-31: the default is `on`. Spec-delta §6 said `on`, the
  // build brief said `off`, and the lane shipped `off` and raised it rather than choosing silently. See the
  // dated Resolution note appended to ADR-036 — the decision was checked against THESE modules' own guards
  // (damage reports carry `AggregateOnly` on the consent→triage path; shelter status is guarded at the CSV
  // export boundary), not inherited from the D6 tier by analogy.
  //
  // This asserts the default MATCHES THE DOCUMENTED DECISION. It is not "the defaults are on" as a value
  // judgement — it is the pin that makes a silent, undocumented drift in EITHER direction fail.
  it('every one defaults ON in the REAL boot-validated env schema, matching the F-193 resolution', () => {
    // loadConfig with an empty environment is exactly what an operator who changed nothing gets.
    const env = loadConfig({});
    for (const flag of D5_FEATURE_FLAGS) expect(env[flag], flag).toBe('on');
  });

  // V17/NFR-F5 is UNCHANGED by the F-193 decision and is the guarantee that actually protects the operator:
  // the default moved, the off state did not. Asserted explicitly rather than left implied by the default.
  it('V17/NFR-F5 still holds — with every flag explicitly OFF, nothing is enabled', () => {
    const env = loadConfig({
      FEATURE_D4_RUMOR_BOARD: 'off',
      FEATURE_D4_MUTUAL_AID: 'off',
      FEATURE_D4_SHELTER_STATUS: 'off',
      FEATURE_D4_DAMAGE_REPORTS: 'off',
      FEATURE_D4_EMS_OVERLAY: 'off',
    });
    for (const flag of D5_FEATURE_FLAGS) expect(env[flag], flag).toBe('off');
  });

  it('the module default mirrors the env default, key for key', () => {
    const env = loadConfig({});
    for (const flag of D5_FEATURE_FLAGS) {
      expect(DEFAULT_COORDINATION_FLAGS[flag]).toBe(env[flag]);
    }
    expect(Object.keys(DEFAULT_COORDINATION_FLAGS).sort()).toEqual([...D5_FEATURE_FLAGS].sort());
  });

  it('a parsed env is assignable as CoordinationFlags (the derived type is the real contract)', () => {
    const flags: CoordinationFlags = loadConfig({ FEATURE_D4_RUMOR_BOARD: 'on', FEATURE_D4_MUTUAL_AID: 'off' });
    expect(isCoordinationFeatureEnabled(flags, 'FEATURE_D4_RUMOR_BOARD')).toBe(true);
    expect(isCoordinationFeatureEnabled(flags, 'FEATURE_D4_MUTUAL_AID')).toBe(false);
  });

  it('an unknown VALUE is a boot error, never a silent downgrade', () => {
    expect(() => loadConfig({ FEATURE_D4_SHELTER_STATUS: 'yes' })).toThrow(/FEATURE_D4_SHELTER_STATUS/);
  });
});

describe('gateCoordinationFeature', () => {
  it('does not invoke the thunk when the flag is off, and says WHICH flag closed the surface', () => {
    const compute = vi.fn(() => 'board');
    const gate = gateCoordinationFeature(ALL_OFF, 'FEATURE_D4_SHELTER_STATUS', compute);
    expect(compute).not.toHaveBeenCalled();
    expect(gate.enabled).toBe(false);
    if (gate.enabled) return;
    expect(gate.flag).toBe('FEATURE_D4_SHELTER_STATUS');
    // Art. XVI: a disabled surface is labelled disabled — never an empty board that reads as "no shelters".
    expect(gate.reason).toMatch(/disabled, not empty/);
  });

  it('invokes the thunk exactly once when the flag is on and returns its value', () => {
    const compute = vi.fn(() => ({ rows: [] }));
    const gate = gateCoordinationFeature(
      { ...ALL_OFF, FEATURE_D4_EMS_OVERLAY: 'on' },
      'FEATURE_D4_EMS_OVERLAY',
      compute,
    );
    expect(compute).toHaveBeenCalledTimes(1);
    expect(gate.enabled).toBe(true);
    if (!gate.enabled) return;
    expect(gate.value).toEqual({ rows: [] });
    expect(gate.flag).toBe('FEATURE_D4_EMS_OVERLAY');
  });

  it('gates each of the five independently — one flag on never opens another surface', () => {
    for (const on of D5_FEATURE_FLAGS) {
      const flags: CoordinationFlags = { ...ALL_OFF, [on]: 'on' };
      for (const flag of D5_FEATURE_FLAGS) {
        expect(gateCoordinationFeature(flags, flag, () => 1).enabled, `${on}/${flag}`).toBe(flag === on);
      }
    }
  });
});
