// BEACON test harness — builders for the intel/sources/alerting cluster (source-record, citation,
// sitrep, public-report, alert, threshold-rule). `valid*` uses the real domain factory; `invalid*Input`
// gives a red-path input that breaks a single grounding/HITL invariant (TEST_PLAN §4 / §1.2 error rows).
import {
  makeSourceRecord,
  type MakeSourceRecordInput,
  type SourceRecord,
} from '@/domain/source-record.js';
import { makeCitation, type MakeCitationInput, type Citation } from '@/domain/citation.js';
import {
  makeSitRep,
  type MakeSitRepInput,
  type SitRep,
  type SitRepField,
} from '@/domain/sitrep.js';
import {
  makePublicReport,
  type MakePublicReportInput,
  type PublicReport,
} from '@/domain/public-report.js';
import { makeAlert, type MakeAlertInput, type Alert } from '@/domain/alert.js';
import {
  makeThresholdRule,
  type MakeThresholdRuleInput,
  type ThresholdRule,
} from '@/domain/threshold-rule.js';
import { FIXED_NOW_ISO } from '../clock.js';
import {
  sourceId,
  citationId,
  sitrepId,
  incidentId,
  publicReportId,
  alertId,
  thresholdRuleId,
  regionId,
  appUserId,
} from './ids.js';
import { point } from './hazard-env.js';

const FETCHED_AT = '2026-06-15T12:00:00.000Z';
const PURGE_AFTER = '2026-08-01T00:00:00.000Z';

export function validSourceRecord(overrides: Partial<MakeSourceRecordInput> = {}): SourceRecord {
  return makeSourceRecord({
    id: sourceId('src-firms'),
    source: 'NASA FIRMS',
    adapter: 'firms-adapter',
    fetchedAt: FETCHED_AT,
    license: 'NASA open data',
    mode: 'LIVE',
    ...overrides,
  });
}

export function validCitation(overrides: Partial<MakeCitationInput> = {}): Citation {
  return makeCitation({
    id: citationId('cit-1'),
    sitrepId: sitrepId('sitrep-ca-1'),
    sourceId: sourceId('src-firms'),
    field: 'summary',
    claim: 'Active fire detections confirmed within the incident perimeter.',
    ...overrides,
  });
}

/** A single grounded SitRep field (one citation minimum — an ungrounded field is a contract failure). */
export function sitrepField(field: string, source = 'src-firms'): SitRepField {
  return { field, claim: `narrated ${field}`, citations: [{ sourceId: sourceId(source) }] };
}

export function validSitRep(overrides: Partial<MakeSitRepInput> = {}): SitRep {
  return makeSitRep({
    id: sitrepId('sitrep-ca-1'),
    incidentId: incidentId('inc-ca-camp'),
    generatedAt: FIXED_NOW_ISO,
    summary: 'Wildfire active; exposed lifelines identified; trend escalating.',
    trend: 'ESCALATING',
    aiMode: 'cloud',
    fields: [sitrepField('summary'), sitrepField('priorities', 'src-overpass')],
    ...overrides,
  });
}

/** Deterministic-only SitRep (AI-disabled path, F7): still fully cited, no free-form narrative promised. */
export function deterministicOnlySitRep(overrides: Partial<MakeSitRepInput> = {}): SitRep {
  return validSitRep({ aiMode: 'deterministic-only', trend: 'STEADY', ...overrides });
}

export function validPublicReport(overrides: Partial<MakePublicReportInput> = {}): PublicReport {
  return makePublicReport({
    id: publicReportId('report-ca-1'),
    incidentId: incidentId('inc-ca-camp'),
    source: 'WEB',
    status: 'UNVERIFIED',
    confidence: 0.62,
    confidenceComponents: { geocode: 0.9, authority: 0.3, classifier: 0.7, corroboration: 0.5 },
    geomGeneralized: point(-121.6, 39.7),
    geomPrecise: point(-121.61, 39.71),
    consent: true,
    purgeAfter: PURGE_AFTER,
    ...overrides,
  });
}

export function validThresholdRule(overrides: Partial<MakeThresholdRuleInput> = {}): ThresholdRule {
  return makeThresholdRule({
    id: thresholdRuleId('rule-gauge-major'),
    scope: regionId('us-ca'),
    target: 'GAUGE_CATEGORY',
    operator: 'crosses',
    value: 'MAJOR',
    hysteresis: 0.5,
    cooldown: 3600,
    ...overrides,
  });
}

/** DRAFT alert (the only kind a threshold fire may create — Art. XIII). */
export function validDraftAlert(overrides: Partial<MakeAlertInput> = {}): Alert {
  return makeAlert({
    id: alertId('alert-ca-1'),
    incidentId: incidentId('inc-ca-camp'),
    thresholdRuleId: thresholdRuleId('rule-gauge-major'),
    capStatus: 'DRAFT',
    category: 'Fire',
    severity: 'SEVERE',
    edxlKind: 'CAP',
    ...overrides,
  });
}

/** ACTUAL alert — REQUIRES a human approver (Art. XIII); used for the emit/HITL-satisfied path. */
export function approvedActualAlert(overrides: Partial<MakeAlertInput> = {}): Alert {
  return makeAlert({
    id: alertId('alert-ca-1'),
    incidentId: incidentId('inc-ca-camp'),
    capStatus: 'ACTUAL',
    category: 'Fire',
    severity: 'SEVERE',
    edxlKind: 'CAP',
    approvedBy: appUserId('user-em-1'),
    ...overrides,
  });
}

// ---- invalid variants -------------------------------------------------------------------------------
/** consent=false must be rejected at construction (EV4 / Art. XIV). */
export function invalidPublicReportInputNoConsent(): MakePublicReportInput {
  return { id: publicReportId('bad'), source: 'WEB', consent: false, purgeAfter: PURGE_AFTER };
}

/** ACTUAL without approvedBy must be rejected (Art. XIII). */
export function invalidAlertInputActualNoApprover(): MakeAlertInput {
  return {
    id: alertId('bad'),
    incidentId: incidentId('inc-ca-camp'),
    capStatus: 'ACTUAL',
    category: 'Fire',
    severity: 'SEVERE',
  };
}

/** A generated field with an empty citations[] must be rejected (Art. XI grounding). */
export function invalidSitRepInputUncitedField(): MakeSitRepInput {
  return {
    id: sitrepId('bad'),
    incidentId: incidentId('inc-ca-camp'),
    generatedAt: FIXED_NOW_ISO,
    fields: [{ field: 'summary', citations: [] }],
  };
}
