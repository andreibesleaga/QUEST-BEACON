// BEACON — read-queue HTTP handlers (E7·T-378/T-387; SPEC §2.2, Art. XIII/XIV, F1). Framework-agnostic PURE
// handlers for the two decide/act READ surfaces the COP needs to drive monitor→assess→decide→act:
//   • GET /reports — the verifier triage queue (VERIFIER+; precise SOS geometry RESPONDER+ only, Art. XIV).
//   • GET /alerts  — the DRAFT alerts computed by the threshold engine (VERIFIER+; DRAFT-only, never emitted).
// Each takes an ALREADY-authenticated request (resolved role) + a read seam and returns an Envelope-shaped
// { status, body } — no server, deterministic, offline. RBAC is enforced here by role rank (identical policy
// to the command-router MIN_ROLE, Art. XIII); provenance is NON-EMPTY on every success (F1). Mirrors map.ts.
import type { Result } from '@/domain/shared/result.js';
import { isResponder, roleRank } from '@/domain/app-user.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { type DomainError, Unauthorized } from '@/domain/errors.js';
import type { ConfidenceComponents, PublicReport } from '@/domain/public-report.js';
import type { Alert } from '@/domain/alert.js';
import type { AlertId } from '@/domain/value-objects/ids.js';
import type { Geometry } from '@/domain/value-objects/geo.js';
import type { ForecastEvidence } from '@/application/anticipatory/forecast-evidence.js';
import type { Envelope, SourceRef } from '@/ports/interaction.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { statusForError } from '../error-mapping.js';
import type { AlertStore } from './interop.js';

/** The transport-neutral result every queue handler returns (mirrors HttpResponse's {status, body}). */
export interface QueueHttpResult {
  readonly status: number;
  readonly body: Envelope | Envelope<null>;
}

/** Read seam for the verifier queue — the MemoryReportStore (and any repo-backed store) satisfies it. */
export interface ReportQueueReadModel {
  list(): Promise<Result<readonly PublicReport[], DomainError>>;
}

/** One row of the verifier queue. `geomPrecise` is present ONLY for RESPONDER+ (Art. XIV, gated below). */
export interface ReportQueueItem {
  readonly id: string;
  readonly status: string;
  /**
   * The reporter's claim — the thing the verifier is deciding about. Not separately role-gated because
   * THIS ENDPOINT IS the gate: `handleReportsGet` 403s anyone below VERIFIER, so every recipient of this
   * row is already authorized to triage it. A second gate here would be a duplicate contract to drift.
   * Absent for rows predating migration 0006.
   */
  readonly text?: string;
  readonly confidence?: number;
  readonly confidenceComponents?: ConfidenceComponents; // deterministic blend sub-scores (Art. XII), when present
  readonly geomPrecise?: Geometry;
  // Live Views v1.2 (ADR-029): the citizen live-view link, surfaced to the verifier as a distinctly-styled
  // "Live Feed — Unofficial" chip. Absent unless the report carries one (FEATURE_CITIZEN_STREAM). Link-only.
  readonly liveViewUrl?: string;
  // Receipt instant (ISO-8601) projected from the report's `receivedAt` — drives the live-view chip's ~2h TTL
  // fade client-side (isLiveViewFresh). Absent for legacy/seed rows with no receipt time (chip fails open).
  readonly submittedAt?: string;
}

/** One DRAFT alert row for review. Always DRAFT here — promotion needs the HITL approve gate (Art. XIII). */
export interface AlertQueueItem {
  readonly id: string;
  readonly state: string;
  readonly category: string;
  readonly severity: string;
  readonly incidentId: string;
  /**
   * WP A8 / finding F-301 — the evidence an ANTICIPATORY DRAFT rests on: lead time, expected crossing
   * instant, forecast vintage, likelihood class + the raw source value behind it, and the method/uncertainty
   * labels every served figure must carry. ADDITIVE and OPTIONAL: an observed-rule DRAFT and a deployment
   * that wires no evidence lookup both omit the key entirely rather than serve an invented figure, so no
   * existing consumer of this row changes shape.
   */
  readonly forecast?: ForecastEvidence;
}

export interface ReportsGetRequest {
  readonly role: AppUserRole;
  /**
   * `?status=pending` ⇒ only UNVERIFIED/TRIAGED rows — the verifier QUEUE is outstanding work, and a
   * decided report must never resurrect in it (2026-08-05: the client hid terminal rows with
   * component-local state, so every remount brought "rejected" reports back). Absent ⇒ ALL statuses —
   * the audit-surface contract this endpoint has always had stays available unchanged.
   */
  readonly status?: 'pending';
}
export interface AlertsGetRequest {
  readonly role: AppUserRole;
}

export interface ReportsGetDeps {
  readonly reports: ReportQueueReadModel;
  readonly clock: () => string;
}
export interface AlertsGetDeps {
  readonly alerts: AlertStore;
  readonly clock: () => string;
  /** alertId → its labelled forecast evidence (WP A8 / F-301). Absent ⇒ rows carry none, never a guess. */
  readonly forecastEvidenceFor?: (alertId: AlertId) => ForecastEvidence | undefined;
}

function fail(error: DomainError): QueueHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

function success<T>(data: T, provenance: readonly SourceRef[]): QueueHttpResult {
  const freshness = provenance[0]?.fetchedAt;
  return { status: 200, body: { data, provenance, ...(freshness ? { freshness } : {}) } };
}

/** MOCK-mode provenance for the offline queues — NON-EMPTY so every data response satisfies F1. */
function mockProvenance(sourceId: string, clock: () => string): readonly SourceRef[] {
  return [{ sourceId, mode: 'MOCK', fetchedAt: clock() }];
}

/** Project a report to its queue row; precise SOS geometry is REVEALED only to RESPONDER+ (Art. XIV). */
function toReportItem(report: PublicReport, role: AppUserRole): ReportQueueItem {
  const precise = isResponder(role) && report.geomPrecise !== undefined;
  return {
    id: String(report.id),
    status: report.status,
    // The claim itself — without it the approve/reject buttons below are a decision with no evidence.
    ...(report.text !== undefined ? { text: report.text } : {}),
    ...(report.confidence !== undefined ? { confidence: report.confidence } : {}),
    ...(report.confidenceComponents !== undefined
      ? { confidenceComponents: report.confidenceComponents }
      : {}),
    ...(precise ? { geomPrecise: report.geomPrecise } : {}),
    // Live-view link is public-by-consent (not PII) — surfaced to every queue role, unlike precise geometry.
    ...(report.liveViewUrl !== undefined ? { liveViewUrl: report.liveViewUrl } : {}),
    // Project the receipt instant to the wire's `submittedAt` (ReportSummary) so the chip TTL uses a real time.
    ...(report.receivedAt !== undefined ? { submittedAt: report.receivedAt } : {}),
  };
}

/**
 * GET /reports — the verifier triage queue. VERIFIER+ only (SPEC §2.2 / Art. XIII: only a verifier/EM
 * triages). Precise reporter geometry (`geomPrecise`) is withheld from everyone below RESPONDER and
 * revealed only to RESPONDER+ (Art. XIV) — enforced here, server-side.
 */
export async function handleReportsGet(
  req: ReportsGetRequest,
  deps: ReportsGetDeps,
): Promise<QueueHttpResult> {
  if (roleRank(req.role) < roleRank('VERIFIER')) {
    return fail(new Unauthorized(`GET /reports requires VERIFIER+, actor is ${req.role}`));
  }
  const res = await deps.reports.list();
  if (!res.ok) return fail(res.error);
  const rows =
    req.status === 'pending'
      ? res.value.filter((r) => PENDING_QUEUE_STATUSES.has(r.status))
      : res.value;
  const reports = rows.map((r) => toReportItem(r, req.role));
  return success({ reports }, mockProvenance('public-report', deps.clock));
}

/** The two statuses that still need a human — the server-side definition the queue view filters by. */
const PENDING_QUEUE_STATUSES: ReadonlySet<string> = new Set(['UNVERIFIED', 'TRIAGED']);

/** Project a computed DRAFT alert to its review row (headline derived from the engine facts, not the LLM). */
function toAlertItem(alert: Alert, forecast: ForecastEvidence | undefined): AlertQueueItem {
  return {
    id: String(alert.id),
    state: alert.capStatus,
    category: alert.category,
    severity: alert.severity,
    incidentId: String(alert.incidentId),
    // Present-only (WP A8/F-301): the key is absent — not null, not a placeholder — when the fire was
    // observed rather than forecast, so a surface cannot mistake "no forecast" for "a forecast of nothing".
    ...(forecast !== undefined ? { forecast } : {}),
  };
}

/**
 * GET /alerts — the DRAFT alerts the threshold engine COMPUTED (FR-11). VERIFIER+ only (SPEC §2.2 line 121:
 * the alert/CAP family is VERIFIER+). Every row is cap_status=DRAFT; promotion to ACTUAL is the separate,
 * authenticated HITL approve gate (POST /alerts/:id/approve, Art. XIII) — listing never emits.
 */
export async function handleAlertsGet(
  req: AlertsGetRequest,
  deps: AlertsGetDeps,
): Promise<QueueHttpResult> {
  if (roleRank(req.role) < roleRank('VERIFIER')) {
    return fail(new Unauthorized(`GET /alerts requires VERIFIER+, actor is ${req.role}`));
  }
  const list = await deps.alerts.list();
  const alerts = list.map((alert) => toAlertItem(alert, deps.forecastEvidenceFor?.(alert.id)));
  return Promise.resolve(success({ alerts }, mockProvenance('threshold-engine', deps.clock)));
}
