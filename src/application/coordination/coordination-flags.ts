// BEACON — the five D5 coordination feature gates (MW-D/D5; ADR-036 §7, spec-delta §6).
// Pure application layer: PORTS + DOMAIN + config TYPES only (no adapters/framework — F9/ADR-001).
//
// EVERY D5 MODULE IS OFF BY DEFAULT. Two independent reasons, both structural:
//   1. `EnvSchema` (`src/config/index.ts`) declares each `FEATURE_D4_*` with the default `'off'`, so an
//      operator who upgrades and changes nothing gets exactly the previous behaviour;
//   2. nothing in `src/main/**` composes these modules yet, so even `on` changes no running surface until a
//      panel/route lane wires one — reported honestly rather than implied (finding F-152).
//
// THE FLAG NAMES ARE DERIVED, NOT RE-DECLARED. `CoordinationFlags = Pick<Env, D5FeatureFlag>` means the
// literal names below must be real keys of the validated env schema: rename one in `src/config/index.ts`
// without renaming it here and `tsc --noEmit` fails on THIS file. That is the F-24/F-140/F-141 lesson
// applied preventively — a hand-copied flag name is a contract copy, and contract copies drift.
import type { Env } from '@/config/index.js';

/** The five flags of ADR-036 §7, in FR order (FR-D4-1 … FR-D4-5). */
export const D5_FEATURE_FLAGS = [
  'FEATURE_D4_RUMOR_BOARD',
  'FEATURE_D4_MUTUAL_AID',
  'FEATURE_D4_SHELTER_STATUS',
  'FEATURE_D4_DAMAGE_REPORTS',
  'FEATURE_D4_EMS_OVERLAY',
] as const;

export type D5FeatureFlag = (typeof D5_FEATURE_FLAGS)[number];

/**
 * The flag slice a coordination caller must supply. Derived from the boot-validated `Env`, so the VALUE
 * vocabulary (`'off' | 'on'`) is the schema's too — this module never re-states it either.
 */
export type CoordinationFlags = Pick<Env, D5FeatureFlag>;

/**
 * The shipped default: every D5 surface ON (entrant decision 2026-07-31, F-193/F-155 — see the dated
 * Resolution note appended to ADR-036). Used by tests and by any caller without a parsed env.
 *
 * This constant MUST mirror `EnvSchema`'s defaults key for key, and a test asserts exactly that against
 * `loadConfig({})`. That test is the reason this file is safe to hand-maintain: it is a re-statement of the
 * schema's defaults, which is the F-24/F-140/F-141/F-192 root-cause class, so it is pinned rather than
 * trusted. If you change a default in `src/config/index.ts`, this constant fails until you change it too —
 * by design. Do not "fix" that test by relaxing it.
 */
export const DEFAULT_COORDINATION_FLAGS: CoordinationFlags = Object.freeze({
  FEATURE_D4_RUMOR_BOARD: 'on',
  FEATURE_D4_MUTUAL_AID: 'on',
  FEATURE_D4_SHELTER_STATUS: 'on',
  FEATURE_D4_DAMAGE_REPORTS: 'on',
  FEATURE_D4_EMS_OVERLAY: 'on',
});

/**
 * A gated surface. `enabled:false` is a LABELLED degradation carrying the flag that closed it (Art. XVI:
 * never a dead end, never a silent empty board that reads as "no rumours / no shelters").
 */
export type FeatureGate<T> =
  | { readonly enabled: true; readonly flag: D5FeatureFlag; readonly value: T }
  | { readonly enabled: false; readonly flag: D5FeatureFlag; readonly reason: string };

/** True when `flag` is switched on in `flags`. */
export function isCoordinationFeatureEnabled(flags: CoordinationFlags, flag: D5FeatureFlag): boolean {
  return flags[flag] === 'on';
}

/**
 * Run `compute` ONLY when `flag` is on. When it is off the thunk is never invoked — the disabled module does
 * no work, allocates nothing and cannot appear half-built — and the caller receives a labelled reason.
 */
export function gateCoordinationFeature<T>(
  flags: CoordinationFlags,
  flag: D5FeatureFlag,
  compute: () => T,
): FeatureGate<T> {
  if (!isCoordinationFeatureEnabled(flags, flag)) {
    return { enabled: false, flag, reason: `${flag} is off — this surface is disabled, not empty` };
  }
  return { enabled: true, flag, value: compute() };
}
