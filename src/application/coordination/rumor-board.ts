// BEACON — RUMOR / MISINFORMATION BOARD (MW-D/D5.1; FR-D4-1 `FEATURE_D4_RUMOR_BOARD`, FEV-20, ADR-036 §7,
// Art. XIV). Pure application layer: imports PORTS + DOMAIN + sibling use-cases only (F9/ADR-001).
//
// A READ-ONLY PROJECTION OVER AN EXISTING DETERMINISTIC PASS — IT RE-DERIVES NOTHING.
// `groundNews` (`src/application/sitrep-synthesis/news-grounding.ts`) already performs, deterministically and
// before any model call: authority ranking, corroboration clustering, distinct-outlet counting, and the
// flag-not-merge decision. This board CONSUMES its `NewsGroundingResult` and re-computes NONE of it — the
// three summary numbers below are the SAME VALUES, carried through by identity (a test asserts `===` against
// the input fields, so a future "improvement" that recounts here fails). Two corroboration counts in one
// system would be the F-141 defect (two denylists) in a new costume.
//
// WHAT "CONFLICTING SIGNAL" MEANS, EXACTLY (not invented here — it is `news-grounding.ts:16-21`'s rule):
// a SOCIAL item whose corroboration cluster (hazard class × time window) contains NO authoritative outlet is
// flagged. A social claim that CONTRADICTS the authoritative consensus lands in a DIFFERENT, authoritative-
// free cluster, so it is flagged by the same rule. The board therefore lists uncorroborated AND contradictory
// signals, each with its reason text, and states which rule produced them rather than adjudicating truth
// (WHO EPI-WIN "structure and route", never "verdict").
//
// THE NEVER-MERGE GUARANTEE IS STRUCTURAL, IN THREE LAYERS:
//   (1) TYPE — `RumorRow.flagged` is the LITERAL `true` and `corroboratingSourceCount` the LITERAL `0`, so a
//       corroborated fact is not assignable to a row: laundering one is a `tsc` error, not a code review note.
//   (2) CONSTRUCTION — rows come only from facts passing `isFlaggedFact`; corroborated facts are never read.
//   (3) FAIL-CLOSED — a flagged fact that ALSO carries corroborating sources is a contradiction (nothing in
//       `news-grounding` can produce one). The board REFUSES to render rather than showing a rumour dressed
//       as corroborated: `CONFLICT`, whole board, no partial output.
import type { CitationId, SourceId } from '@/domain/index.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
// Type-only imports: erased at compile time ⇒ no runtime edge into sitrep-synthesis (same technique
// news-grounding.ts:26-28 uses for its GroundedFact import), so no `no-circular` depcruise violation.
import type { GroundedFact } from '@/application/sitrep-synthesis/sitrep-synthesis.js';
import type { NewsGroundingResult } from '@/application/sitrep-synthesis/news-grounding.js';

/** A fact the deterministic pass FLAGGED. The `true` literal is what keeps a corroborated fact out. */
export type FlaggedFact = GroundedFact & { readonly flagged: true };

/** The single caveat every rumor surface renders — the board structures and routes, it never adjudicates. */
export const RUMOR_BOARD_CAVEAT =
  'Flagged, unverified signals — listed with their flag reason, NEVER merged into any fact, and never ' +
  'counted as corroboration. Listing here is not a truth verdict: it is a routing surface for human review.';

/** The flag reasons this board can render. One rule produces them today (`news-grounding.ts:117-124`). */
export const RUMOR_FLAG_REASONS = ['NO_AUTHORITATIVE_CORROBORATION'] as const;
export type RumorFlagReason = (typeof RUMOR_FLAG_REASONS)[number];

export interface RumorRow {
  /** The grounded-fact field id (`news-unverified-N`) — stable, deterministic, sortable. */
  readonly field: string;
  /** The deterministic claim sentence, which already carries the reason text (`news-grounding.ts:220`). */
  readonly claim: string;
  readonly sourceId: SourceId;
  readonly citationId: CitationId;
  /** Literal `true`: only a flagged fact is representable as a row (layer 1 of the never-merge guarantee). */
  readonly flagged: true;
  /** Literal `0`: a flagged item contributes nothing to corroboration, by type. */
  readonly corroboratingSourceCount: 0;
  readonly reason: RumorFlagReason;
  /** Says out loud what happened to this item, on every row, at every render site. */
  readonly disposition: 'FLAGGED_NOT_MERGED';
}

export interface RumorBoardSummary {
  /** Corroborated authoritative facts minted by the SAME pass — shown for context, never blended in. */
  readonly corroboratedFactCount: number;
  /** Flagged items — equals `rows.length` (asserted). */
  readonly flaggedCount: number;
  /** [0,1] corroboration strength of the AUTHORITATIVE stream only (carried through, never recomputed). */
  readonly corroboration: number;
}

export interface RumorBoard {
  readonly rows: readonly RumorRow[];
  readonly summary: RumorBoardSummary;
  readonly caveat: string;
}

/** Type guard: a fact the deterministic pass flagged (Art. XIV). */
export function isFlaggedFact(fact: GroundedFact): fact is FlaggedFact {
  return fact.flagged === true;
}

function rowOf(fact: FlaggedFact): RumorRow {
  return {
    field: fact.field,
    claim: fact.claim,
    sourceId: fact.sourceId,
    citationId: fact.citationId,
    flagged: true,
    corroboratingSourceCount: 0,
    reason: 'NO_AUTHORITATIVE_CORROBORATION',
    disposition: 'FLAGGED_NOT_MERGED',
  };
}

/**
 * Project a completed news-grounding pass into the rumor board. Deterministic and total: same input ⇒ same
 * output, no clock, no I/O, no model. Fails CLOSED on a self-contradictory flagged fact (see header).
 */
export function buildRumorBoard(result: NewsGroundingResult): Result<RumorBoard, DomainError> {
  const flagged = result.facts.filter(isFlaggedFact);
  const laundered = flagged.filter((f) => (f.corroboratingSourceIds?.length ?? 0) > 0);
  if (laundered.length > 0) {
    return err(
      new DomainError(
        'CONFLICT',
        `Rumor board refused: ${laundered.length} flagged fact(s) carry corroborating sources ` +
          `(${laundered.map((f) => f.field).join(', ')}) — a flagged item may never claim corroboration (FEV-20)`,
      ),
    );
  }
  return ok({
    rows: flagged.map(rowOf),
    summary: {
      // Carried through by identity from the deterministic pass — NOT recounted here.
      corroboratedFactCount: result.corroboratedCount,
      flaggedCount: result.flaggedCount,
      corroboration: result.corroboration,
    },
    caveat: RUMOR_BOARD_CAVEAT,
  });
}
