// BEACON — SITREP entity (E1·T-062/T-063). Generated cited situational report.
// Art. XI/XII: EVERY generated field carries a non-empty citations[] → SOURCE_RECORD.
// Pure TS — no framework/HTTP/DB imports (F9).
import type { IncidentId, SitRepId, SourceId } from './value-objects/ids.js';
import type { LikelihoodClass, PredictionKind } from './prediction.js';
import { invariant, definedOnly } from './shared/guard.js';

// Enums mirror schema.sql CHECK constraints exactly (sitrep).
export const SITREP_TRENDS = ['ESCALATING', 'STEADY', 'DEESCALATING'] as const;
export type SitRepTrend = (typeof SITREP_TRENDS)[number];

export const AI_MODES = ['cloud', 'local', 'deterministic-only'] as const;
export type AiMode = (typeof AI_MODES)[number];

/** A lightweight reference to the SOURCE_RECORD that grounds a field (CITATION detail lives separately). */
export interface CitationRef {
  readonly sourceId: SourceId;
}

/** One generated SITREP field. It MUST carry ≥1 citation — an ungrounded field is a contract failure. */
export interface SitRepField {
  readonly field: string;
  readonly claim?: string;
  readonly citations: readonly CitationRef[];
}

/**
 * A deterministically-ranked attention area (SPEC §2.4/§5.2, FR-13). rank/label/detail all originate from
 * the priority-ranking ENGINE — the LLM narrates them but never reorders or invents them (Art. XII/F3).
 */
export interface RankedPriority {
  readonly rank: number;
  readonly label: string;
  readonly detail?: string;
}

/**
 * One entry of the ranked Outlook (ADR-033 §5, FEV-8) — the `priorities` pattern applied to predictions.
 *
 * `rank` is the 1-based position the OUTLOOK ENGINE assigned (`compareOutlookItems`: likelihood class DESC,
 * then soonest ETA ASC, then severity DESC). Exactly like `RankedPriority`, the LLM narrates these but never
 * reorders or invents them (Art. XII/F3) — they never enter the narrator's payload at all, so a reordering
 * is not merely forbidden, it is unreachable.
 *
 * Every item carries the labelling a prediction is required to travel with (`method`, `uncertainty`,
 * ADR-033 §7 / Art. XIV): an Outlook row can never show a class or an ETA without the method that produced
 * it. `likelihoodClass`/`etaHours` are absent when no SOURCE signal supported one — an unclassified row is
 * honest, a filled-in guess is not (FUW-3).
 */
export interface RankedOutlookItem {
  readonly rank: number;
  readonly predictionId: string;
  readonly kind: PredictionKind;
  readonly method: string; // the labeled first-order method, verbatim from the prediction
  readonly uncertainty: number; // [0,1], verbatim from the prediction
  readonly likelihoodClass?: LikelihoodClass;
  readonly etaHours?: number; // source-supported lead time, unrounded
  /** `generatedAt + etaHours` — computed by the engine from the SitRep's injected instant, never a clock read. */
  readonly hazardArrival?: string; // ISO-8601 UTC
}

export interface SitRep {
  readonly id: SitRepId;
  readonly incidentId: IncidentId;
  readonly generatedAt: string; // ISO-8601 UTC
  readonly summary?: string;
  readonly trend?: SitRepTrend;
  readonly aiMode: AiMode;
  readonly fields: readonly SitRepField[];
  readonly priorities: readonly RankedPriority[]; // engine-ranked (SPEC §2.4 — retained even deterministic-only)
  readonly outlook: readonly RankedOutlookItem[]; // engine-ranked predictions (ADR-033 §5; `[]` when none)
}

export interface MakeSitRepInput {
  readonly id: SitRepId;
  readonly incidentId: IncidentId;
  readonly generatedAt: string;
  readonly summary?: string;
  readonly trend?: SitRepTrend;
  readonly aiMode?: AiMode; // defaults to deterministic-only (schema default)
  readonly fields: readonly SitRepField[];
  readonly priorities?: readonly RankedPriority[]; // defaults to [] (an incident may have no ranked assets)
  readonly outlook?: readonly RankedOutlookItem[]; // defaults to [] (an incident may have no predictions)
}

/** Construct a SitRep; rejects any generated field whose citations[] is empty (Art. XI grounding). */
export function makeSitRep(input: MakeSitRepInput): SitRep {
  invariant(input.incidentId, 'SitRep.incidentId is required');
  invariant(
    !Number.isNaN(Date.parse(input.generatedAt)),
    `SitRep.generatedAt must be a valid ISO timestamp: ${input.generatedAt}`,
  );
  invariant(
    input.trend === undefined || SITREP_TRENDS.includes(input.trend),
    `SitRep.trend invalid: ${String(input.trend)}`,
  );
  const aiMode = input.aiMode ?? 'deterministic-only';
  invariant(AI_MODES.includes(aiMode), `SitRep.aiMode invalid: ${String(aiMode)}`);
  // Grounding invariant: each field must carry at least one citation with a source.
  for (const f of input.fields) {
    invariant(f.field?.trim(), 'SitRepField.field is required');
    invariant(f.citations.length > 0, `SitRep field "${f.field}" has empty citations[] (Art. XI)`);
    for (const c of f.citations) {
      invariant(c.sourceId, `SitRep field "${f.field}" has a citation missing sourceId`);
    }
  }
  return definedOnly({
    id: input.id,
    incidentId: input.incidentId,
    generatedAt: input.generatedAt,
    aiMode,
    fields: input.fields,
    priorities: input.priorities ?? [],
    outlook: input.outlook ?? [],
    summary: input.summary,
    trend: input.trend,
  }) as SitRep;
}
