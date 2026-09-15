// BEACON — DAMAGE / NEEDS ASSESSMENT (MW-D/D5.4; FR-D4-4 `FEATURE_D4_DAMAGE_REPORTS`, FEV-23, ADR-036 §7).
// Pure application layer: PORTS + DOMAIN only (F9/ADR-001). No clock, no I/O, no model (Art. XII).
//
// THE VERIFIED / UNVERIFIED SPLIT IS THE WHOLE POINT — AND IT IS STRUCTURAL.
// This module produces ONE BUCKET PER TRIAGE STATE, keyed by `PUBLIC_REPORT_STATUSES` (imported from the
// unchanged pipeline, never re-typed). There is deliberately NO grand total: a single "142 damaged sites"
// number that silently mixes VERIFIED with UNVERIFIED is exactly the laundering Art. XIII forbids upstream of
// any public action, and once such a number exists somebody will render it. `assessment.verified` IS the
// VERIFIED bucket by reference (`byTriageStatus.VERIFIED`), so the two can never disagree; everything else
// stays in its own labelled bucket carrying `UNVERIFIED_LABEL`.
//
// REJECTED reports keep their own bucket too — dropping them would erase the fact that a claim was assessed
// and refused, which is information a verifier needs (and the number a rumour audit asks for).
//
// AGGREGATE-ONLY (Art. XIV): every output field is a COUNT. No casualty figure, no injury, no person. An
// aggregate casualty tally is FR-D6-5, hosted on the D4 damage report and owned by the D6 lane
// (ADR-035 §4/§223) — building a second one here would be the two-denylists (F-141) mistake again; see F-150.
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { PublicReportStatus } from '@/domain/public-report.js';
import { PUBLIC_REPORT_STATUSES } from '@/domain/public-report.js';
import type {
  DamageAssessmentEntry,
  DamageReportCategory,
  DamageSeverity,
  NeedKind,
} from '@/domain/damage-assessment.js';
import {
  DAMAGE_REPORT_CATEGORIES,
  DAMAGE_SEVERITIES,
  NEED_KINDS,
  damageSeverityRank,
} from '@/domain/damage-assessment.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';

/** The label every non-VERIFIED figure is rendered with, verbatim (ADR-035 §4 FR-D6-5's wording). */
export const UNVERIFIED_LABEL = 'unverified — not authoritative';

export const DAMAGE_ASSESSMENT_CAVEAT =
  'Counts of REPORTS, not a survey. Buckets are kept separate by triage state and are never summed: only ' +
  'the VERIFIED bucket has passed human verification, and no bucket authorises a public alert on its own ' +
  '(Art. XIII). Site counts are self-reported aggregates.';

export interface DamageCounts {
  /** Entries in this bucket. */
  readonly entries: number;
  readonly byCategory: Readonly<Record<DamageReportCategory, number>>;
  readonly bySeverity: Readonly<Record<DamageSeverity, number>>;
  readonly byNeed: Readonly<Record<NeedKind, number>>;
  /** Σ of the self-reported site counts in this bucket (absent site counts contribute 0). */
  readonly siteCount: number;
  /** Worst severity present in this bucket, by the domain's severity order. Absent when none is present. */
  readonly worstSeverity?: DamageSeverity;
}

export interface DamageAssessment {
  readonly incidentId: IncidentId;
  /** One bucket per triage state — the keys ARE `PUBLIC_REPORT_STATUSES`, so a new state cannot be missed. */
  readonly byTriageStatus: Readonly<Record<PublicReportStatus, DamageCounts>>;
  /** The VERIFIED bucket, by reference — the only figures quotable without the unverified label. */
  readonly verified: DamageCounts;
  /** The label a renderer must attach to every non-VERIFIED figure. */
  readonly unverifiedLabel: typeof UNVERIFIED_LABEL;
  readonly caveat: string;
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

interface MutableCounts {
  entries: number;
  byCategory: Record<DamageReportCategory, number>;
  bySeverity: Record<DamageSeverity, number>;
  byNeed: Record<NeedKind, number>;
  siteCount: number;
  worstSeverity?: DamageSeverity;
}

function emptyCounts(): MutableCounts {
  return {
    entries: 0,
    byCategory: zeroed(DAMAGE_REPORT_CATEGORIES),
    bySeverity: zeroed(DAMAGE_SEVERITIES),
    byNeed: zeroed(NEED_KINDS),
    siteCount: 0,
  };
}

function accumulate(bucket: MutableCounts, entry: DamageAssessmentEntry): void {
  bucket.entries += 1;
  bucket.byCategory[entry.category] += 1;
  bucket.siteCount += entry.siteCount ?? 0;
  if (entry.needKind !== undefined) bucket.byNeed[entry.needKind] += 1;
  if (entry.severity === undefined) return;
  bucket.bySeverity[entry.severity] += 1;
  if (
    bucket.worstSeverity === undefined ||
    damageSeverityRank(entry.severity) > damageSeverityRank(bucket.worstSeverity)
  ) {
    bucket.worstSeverity = entry.severity;
  }
}

function freeze(bucket: MutableCounts): DamageCounts {
  const counts: DamageCounts = {
    entries: bucket.entries,
    byCategory: bucket.byCategory,
    bySeverity: bucket.bySeverity,
    byNeed: bucket.byNeed,
    siteCount: bucket.siteCount,
  };
  return bucket.worstSeverity === undefined
    ? counts
    : { ...counts, worstSeverity: bucket.worstSeverity };
}

export interface AssessDamageInput {
  readonly incidentId: IncidentId;
  readonly entries: readonly DamageAssessmentEntry[];
}

/**
 * Aggregate damage/needs entries for ONE incident. Fails CLOSED when an entry belongs to another incident
 * (or to none): silently folding a foreign entry into an incident's damage picture would be a wrong number
 * that looks precise — the failure mode Art. XVI ranks worse than an honest refusal.
 */
export function assessDamage(input: AssessDamageInput): Result<DamageAssessment, DomainError> {
  const foreign = input.entries.filter((e) => e.incidentId !== input.incidentId);
  if (foreign.length > 0) {
    return err(
      new DomainError(
        'CONFLICT',
        `Damage assessment refused: ${foreign.length} entr(ies) do not belong to incident ${input.incidentId} ` +
          `(${foreign.map((e) => e.reportId).join(', ')})`,
      ),
    );
  }

  const buckets = new Map<PublicReportStatus, MutableCounts>(
    PUBLIC_REPORT_STATUSES.map((status) => [status, emptyCounts()]),
  );
  for (const entry of input.entries) accumulate(buckets.get(entry.triageStatus)!, entry);

  const byTriageStatus = Object.fromEntries(
    PUBLIC_REPORT_STATUSES.map((status) => [status, freeze(buckets.get(status)!)]),
  ) as Record<PublicReportStatus, DamageCounts>;

  return ok({
    incidentId: input.incidentId,
    byTriageStatus,
    verified: byTriageStatus.VERIFIED,
    unverifiedLabel: UNVERIFIED_LABEL,
    caveat: DAMAGE_ASSESSMENT_CAVEAT,
  });
}
