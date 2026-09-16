// BEACON — shipped CAP-profile registry (D3.1; ADR-036 §1, ADR-012). Pure, env-free data, importable from
// BOTH the env schema (`src/config/index.ts`, so an unknown `CAP_PROFILE` is a BOOT error) and the interop
// adapter that applies the rules — so there is exactly ONE definition of "which profiles ship", the same
// two-part pattern `src/config/locales.ts` uses for locales.
//
// Each id MUST have a matching schemas/cap-profiles/<id>.schema.json; `cap-profile.test.ts` asserts that for
// every id here, and asserts each shipped file is a compilable JSON Schema. An id with no file, or a file
// with no id, is a build defect rather than a runtime surprise.

/**
 * The shipped profile ids.
 *  • `base`  — CAP v1.2 and nothing more. Not a stub: the explicit "no authority-specific rules" rule set,
 *              which keeps the mechanism free of a special-cased default path.
 *  • `ipaws` — rules TRANSCRIBED VERBATIM (never invented) from OASIS "Common Alerting Protocol, v. 1.2 USA
 *              Integrated Public Alert and Warning System Profile Version 1.0", Committee Specification 01,
 *              13 October 2009, §2 — with the citation and the requirement text carried in the schema file.
 */
export const CAP_PROFILE_IDS = ['base', 'ipaws'] as const;
export type CapProfileId = (typeof CAP_PROFILE_IDS)[number];

/** The profile applied when nothing is configured: base CAP v1.2 only. */
export const DEFAULT_CAP_PROFILE: CapProfileId = 'base';

/** Profile-id guard. Also the SECURITY boundary: the id reaches a file path, so only these ids are used. */
export function isCapProfileId(value: unknown): value is CapProfileId {
  return typeof value === 'string' && (CAP_PROFILE_IDS as readonly string[]).includes(value);
}

/**
 * Coerce a raw config value (`CAP_PROFILE`) to a shipped profile. An unknown value is a BOOT error via the
 * env schema, not a silent downgrade; this is the defensive floor for a composition handed a raw env it
 * never validated.
 */
export function toCapProfileId(value: unknown): CapProfileId {
  return isCapProfileId(value) ? value : DEFAULT_CAP_PROFILE;
}
