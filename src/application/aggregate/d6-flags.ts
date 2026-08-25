// BEACON — the five D6 feature flags, DERIVED from the boot schema rather than re-declared (ADR-035 §4;
// FR-D6-1…FR-D6-5). Three defects in this codebase (F-24, F-140, F-141) share one root cause: a contract
// re-declared instead of derived. So this module holds the flag NAMES once, and a compile-time assertion
// below proves every name is a real key of `Env` (src/config/index.ts) — a typo'd or removed flag is a
// `tsc --noEmit` failure (Gate 2), not a flag that silently reads `undefined` and stays off forever.
//
// Default OFF for all five (src/config/index.ts). Art. XVI: a disabled module is not a dead end — the
// caller renders nothing and says nothing, rather than rendering an empty/placeholder D6 surface.
import type { Env } from '@/config/index.js';

/** The five D6 flag names, in FR order (FR-D6-1 … FR-D6-5). */
export const D6_FLAGS = [
  'FEATURE_D6_VOLUNTEER_TEAMS',
  'FEATURE_D6_SUPPLIES',
  'FEATURE_D6_REUNIFICATION_LINKS',
  'FEATURE_D6_INCIDENT_EXPORT',
  'FEATURE_D6_CASUALTY_TALLY',
] as const;

export type D6Flag = (typeof D6_FLAGS)[number];

/** Just the five D6 keys of the validated env — a caller passes the whole `Env`; this narrows what is read. */
export type D6FlagState = Pick<Env, D6Flag>;

/**
 * Layer-A-style structural assertion for the FLAG contract (same trick as `AggregateOnly<T>`): resolves to
 * `true` only when every name in `D6_FLAGS` is a key of `Env`; otherwise to an error-carrying type whose
 * single member NAMES the missing flag in the `tsc` error. Exported so it is a real, checked declaration
 * rather than dead code an unused-vars rule would strip.
 */
export type D6FlagsAreEnvKeys =
  Exclude<D6Flag, keyof Env> extends never
    ? true
    : { readonly __D6_FLAG_MISSING_FROM_ENV__: Exclude<D6Flag, keyof Env> };

/** The assertion in value position — this line is what actually fails Gate 2 if a flag name drifts. */
export const D6_FLAGS_ARE_ENV_KEYS: D6FlagsAreEnvKeys = true;

/** True only when the named D6 module is explicitly enabled. Absent/`'off'` ⇒ disabled (fail-closed). */
export function isD6Enabled(env: D6FlagState, flag: D6Flag): boolean {
  return env[flag] === 'on';
}

/** The enabled subset, in FR order — for a composition root or a status surface that must state what is on. */
export function enabledD6Flags(env: D6FlagState): readonly D6Flag[] {
  return D6_FLAGS.filter((flag) => isD6Enabled(env, flag));
}
