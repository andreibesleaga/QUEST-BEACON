// BEACON — DAMAGE / NEEDS assessment entry tests (MW-D/D5.4; FR-D4-4, FEV-23).
import { describe, it, expect } from 'vitest';
import { InvariantViolation } from './errors.js';
import {
  makePublicReport,
  transitionPublicReport,
  PUBLIC_REPORT_STATUSES,
} from './public-report.js';
import type { IncidentId, PublicReportId } from './value-objects/ids.js';
import { asId } from './value-objects/ids.js';
import { findPersonIdentifyingRuntimeKeys } from './shared/aggregate-only.js';
import {
  DAMAGE_REPORT_CATEGORIES,
  DAMAGE_SEVERITIES,
  NEED_KINDS,
  damageSeverityRank,
  makeDamageAssessmentEntry,
  type AssessedReport,
} from './damage-assessment.js';

const INCIDENT = asId<IncidentId>('inc-1');

function report(id: string, status: AssessedReport['status'] = 'UNVERIFIED'): AssessedReport {
  return { id: asId<PublicReportId>(id), status, incidentId: INCIDENT };
}

describe('makeDamageAssessmentEntry', () => {
  it('derives id/incident/triage state from the report it assesses (never re-declared)', () => {
    const entry = makeDamageAssessmentEntry({
      report: report('rep-1', 'VERIFIED'),
      category: 'DAMAGE',
      severity: 'SEVERE',
      siteCount: 4,
    });
    expect(entry).toEqual({
      reportId: 'rep-1',
      incidentId: INCIDENT,
      category: 'DAMAGE',
      triageStatus: 'VERIFIED',
      severity: 'SEVERE',
      siteCount: 4,
    });
  });

  it('accepts a report with no incident and drops the absent optional keys', () => {
    const entry = makeDamageAssessmentEntry({
      report: { id: asId<PublicReportId>('rep-2'), status: 'TRIAGED' },
      category: 'SOS',
    });
    expect('incidentId' in entry).toBe(false);
    expect('severity' in entry).toBe(false);
    expect('needKind' in entry).toBe(false);
    expect('siteCount' in entry).toBe(false);
  });

  it('rides the REAL, UNCHANGED report pipeline — a DAMAGE report triages exactly like an SOS (FEV-23/V15)', () => {
    const raw = makePublicReport({
      id: asId<PublicReportId>('rep-live'),
      source: 'WEB',
      consent: true,
      purgeAfter: '2026-07-12T00:00:00Z',
      incidentId: INCIDENT,
    });
    const triaged = transitionPublicReport(raw, 'TRIAGED');
    const verified = transitionPublicReport(triaged, 'VERIFIED');
    // The same report object, at three pipeline states, produces three entries — with NO pipeline change.
    for (const [state, r] of [
      ['UNVERIFIED', raw],
      ['TRIAGED', triaged],
      ['VERIFIED', verified],
    ] as const) {
      expect(
        makeDamageAssessmentEntry({ report: r, category: 'DAMAGE', severity: 'MINOR' })
          .triageStatus,
      ).toBe(state);
    }
    // The retention stamp is still the report's; the assessment view never copies or extends it.
    expect(verified.purgeAfter).toBe('2026-07-12T00:00:00Z');
  });

  it('rejects an unknown category', () => {
    expect(() =>
      makeDamageAssessmentEntry({ report: report('rep-3'), category: 'FLOODED' as 'DAMAGE' }),
    ).toThrow(InvariantViolation);
  });

  it('rejects a triage state the report pipeline cannot produce', () => {
    expect(() =>
      makeDamageAssessmentEntry({
        report: { id: asId<PublicReportId>('rep-4'), status: 'ARCHIVED' as 'VERIFIED' },
        category: 'DAMAGE',
      }),
    ).toThrow(/triageStatus must be one of UNVERIFIED\|TRIAGED\|VERIFIED\|REJECTED/);
  });

  it('rejects an unknown severity and an unknown need kind', () => {
    expect(() =>
      makeDamageAssessmentEntry({
        report: report('rep-5'),
        category: 'DAMAGE',
        severity: 'CATASTROPHIC' as 'SEVERE',
      }),
    ).toThrow(InvariantViolation);
    expect(() =>
      makeDamageAssessmentEntry({
        report: report('rep-6'),
        category: 'NEED',
        needKind: 'WIFI' as 'WATER',
      }),
    ).toThrow(InvariantViolation);
  });

  it('rejects a negative or fractional site count', () => {
    expect(() =>
      makeDamageAssessmentEntry({ report: report('rep-7'), category: 'DAMAGE', siteCount: -1 }),
    ).toThrow(/siteCount must be a non-negative integer/);
    expect(() =>
      makeDamageAssessmentEntry({ report: report('rep-8'), category: 'DAMAGE', siteCount: 2.5 }),
    ).toThrow(/siteCount must be a non-negative integer/);
  });

  it('keeps NEED and DAMAGE vocabularies from mixing (a need is not a severity)', () => {
    expect(() =>
      makeDamageAssessmentEntry({ report: report('rep-9'), category: 'NEED', severity: 'SEVERE' }),
    ).toThrow(/a NEED entry carries needKind, never a damage severity/);
    expect(() =>
      makeDamageAssessmentEntry({
        report: report('rep-10'),
        category: 'DAMAGE',
        needKind: 'WATER',
      }),
    ).toThrow(/needKind belongs to a NEED entry only/);
  });
});

describe('aggregate-only (Art. XIV / ADR-035 §4)', () => {
  it('a MAXIMAL entry carries no person-identifying key at runtime (Layer C)', () => {
    const maximalDamage = makeDamageAssessmentEntry({
      report: report('rep-max', 'VERIFIED'),
      category: 'DAMAGE',
      severity: 'DESTROYED',
      siteCount: 9,
    });
    const maximalNeed = makeDamageAssessmentEntry({
      report: report('rep-max-need', 'VERIFIED'),
      category: 'NEED',
      needKind: 'HEALTH',
      siteCount: 1,
    });
    expect(findPersonIdentifyingRuntimeKeys(maximalDamage)).toEqual([]);
    expect(findPersonIdentifyingRuntimeKeys(maximalNeed)).toEqual([]);
  });
});

describe('vocabularies', () => {
  it('are closed, ordered and non-empty', () => {
    expect(DAMAGE_REPORT_CATEGORIES).toEqual(['SOS', 'DAMAGE', 'NEED']);
    expect(DAMAGE_SEVERITIES).toEqual(['MINOR', 'MODERATE', 'SEVERE', 'DESTROYED']);
    expect(NEED_KINDS).toEqual(['WATER', 'FOOD', 'SHELTER', 'HEALTH', 'POWER', 'ACCESS']);
    // The triage vocabulary is the pipeline's, not a copy of it.
    expect(PUBLIC_REPORT_STATUSES).toContain('VERIFIED');
  });

  it('damageSeverityRank is a strict total order matching DAMAGE_SEVERITIES', () => {
    const ranks = DAMAGE_SEVERITIES.map(damageSeverityRank);
    expect(ranks).toEqual([0, 1, 2, 3]);
    expect(damageSeverityRank('DESTROYED')).toBeGreaterThan(damageSeverityRank('MINOR'));
  });
});
