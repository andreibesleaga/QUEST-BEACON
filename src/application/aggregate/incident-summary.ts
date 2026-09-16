// BEACON — FR-D6-4 INCIDENT SUMMARY EXPORT (ADR-035 §4; FEATURE_D6_INCIDENT_EXPORT).
// This module closes finding F-143: `buildIncidentSummary` did not exist, and D6.0 deliberately shipped
// `guardAggregateOnly` (src/application/privacy/incident-summary-guard.ts) as a standalone tested export
// awaiting its call site rather than stubbing a fake one. This IS that call site.
//
// It reads ONLY already-held aggregates — alerts issued, tasks completed, shelter usage, affected area —
// and collects nothing new (FEV-28; docs/requirements/EARS_FINAL_VERSION.md:308-310). Full RECOVER-stage
// accounting is PERMANENTLY OUT (ADR-035 §4); this aggregate document is the honest after-action seed.
//
// Pure and deterministic (Art. XII): no clock (`generatedAt` is injected), no I/O, no randomness — the same
// input always produces the same document, byte for byte. Every figure arrives already computed by
// deterministic typed code upstream; nothing here is derived by an LLM and nothing here is estimated.
//
// LAYER D IS WIRED HERE, and it is not decorative. `guardAggregateOnly(payload)` runs over the CONSTRUCTED
// document immediately before it is returned, and the error branch is PROPAGATED — the payload is never
// returned alongside it. This is the same shape as `src/adapters/alerting/alert-sink.ts:121`, where `emit`
// re-checks `asEmittable` immediately before `alertToCap` and returns CONFLICT rather than emitting: the one
// irreversible step re-verifies instead of trusting, because "the type makes it impossible" is only true
// INSIDE the type system (the project's F-79 lesson). The concrete bypass this catches is named below at
// `casualtyTally`.
import {
  guardAggregateOnly,
  type PersonIdentifyingFieldError,
} from '@/application/privacy/incident-summary-guard.js';
import { CASUALTY_TALLY_LABEL, type CasualtyTally } from './casualty-tally.js';
import type { AggregateOnly } from '@/domain/shared/aggregate-only.js';
import type { SourceRecord, ServedMode } from '@/domain/source-record.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { definedOnly } from '@/domain/shared/guard.js';

/** One provenance row: `SourceRecord` at the export boundary, with its `id` carried as `sourceId`. */
export interface IncidentSummaryProvenance {
  readonly sourceId: string;
  readonly source: string;
  readonly adapter: string;
  readonly fetchedAt: string;
  readonly license: string;
  /** SERVED provenance (ADR-041 §3) — `DB` says an operator maintains the figure, never that it is live. */
  readonly mode: ServedMode;
}

export interface IncidentSummary {
  readonly incidentId: string;
  readonly regionId?: string;
  readonly generatedAt: string;
  readonly closedAt?: string;
  readonly alertsIssued: number;
  readonly tasksCompleted: number;
  readonly tasksTotal?: number;
  readonly sheltersOpen?: number;
  readonly shelterOccupancyPeak?: number;
  readonly shelterCapacityTotal?: number;
  readonly affectedAreaKm2?: number;
  readonly casualtyTally?: CasualtyTally;
  readonly provenance: readonly IncidentSummaryProvenance[];
  readonly freshness: { readonly fetchedAt: string };
  readonly caveats: readonly string[];
}

export interface BuildIncidentSummaryInput {
  readonly incidentId: string;
  readonly regionId?: string;
  /** Injected clock instant — this module never reads a wall clock (Art. XII determinism). */
  readonly generatedAt: string;
  readonly closedAt?: string;
  readonly alertsIssued: number;
  readonly tasksCompleted: number;
  readonly tasksTotal?: number;
  readonly sheltersOpen?: number;
  readonly shelterOccupancyPeak?: number;
  readonly shelterCapacityTotal?: number;
  readonly affectedAreaKm2?: number;
  /**
   * The FR-D6-5 tally, carried into the export SO THE CAVEAT TRAVELS WITH THE NUMBER at the export site as
   * well as the render site. Deliberately re-emitted BY REFERENCE rather than field-picked: a caller can
   * reach this boundary with an object that never passed through `makeCasualtyTally` (a cast, a DB row, a
   * JS caller, a spread in a mapper), which is exactly the class of bypass Layer D exists for. Field-picking
   * here would make the export look safe by construction and leave Layer D unreachable — the guard would
   * then be decorative. It is not: this is the surface it actually guards, and the test suite proves it.
   */
  readonly casualtyTally?: CasualtyTally;
  /** Provenance is MANDATORY and must be non-empty (Art. XI) — a figure with no source is not exportable. */
  readonly provenance: readonly SourceRecord[];
}

/**
 * `DomainError` (bad/absent inputs) OR `PersonIdentifyingFieldError` (Layer D fired). Discriminable on
 * `code`: 'PII_FIELD_FOUND' is not a `DomainErrorCode`, so a caller can branch without instanceof.
 */
export type IncidentSummaryError = DomainError | PersonIdentifyingFieldError;

function checkCount(label: string, value: number | undefined): string | null {
  if (value === undefined) return null;
  return Number.isInteger(value) && value >= 0
    ? null
    : `IncidentSummary.${label} must be a non-negative integer`;
}

function checkInstant(label: string, value: string | undefined): string | null {
  if (value === undefined) return null;
  return Number.isNaN(Date.parse(value))
    ? `IncidentSummary.${label} must be an ISO-8601 instant, got ${value}`
    : null;
}

function checkIdentity(input: BuildIncidentSummaryInput): string | null {
  if (input.incidentId.trim().length === 0) return 'IncidentSummary.incidentId is required';
  if (input.provenance.length === 0) {
    return 'IncidentSummary.provenance must contain at least one SOURCE_RECORD (Art. XI — provenance is structural, not optional)';
  }
  return checkInstant('generatedAt', input.generatedAt) ?? checkInstant('closedAt', input.closedAt);
}

function checkFigures(input: BuildIncidentSummaryInput): string | null {
  return (
    checkCount('alertsIssued', input.alertsIssued) ??
    checkCount('tasksCompleted', input.tasksCompleted) ??
    checkCount('tasksTotal', input.tasksTotal) ??
    checkCount('sheltersOpen', input.sheltersOpen) ??
    checkCount('shelterOccupancyPeak', input.shelterOccupancyPeak) ??
    checkCount('shelterCapacityTotal', input.shelterCapacityTotal) ??
    checkArea(input.affectedAreaKm2)
  );
}

function checkArea(areaKm2: number | undefined): string | null {
  if (areaKm2 === undefined) return null;
  return Number.isFinite(areaKm2) && areaKm2 >= 0
    ? null
    : 'IncidentSummary.affectedAreaKm2 must be a finite, non-negative number';
}

function toProvenanceRow(record: SourceRecord): IncidentSummaryProvenance {
  return {
    sourceId: String(record.id),
    source: record.source,
    adapter: record.adapter,
    fetchedAt: record.fetchedAt,
    license: record.license,
    mode: record.mode,
  };
}

/**
 * The document is only as fresh as its STALEST input, so the single freshness figure is the MINIMUM
 * `fetchedAt`, never the maximum — reporting the newest would overstate how current the summary is. Seeded
 * with `generatedAt` so the answer is also never NEWER than the instant the document was built: a provenance
 * row carrying a future timestamp cannot make the export look fresher than it is.
 */
function oldestFetchedAt(rows: readonly IncidentSummaryProvenance[], generatedAt: string): string {
  return rows.reduce(
    (oldest, row) => (Date.parse(row.fetchedAt) < Date.parse(oldest) ? row.fetchedAt : oldest),
    generatedAt,
  );
}

/**
 * Caveats are DERIVED from the document's own content, never written by hand beside it — so a caveat cannot
 * be forgotten when a field is added, and cannot be attached to a document it is not true of.
 */
function deriveCaveats(summary: Omit<IncidentSummary, 'caveats'>): readonly string[] {
  const caveats: string[] = [];
  const degraded = [
    ...new Set(summary.provenance.filter((p) => p.mode !== 'LIVE').map((p) => p.mode)),
  ].sort();
  if (degraded.length > 0) {
    caveats.push(
      `Not fully LIVE: ${degraded.join('/')} inputs contributed to these figures (see provenance[].mode). A cached or mock figure is exported as cached or mock and is never relabelled LIVE (Art. XVI).`,
    );
  }
  if (summary.casualtyTally !== undefined) {
    caveats.push(
      `Casualty tally is ${CASUALTY_TALLY_LABEL}: a field-reported aggregate count, not a verified figure.`,
    );
  }
  if (summary.shelterCapacityTotal !== undefined) {
    caveats.push(
      'Shelter capacity in BEACON is hand-seeded, not sourced from a shelter feed (F12), so any occupancy-vs-capacity reading of this document is illustrative, not operational.',
    );
  }
  if (summary.affectedAreaKm2 !== undefined) {
    caveats.push(
      'Affected area is the hazard footprint as held at close, computed deterministically upstream; it is a modelled extent, not a surveyed one.',
    );
  }
  caveats.push(
    'Aggregate-only: no person-identifying field is present. Verified at this export boundary by a fail-closed runtime key walk (ADR-035 §4 Layer D), not merely by the declared types.',
  );
  return caveats;
}

/**
 * Build the incident summary export document.
 *
 * Returns `err` and NOTHING ELSE when Layer D fires — the payload is never handed back beside the error, so
 * a caller cannot serialize it by ignoring the branch (the fail-closed contract `guardAggregateOnly`'s own
 * docs require of its call site).
 */
export function buildIncidentSummary(
  input: BuildIncidentSummaryInput,
): Result<AggregateOnly<IncidentSummary>, IncidentSummaryError> {
  const problem = checkIdentity(input) ?? checkFigures(input);
  if (problem !== null) return err(new DomainError('INVARIANT_VIOLATION', problem));

  const provenance = input.provenance.map(toProvenanceRow);
  const core = definedOnly({
    incidentId: input.incidentId,
    regionId: input.regionId,
    generatedAt: input.generatedAt,
    closedAt: input.closedAt,
    alertsIssued: input.alertsIssued,
    tasksCompleted: input.tasksCompleted,
    tasksTotal: input.tasksTotal,
    sheltersOpen: input.sheltersOpen,
    shelterOccupancyPeak: input.shelterOccupancyPeak,
    shelterCapacityTotal: input.shelterCapacityTotal,
    affectedAreaKm2: input.affectedAreaKm2,
    casualtyTally: input.casualtyTally,
    provenance,
    freshness: { fetchedAt: oldestFetchedAt(provenance, input.generatedAt) },
  }) as Omit<IncidentSummary, 'caveats'>;

  const summary: IncidentSummary = { ...core, caveats: deriveCaveats(core) };

  // ── Layer D. Fail-closed, immediately before the document leaves this module. ──────────────────────────
  const guarded = guardAggregateOnly(summary);
  if (!guarded.ok) return err(guarded.error); // propagate the error branch — never the payload
  return ok(guarded.value);
}
