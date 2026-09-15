// BEACON — selectable CAP profile validation (D3.1; ADR-036 §1, ADR-012, spec-delta §2). The SECOND,
// BLOCKING validation pass that runs after the base CAP v1.2 schema and before the AlertSink records
// anything (`alertToCap` → here → `makeAlertSink.emit`).
//
// WHY A SECOND PASS INSTEAD OF A BIGGER SCHEMA: the base schema states what CAP v1.2 itself requires and is
// shared by every deployment. A profile states what one AUTHORITY additionally requires of a document sent
// to IT. Those are different guarantees with different owners, and a deployment that has no such authority
// must not be forced to satisfy US-specific rules — hence `CAP_PROFILE`, default `base`.
//
// WHY THE RULES ARE DATA (ADR-012): a profile is a JSON-Schema file under schemas/cap-profiles/, composed
// with (not replacing) the base document schema. That is the same idiom the base schema already uses for
// conditional business rules (`allOf`/`if`/`then`), so a rule is auditable against the published profile as
// a diff, and adding a profile is one file + one enum entry.
//
// WHY NOTHING HERE IS INVENTED: every rule in schemas/cap-profiles/ipaws.schema.json carries the VERBATIM
// requirement text and the citation of the OASIS document it was transcribed from. Where the published
// profile states a rule that BEACON cannot meaningfully enforce, the rule is recorded in the schema's
// `$comment` as transcribed-but-not-enforced WITH the reason, rather than being silently dropped or guessed.
//
// HONEST SCOPE: passing a profile is a strong self-check, NOT a conformance certification and NOT
// authorisation to originate. `IPAWS_ENABLED=off` / `CAP_EMIT_MODE=draft` are unchanged (ADR-010,
// Art. XIII): BEACON produces + validates CAP for the authority that owns the dissemination path.
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import {
  CAP_PROFILE_IDS,
  DEFAULT_CAP_PROFILE,
  isCapProfileId,
  toCapProfileId,
} from '@/config/cap-profiles.js';
import type { CapProfileId } from '@/config/cap-profiles.js';
import { validatedByFile } from './interop-result.js';

// The id registry lives in `src/config/` (ADR-012, and the layering: the env schema must import it to make an
// unknown CAP_PROFILE a boot error, and `src/config` may not import an adapter). Re-exported here so callers
// on the interop side have one import.
export { CAP_PROFILE_IDS, DEFAULT_CAP_PROFILE, isCapProfileId, toCapProfileId };
export type { CapProfileId };

/**
 * Absolute path to a profile's rule set. Resolved from `import.meta.url` rather than the CWD, deliberately:
 * the interop schema reads are CWD-relative (finding G17 in ADR-036) and that is a known deployment
 * constraint — this new surface does not add another instance of it.
 */
export function capProfilePath(profile: CapProfileId): string {
  return fileURLToPath(
    new URL(`../../../schemas/cap-profiles/${profile}.schema.json`, import.meta.url),
  );
}

/**
 * Validate an already-base-valid CAP document against the selected profile. Returns the document unchanged
 * on success, or a typed PARSE_ERROR listing the failing rules (the caller surfaces them next to the field
 * that caused them, FUW-6). Generic in the document type so this module never imports the CAP mapper —
 * keeping the dependency one-way (mapper → profile) with no cycle.
 */
export function validateCapProfile<T>(doc: T, profile: CapProfileId): Result<T, DomainError> {
  return validatedByFile(`CAP profile "${profile}"`, capProfilePath(profile), doc);
}
