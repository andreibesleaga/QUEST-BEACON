// BEACON — DAMAGE / NEEDS assessment entry (MW-D/D5.4; FR-D4-4, FEV-23, ADR-036 §7).
// Pure domain: no framework/HTTP/DB imports (F9).
//
// WHAT THIS IS — and what it deliberately is NOT.
// FEV-23: "WHEN a damage or needs report is submitted, THE SYSTEM SHALL route it through the EXISTING
// consent/triage/verify pipeline with a category and aggregate severity." The pipeline is
// `src/domain/public-report.ts` (consent invariant `:99`, triage machine `:62-67`, `purgeAfter` retention
// `:33`) and it is UNCHANGED by this file — deliberately, because "reuse the unchanged pipeline" is the
// requirement itself. A DamageAssessmentEntry is therefore an ASSESSMENT VIEW *derived from* a PublicReport,
// never a second report entity:
//   • `reportId` and `triageStatus` are taken from the report via `Pick<PublicReport, …>` — the factory
//     cannot be handed a status the pipeline did not produce, so the two can never drift (the F-24/F-140
//     "re-declared contract" defect class);
//   • `PUBLIC_REPORT_STATUSES` is IMPORTED, never re-typed, so adding a triage state is a compile-time
//     event here rather than a silent gap.
//
// ✅ F-151 CLOSED. ADR-036 §7's FR-D4-4 `category` field now lives ON `PublicReport` (with its DB CHECK, in
// the same change, per spec-delta §1.2), so this module no longer declares the vocabulary — it ALIASES
// `PUBLIC_REPORT_CATEGORIES`. `AssessedReport` now also picks up `category`, and the factory REFUSES to build
// an entry whose category contradicts the report it claims to be a view of: derived, not merely correlated.
//
// AGGREGATE-ONLY (Art. XIV, ADR-035 §4 Layer A). `makeDamageAssessmentEntry` returns
// `AggregateDamageEntry = AggregateOnly<DamageAssessmentEntry>`, so the day anyone adds a person-identifying
// key to the interface the FACTORY stops compiling. Severity and site counts are site-level aggregates —
// there is no field for a person, a household, an injury or a casualty anywhere in this file.
import type { PublicReport, PublicReportCategory, PublicReportStatus } from './public-report.js';
import { PUBLIC_REPORT_CATEGORIES, PUBLIC_REPORT_STATUSES } from './public-report.js';
import type { IncidentId, PublicReportId } from './value-objects/ids.js';
import type { AggregateOnly } from './shared/aggregate-only.js';
import { invariant, definedOnly } from './shared/guard.js';

/**
 * The report categories FR-D4-4 adds (`SOS` is the existing crowdsourced report; the two new ones are
 * post-impact). A closed vocabulary — widened, never re-meant (spec-delta §1.2).
 *
 * F-151 CLOSED: the field has now landed on `PublicReport` (with its DB CHECK), so this is an ALIAS of
 * `PUBLIC_REPORT_CATEGORIES`, not a second declaration of the same vocabulary. The comment below that said
 * the edit "belongs to the owner of src/domain/public-report.ts" is discharged by that change; the alias is
 * kept so this module's published names are unchanged for its callers.
 */
export const DAMAGE_REPORT_CATEGORIES = PUBLIC_REPORT_CATEGORIES;
export type DamageReportCategory = PublicReportCategory;

/** Aggregate, SITE-level damage severity. Ordered least→worst; the order is the comparison order. */
export const DAMAGE_SEVERITIES = ['MINOR', 'MODERATE', 'SEVERE', 'DESTROYED'] as const;
export type DamageSeverity = (typeof DAMAGE_SEVERITIES)[number];

/** The unmet-need kinds a `NEED` report can carry (sector-level, aggregate — never a person's need). */
export const NEED_KINDS = ['WATER', 'FOOD', 'SHELTER', 'HEALTH', 'POWER', 'ACCESS'] as const;
export type NeedKind = (typeof NEED_KINDS)[number];

/** The slice of the UNCHANGED report pipeline an assessment entry is derived from (never re-declared). */
export type AssessedReport = Pick<PublicReport, 'id' | 'status' | 'incidentId' | 'category'>;

export interface DamageAssessmentEntry {
  /** The originating PublicReport — the entry is a view of it, not a copy of it. */
  readonly reportId: PublicReportId;
  readonly incidentId?: IncidentId;
  readonly category: DamageReportCategory;
  /** Verbatim from the report's triage state — this entry never advances or re-decides it. */
  readonly triageStatus: PublicReportStatus;
  /** Aggregate site-level severity (DAMAGE entries); absent when the reporter did not assess one. */
  readonly severity?: DamageSeverity;
  /** The unmet need (NEED entries). */
  readonly needKind?: NeedKind;
  /** Count of affected SITES (structures/parcels) this entry represents — an aggregate, never a headcount. */
  readonly siteCount?: number;
}

/**
 * Layer A (ADR-035 §4). Resolves to `DamageAssessmentEntry` only while that interface declares no
 * person-identifying key; otherwise to the error-carrying shape, which makes the factory's `return` below a
 * `tsc --noEmit` failure that NAMES the offending key. Verified by plant/fail/revert.
 */
export type AggregateDamageEntry = AggregateOnly<DamageAssessmentEntry>;

export interface MakeDamageAssessmentEntryInput {
  readonly report: AssessedReport;
  readonly category: DamageReportCategory;
  readonly severity?: DamageSeverity;
  readonly needKind?: NeedKind;
  readonly siteCount?: number;
}

/** Construct an assessment entry from an existing (consented, triaged) report. */
export function makeDamageAssessmentEntry(input: MakeDamageAssessmentEntryInput): AggregateDamageEntry {
  invariant(
    DAMAGE_REPORT_CATEGORIES.includes(input.category),
    `DamageAssessmentEntry.category must be one of ${DAMAGE_REPORT_CATEGORIES.join('|')}, got ${String(input.category)}`,
  );
  // F-151: now that `PublicReport` carries the category, an entry may not contradict its own report. A
  // report with no category yet (legacy/seed rows, and reports filed before FR-D4-4) is still assessable —
  // absent is not a disagreement.
  invariant(
    input.report.category === undefined || input.report.category === input.category,
    `DamageAssessmentEntry.category must match its report's category (${String(input.report.category)}), got ${String(input.category)}`,
  );
  // Derived, not re-declared: an unknown triage state means the report did not come from the real pipeline.
  invariant(
    PUBLIC_REPORT_STATUSES.includes(input.report.status),
    `DamageAssessmentEntry.triageStatus must be one of ${PUBLIC_REPORT_STATUSES.join('|')}, got ${String(input.report.status)}`,
  );
  invariant(
    input.severity === undefined || DAMAGE_SEVERITIES.includes(input.severity),
    `DamageAssessmentEntry.severity must be one of ${DAMAGE_SEVERITIES.join('|')}, got ${String(input.severity)}`,
  );
  invariant(
    input.needKind === undefined || NEED_KINDS.includes(input.needKind),
    `DamageAssessmentEntry.needKind must be one of ${NEED_KINDS.join('|')}, got ${String(input.needKind)}`,
  );
  invariant(
    input.siteCount === undefined || (Number.isInteger(input.siteCount) && input.siteCount >= 0),
    `DamageAssessmentEntry.siteCount must be a non-negative integer, got ${String(input.siteCount)}`,
  );
  // A NEED entry states what is missing, not how damaged a structure is — mixing the two would let a
  // needs report be counted as damage severity in the board's aggregates.
  invariant(
    !(input.category === 'NEED' && input.severity !== undefined),
    'DamageAssessmentEntry: a NEED entry carries needKind, never a damage severity',
  );
  invariant(
    !(input.category !== 'NEED' && input.needKind !== undefined),
    'DamageAssessmentEntry: needKind belongs to a NEED entry only',
  );

  const entry: DamageAssessmentEntry = definedOnly({
    reportId: input.report.id,
    incidentId: input.report.incidentId,
    category: input.category,
    triageStatus: input.report.status,
    severity: input.severity,
    needKind: input.needKind,
    siteCount: input.siteCount,
  }) as DamageAssessmentEntry;
  // The Layer-A gate: assignable ONLY while DamageAssessmentEntry is person-identifying-key free.
  return entry;
}

/** Rank of a severity in {@link DAMAGE_SEVERITIES} (0-based). Total and deterministic. */
export function damageSeverityRank(severity: DamageSeverity): number {
  return DAMAGE_SEVERITIES.indexOf(severity);
}
