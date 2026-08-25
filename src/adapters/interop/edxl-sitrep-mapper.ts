// BEACON — EDXL-SitRep 1.0 (CS02) anti-corruption mapper (E7·T-307; ADR-010, Art. XI/XII). Maps the
// canonical SITREP entity to an OASIS EDXL-SitRep situation report (JSON, validated against
// schemas/edxl-sitrep.schema.json) AND surfaces the field-level citations[] that ground it. The EDXL-SitRep
// document itself carries no citations (they travel in the BEACON API envelope, source-ref.schema.json);
// this mapper therefore returns BOTH the schema-valid document and the preserved, validated citations so
// provenance is never lost across the boundary (grounding is structural, Art. XI/XII).
import type { SitRep } from '@/domain/sitrep.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { ok } from '@/domain/shared/result.js';
import { definedOnly } from '@/domain/shared/guard.js';
import { parseErr, validatedByFile, validatedBySchema } from './interop-result.js';

const SITREP_SCHEMA_PATH = 'schemas/edxl-sitrep.schema.json';

export type SitRepType =
  | 'RequestForInformation' | 'ResponseToRequestForInformation' | 'FieldObservation' | 'SituationReport'
  | 'SubstantiveReport' | 'SpecialReport' | 'FlashReport' | 'ManagementReport' | 'StatusReport';

/** An API-envelope citation (source-ref.schema.json #/$defs/citation) grounding one SitRep field. */
export interface EnvelopeCitation {
  readonly field: string;
  readonly sourceId: string;
  readonly claim: string;
}

export interface EdxlSitRepSummary {
  readonly headline?: string;
  readonly executiveSummary?: string;
  readonly trend?: 'ESCALATING' | 'STEADY' | 'DEESCALATING';
  /**
   * Whether `executiveSummary` was authored by a model (F-410, Art. VI).
   *
   * The UI badge added by F-341 marks AI authorship for an operator looking at the screen. This document
   * leaves the building: it is what a partner agency parses, files and may re-publish, and it carried NO
   * authorship marker at all — only a `description` in the JSON-Schema saying the prose "is LLM-produced",
   * which no receiving system reads. A human-readable comment in a schema is not a disclosure to a machine.
   *
   * Derived from `SitRep.aiMode`, never passed in: `deterministic-only` ⇒ `DETERMINISTIC` (no model ran, so
   * claiming AI authorship would be its own misstatement), `cloud`/`local` ⇒ `AI_GENERATED`. The figures are
   * unaffected either way — every number in the document is deterministic and citation-grounded (Art. XII);
   * this marks who wrote the PROSE.
   */
  readonly summaryAuthorship?: 'AI_GENERATED' | 'DETERMINISTIC';
}
export interface EdxlIncidentInfo {
  readonly incidentID: string;
  readonly incidentName?: string;
  readonly incidentType?: string;
}
export interface EdxlSitRep {
  readonly sitRepIdentifier: string;
  readonly sitRepType: SitRepType;
  readonly sitRepNumber: string;
  readonly sentDateTime: string;
  /**
   * RFC 3066/BCP-47 language tag for this document's human-readable text (summary.*). Not a native
   * EDXL-SitRep 1.0 (CS02) element — see `schemas/edxl-sitrep.schema.json` `#/properties/language` for the
   * full grounding note: the standard defines no Language/LanguageCode/xml:lang construct of its own, so
   * this borrows OASIS EDXL-DE 2.0's `<language>`/`<contentLanguage>` name and RFC 3066 semantics, the
   * family's actual mechanism for tagging payload language. Absent ⇒ byte-identical to pre-i18n output.
   */
  readonly language?: string;
  readonly incidentInformation: EdxlIncidentInfo;
  readonly summary?: EdxlSitRepSummary;
}

export interface EdxlSitRepResult {
  readonly sitrep: EdxlSitRep;
  readonly citations: readonly EnvelopeCitation[];
}

export interface SitRepOptions {
  readonly sitRepType?: SitRepType;
  readonly sitRepNumber?: string;
  readonly headline?: string;
  readonly incidentName?: string;
  readonly incidentType?: string;
  /** See `EdxlSitRep.language`. Omitted ⇒ the document carries no `language` field, exactly as before. */
  readonly language?: string;
}

// Inline schema (draft 2020-12) for the preserved citations[] — mirrors source-ref.schema.json #/$defs
// so grounding is Ajv-validated at the boundary without re-embedding the whole envelope schema.
const CITATIONS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'sourceId', 'claim'],
    properties: {
      field: { type: 'string', minLength: 1 },
      sourceId: { type: 'string', format: 'uuid' },
      claim: { type: 'string', minLength: 1 },
    },
  },
} as const;

/** Extract field-level citations from a SitRep's grounded fields (claim falls back to the field name). */
function citationsOf(sitrep: SitRep): readonly EnvelopeCitation[] {
  return sitrep.fields.flatMap((f) =>
    f.citations.map((c) => ({ field: f.field, sourceId: c.sourceId, claim: f.claim ?? f.field })),
  );
}

function buildSummary(sitrep: SitRep, opts: SitRepOptions): EdxlSitRepSummary | undefined {
  const summary = definedOnly({
    headline: opts.headline,
    executiveSummary: sitrep.summary,
    trend: sitrep.trend,
    // F-410 (Art. VI): marked ONLY when there is prose to attribute. An authorship claim on an absent
    // summary would be a statement about nothing, and would also make the "no summary" document
    // indistinguishable from one whose summary was suppressed.
    ...(sitrep.summary !== undefined
      ? { summaryAuthorship: sitrep.aiMode === 'deterministic-only' ? 'DETERMINISTIC' : 'AI_GENERATED' }
      : {}),
  }) as EdxlSitRepSummary;
  return Object.keys(summary).length > 0 ? summary : undefined;
}

/** Pure transform: canonical SitRep → EDXL-SitRep document (no validation, no IO). */
export function buildEdxlSitRep(sitrep: SitRep, opts: SitRepOptions): EdxlSitRep {
  return definedOnly({
    sitRepIdentifier: sitrep.id,
    sitRepType: opts.sitRepType ?? 'SituationReport',
    sitRepNumber: opts.sitRepNumber ?? '1',
    sentDateTime: sitrep.generatedAt,
    language: opts.language,
    incidentInformation: definedOnly({
      incidentID: sitrep.incidentId,
      incidentName: opts.incidentName,
      incidentType: opts.incidentType,
    }) as EdxlIncidentInfo,
    summary: buildSummary(sitrep, opts),
  }) as EdxlSitRep;
}

/**
 * True when two EDXL-SitRep documents built for the SAME canonical SitRep — typically once per resolved
 * language (`alertLocalesFor`) — carry identical machine-readable values. EDXL-SitRep has no CAP-style
 * repeated `<info>` block, so BEACON's multilingual answer is one document PER language rather than one
 * document with N blocks; this is the invariant that makes that pattern safe (in the spirit of
 * `capMachineValuesAgree` in cap-mapper.ts): translation may change `language` and the narrative text
 * (`summary.headline`/`executiveSummary`), never the identifiers, type/number, timestamp, incident identity,
 * or the deterministically-derived trend (Art. XII — a trend is engine output, never a function of language).
 */
export function edxlSitRepMachineValuesAgree(a: EdxlSitRep, b: EdxlSitRep): boolean {
  const signature = (d: EdxlSitRep): string =>
    JSON.stringify([
      d.sitRepIdentifier,
      d.sitRepType,
      d.sitRepNumber,
      d.sentDateTime,
      d.incidentInformation.incidentID,
      d.incidentInformation.incidentType ?? null,
      d.summary?.trend ?? null,
    ]);
  return signature(a) === signature(b);
}

/**
 * Map a canonical SitRep to a schema-valid EDXL-SitRep document plus its preserved, Ajv-validated
 * citations[]. Returns a typed PARSE_ERROR if the document fails EDXL-SitRep validation or a citation is
 * malformed (e.g. a non-uuid sourceId) — grounding must survive the boundary intact.
 */
export function sitRepToEdxlSitRep(
  sitrep: SitRep,
  opts: SitRepOptions = {},
): Result<EdxlSitRepResult, DomainError> {
  const doc = validatedByFile('EDXL-SitRep', SITREP_SCHEMA_PATH, buildEdxlSitRep(sitrep, opts));
  if (!doc.ok) return doc;
  const citations = citationsOf(sitrep);
  if (citations.length === 0) return parseErr('SitRep has no citations to preserve (grounding is structural)');
  const validated = validatedBySchema('SitRep citations', 'interop:citations', CITATIONS_SCHEMA, citations);
  if (!validated.ok) return validated;
  return ok({ sitrep: doc.value, citations });
}
