// BEACON — PublicReport port (E1·T-088; ADR-001 P7). Consented crowdsourced SOS intake + triage.
// Interface signatures only. GUARDRAIL (EV4/Art. responsible-data): intake REQUIRES consent at the
// TYPE level — `consent: true` is a literal, so an unconsented report cannot even be passed in.
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type { AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
// Cross-cluster domain entity (E1 W1, written in parallel).
import type { PublicReport } from '@/domain/public-report.js'; // cross-cluster entity — E1·T-061 (public-report.ts)

// Intake source mirrors schema.sql public_report.source CHECK.
export type PublicReportSource = 'WEB' | 'SMS' | 'SOCIAL';

/**
 * Consented intake payload. `consent: true` (literal, not boolean) makes consent a compile-time
 * precondition — the type system rejects `consent: false` before any runtime check (EV4).
 */
export interface PublicReportIntake {
  readonly consent: true;
  readonly source: PublicReportSource;
  readonly text: string;
  readonly location?: Position; // precise; generalized/precise split enforced by the entity (Art. XIV)
  /** Optional incident link (F-362). `PublicReport.incidentId` is a nullable FK the entity has always
   *  accepted; no channel carried it until now, so every intake produced an orphaned report. */
  readonly incidentId?: IncidentId;
  // Optional citizen live-view link (Live Views v1.2, ADR-029, FEATURE_CITIZEN_STREAM). Host-allowlisted +
  // SSRF-validated at the transport edge (routing.ts); the entity re-enforces the https/non-IP/length floor.
  // Link-only — NEVER fetched server-side. Absent unless the reporter consented and the feature is enabled.
  readonly liveViewUrl?: string;
}

export interface PublicReportPort {
  /** Ingest a consented SOS; the report starts UNVERIFIED (no outbound action until VERIFIED). */
  intake(report: PublicReportIntake): Promise<Result<PublicReport, DomainError>>;
  /** Human triage decision (VERIFIER/EM). No UNVERIFIED report may emit an alert or task (Art. XIII). */
  triage(
    id: PublicReport['id'],
    decision: 'TRIAGED' | 'VERIFIED' | 'REJECTED',
    actorId: AppUserId,
  ): Promise<Result<PublicReport, DomainError>>;
}
