// BEACON — CITATION entity (E1·T-064/T-065). Grounds one SITREP field to a SOURCE_RECORD
// (Art. XI/XII, U2). Pure TS — no framework/HTTP/DB imports (F9).
import type { CitationId, SitRepId, SourceId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';

export interface Citation {
  readonly id: CitationId;
  readonly sitrepId: SitRepId; // FK — a citation cannot exist without its sitrep
  readonly sourceId: SourceId; // FK — must reference a source (grounding)
  readonly field: string; // which SITREP field this grounds
  readonly claim: string;
}

export interface MakeCitationInput {
  readonly id: CitationId;
  readonly sitrepId: SitRepId;
  readonly sourceId: SourceId;
  readonly field: string;
  readonly claim: string;
}

/** Construct a Citation; field, claim, sourceId (and sitrepId) are all required for a valid grounding. */
export function makeCitation(input: MakeCitationInput): Citation {
  if (!input.field?.trim()) throw new InvariantViolation('Citation.field is required');
  if (!input.claim?.trim()) throw new InvariantViolation('Citation.claim is required');
  // Branded ids are strings at runtime — guard against an empty grounding reference.
  if (!input.sourceId) throw new InvariantViolation('Citation.sourceId is required');
  if (!input.sitrepId) throw new InvariantViolation('Citation.sitrepId is required');
  return {
    id: input.id,
    sitrepId: input.sitrepId,
    sourceId: input.sourceId,
    field: input.field,
    claim: input.claim,
  };
}
