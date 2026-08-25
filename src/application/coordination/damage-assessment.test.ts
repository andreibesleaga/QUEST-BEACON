// BEACON — damage / needs assessment tests (MW-D/D5.4; FR-D4-4, FEV-23, V15).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { PUBLIC_REPORT_STATUSES } from '@/domain/public-report.js';
import type { PublicReportStatus } from '@/domain/public-report.js';
import { makeDamageAssessmentEntry } from '@/domain/damage-assessment.js';
import type { DamageReportCategory, DamageSeverity, NeedKind } from '@/domain/damage-assessment.js';
import type { IncidentId, PublicReportId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { UNVERIFIED_LABEL, assessDamage } from './damage-assessment.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateAssessment = ajv.compile(
  JSON.parse(readFileSync('schemas/d5-damage-assessment.schema.json', 'utf8')) as object,
);

interface FixtureEntry {
  readonly report: { readonly id: string; readonly status: PublicReportStatus; readonly incidentId?: string };
  readonly category: DamageReportCategory;
  readonly severity?: DamageSeverity;
  readonly needKind?: NeedKind;
  readonly siteCount?: number;
}

const FIXTURE = JSON.parse(readFileSync('fixtures/coordination/damage-entries.json', 'utf8')) as {
  incidentId: string;
  entries: readonly FixtureEntry[];
};

const INCIDENT = asId<IncidentId>(FIXTURE.incidentId);

// Every fixture row through the REAL domain factory (so an impossible entry cannot enter the test either).
const ENTRIES = FIXTURE.entries.map((e) =>
  makeDamageAssessmentEntry({
    report: {
      id: asId<PublicReportId>(e.report.id),
      status: e.report.status,
      ...(e.report.incidentId !== undefined ? { incidentId: asId<IncidentId>(e.report.incidentId) } : {}),
    },
    category: e.category,
    ...(e.severity !== undefined ? { severity: e.severity } : {}),
    ...(e.needKind !== undefined ? { needKind: e.needKind } : {}),
    ...(e.siteCount !== undefined ? { siteCount: e.siteCount } : {}),
  }),
);

function assessment() {
  const res = assessDamage({ incidentId: INCIDENT, entries: ENTRIES });
  if (!res.ok) throw res.error;
  return res.value;
}

describe('assessDamage', () => {
  it('produces one bucket per triage state — the keys ARE the pipeline vocabulary', () => {
    expect(Object.keys(assessment().byTriageStatus).sort()).toEqual([...PUBLIC_REPORT_STATUSES].sort());
  });

  it('counts each bucket independently and never sums them', () => {
    const a = assessment();
    expect(a.byTriageStatus.VERIFIED).toEqual({
      entries: 3,
      byCategory: { SOS: 0, DAMAGE: 2, NEED: 1 },
      bySeverity: { MINOR: 0, MODERATE: 1, SEVERE: 0, DESTROYED: 1 },
      byNeed: { WATER: 1, FOOD: 0, SHELTER: 0, HEALTH: 0, POWER: 0, ACCESS: 0 },
      siteCount: 14,
      worstSeverity: 'DESTROYED',
    });
    expect(a.byTriageStatus.UNVERIFIED.entries).toBe(3);
    expect(a.byTriageStatus.TRIAGED.entries).toBe(2);
    expect(a.byTriageStatus.REJECTED.entries).toBe(1);
    // The wire shape offers NO field that mixes them: there is no `total`.
    expect(a).not.toHaveProperty('total');
    expect(a).not.toHaveProperty('entries');
  });

  it('exposes `verified` as the VERIFIED bucket BY REFERENCE, so the two cannot disagree', () => {
    const a = assessment();
    expect(a.verified).toBe(a.byTriageStatus.VERIFIED);
  });

  it('labels everything non-verified with the exact required wording', () => {
    expect(assessment().unverifiedLabel).toBe('unverified — not authoritative');
    expect(UNVERIFIED_LABEL).toBe('unverified — not authoritative');
  });

  it('tracks the worst severity per bucket by the domain order, not by arrival order', () => {
    const a = assessment();
    // UNVERIFIED holds only MINOR; REJECTED holds DESTROYED — buckets keep their own worst case.
    expect(a.byTriageStatus.UNVERIFIED.worstSeverity).toBe('MINOR');
    expect(a.byTriageStatus.REJECTED.worstSeverity).toBe('DESTROYED');
    // A bucket with no severity at all reports none rather than a default.
    const noSeverity = assessDamage({
      incidentId: INCIDENT,
      entries: [
        makeDamageAssessmentEntry({
          report: { id: asId<PublicReportId>('rep-n'), status: 'VERIFIED', incidentId: INCIDENT },
          category: 'NEED',
          needKind: 'FOOD',
        }),
      ],
    });
    expect(noSeverity.ok && 'worstSeverity' in noSeverity.value.verified).toBe(false);
  });

  it('keeps a rising severity from being overwritten by a lower one (both accumulator branches)', () => {
    const rising = assessDamage({
      incidentId: INCIDENT,
      entries: (['MINOR', 'DESTROYED', 'MODERATE'] as const).map((severity, i) =>
        makeDamageAssessmentEntry({
          report: { id: asId<PublicReportId>(`rep-r${i}`), status: 'VERIFIED', incidentId: INCIDENT },
          category: 'DAMAGE',
          severity,
        }),
      ),
    });
    expect(rising.ok && rising.value.verified.worstSeverity).toBe('DESTROYED');
  });

  it('sums only the site counts actually supplied (an absent count contributes 0, never a guess)', () => {
    expect(assessment().byTriageStatus.TRIAGED.siteCount).toBe(2);
  });

  it('REFUSES to fold in an entry belonging to another incident (or to none)', () => {
    const foreign = makeDamageAssessmentEntry({
      report: { id: asId<PublicReportId>('rep-x'), status: 'VERIFIED', incidentId: asId<IncidentId>('inc-2') },
      category: 'DAMAGE',
      severity: 'SEVERE',
    });
    const res = assessDamage({ incidentId: INCIDENT, entries: [...ENTRIES, foreign] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('CONFLICT');
    expect(res.error.message).toMatch(/rep-x/);

    const orphan = makeDamageAssessmentEntry({
      report: { id: asId<PublicReportId>('rep-o'), status: 'VERIFIED' },
      category: 'SOS',
    });
    expect(assessDamage({ incidentId: INCIDENT, entries: [orphan] }).ok).toBe(false);
  });

  it('is deterministic and total — no entries yields four empty, labelled buckets', () => {
    expect(assessment()).toEqual(assessment());
    const empty = assessDamage({ incidentId: INCIDENT, entries: [] });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    for (const status of PUBLIC_REPORT_STATUSES) {
      expect(empty.value.byTriageStatus[status].entries).toBe(0);
    }
    expect(empty.value.unverifiedLabel).toBe(UNVERIFIED_LABEL);
  });

  it('validates against schemas/d5-damage-assessment.schema.json and carries no person-identifying key', () => {
    expect(validateAssessment(assessment()), JSON.stringify(validateAssessment.errors)).toBe(true);
    expect(findPersonIdentifyingRuntimeKeys(assessment())).toEqual([]);
  });
});
