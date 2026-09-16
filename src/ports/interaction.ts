// BEACON — Interaction ports (E10·T-450; ADR-023 channel-agnostic core). The DRIVING (inbound) face of
// the core shared by EVERY channel — HTTP API, CLI, and messaging — plus the DRIVEN (outbound) faces.
// Interface signatures only: `import type` throughout, Result-returning, no adapter/framework imports
// (enforced by the domain-purity + application-no-adapters boundaries).
//
// GUARDRAILS carried on every channel (identical to the HTTP API, ADR-023 §guarantees):
//   • every data response carries a NON-EMPTY provenance[] + freshness (F1)                — Envelope
//   • SitRep responses additionally carry citations[] (F2)                                 — Envelope
//   • the LLM never produces a figure — numbers come from deterministic use-cases (Art.XII)
//   • no public action from an UNVERIFIED report; alerts are DRAFT-only here (Art.XIII)    — Command
//   • all inbound channel input is UNTRUSTED → auth + firewall BEFORE the core (ADR-017)
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type {
  RegionId,
  IncidentId,
  PublicReportId,
  AppUserId,
} from '@/domain/value-objects/ids.js';
import type { ServedMode } from '@/domain/source-record.js';
import type { VisionRequest } from './intel.js';

// ────────────────────────────────────────────────────────────────────────────
// Response envelope — the DRY anchor. The HTTP API serializer (E7) and every
// channel renderer emit THIS shape (SPEC §2.1). One envelope, three transports.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Provenance of a datum: which SOURCE_RECORD produced it, at what freshness, in which mode.
 *
 * `mode` is the SERVED vocabulary, not the adapter ladder's (ADR-041 §3): `DB` names an operator-maintained
 * record held in BEACON's own store, so `fetchedAt` for a `DB` ref is that row's LAST EDIT — never a claim
 * about upstream freshness, because there is no upstream.
 */
export interface SourceRef {
  readonly sourceId: string;
  readonly mode: ServedMode; // UPPERCASE at the boundary (SPEC §2.1)
  readonly fetchedAt: string; // ISO-8601
}

/** A structured, human-readable error entry (never leaks stack/internal detail). */
export interface EnvelopeError {
  readonly code: string;
  readonly message: string;
}

/** A flattened, transparent view of a SitRep field's grounding (mirrors SitRep.fields[].citations, F2). */
export interface CitationView {
  readonly field: string;
  readonly sourceId: string;
}

/**
 * The universal response envelope. `provenance` is MANDATORY and non-empty on every successful data
 * response (F1); `citations` is present on SitRep responses (F2). Identical across HTTP/CLI/messaging.
 */
export interface Envelope<T = unknown> {
  readonly data: T;
  readonly provenance: readonly SourceRef[];
  readonly freshness?: string; // ISO-8601 — oldest contributing datum
  readonly citations?: readonly CitationView[]; // SitRep responses only (F2)
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly errors?: readonly EnvelopeError[];
}

// ────────────────────────────────────────────────────────────────────────────
// Canonical commands — the channel-agnostic verbs. A channel adapter parses its
// native input (argv / webhook / HTTP) into ONE of these; the router dispatches.
// The golden path monitor → assess → decide → act maps onto these verbs.
// ────────────────────────────────────────────────────────────────────────────

/** monitor — configured sources + their live/cached/mock health + freshness. */
export interface StatusCommand {
  readonly verb: 'status';
  readonly regionId?: RegionId; // defaults to DEFAULT_REGION_ID
}

/** monitor — active incidents in a region. */
export interface IncidentsCommand {
  readonly verb: 'incidents';
  readonly regionId?: RegionId;
}

/** assess — cited AI SitRep + ranked priorities + escalation trend for an incident. Carries citations[]. */
export interface SitRepCommand {
  readonly verb: 'sitrep';
  readonly incidentId: IncidentId;
}

/** monitor — data-source catalogue with per-source mode + freshness (provenance transparency, U4). */
export interface SourcesCommand {
  readonly verb: 'sources';
  readonly regionId?: RegionId;
}

/**
 * monitor — the configured REGION REGISTRY (FR-ZONE-1, ADR-031 §Decision-4). A collection verb: it takes
 * no arguments because the registry is deployment-wide, not region-scoped (a `regionId` would be a filter
 * on a two-entry list, not an input). Serves the region identity + geography + locale metadata every
 * channel needs to offer a region choice, so a client never has to hardcode the shipped zones.
 */
export interface RegionsCommand {
  readonly verb: 'regions';
}

/**
 * intake — a CONSENTED public SOS report. `consent: true` is a literal (compile-time precondition, EV4).
 * The report is created UNVERIFIED; no outbound action follows until a VERIFIER approves it (Art. XIII).
 */
export interface ReportCommand {
  readonly verb: 'report';
  readonly consent: true;
  readonly text: string;
  readonly location?: Position;
  /**
   * Optional incident this SOS belongs to (F-362). `PublicReport.incidentId` has always been a nullable FK
   * in the domain and in `schemas`/`openapi.yaml` (`PublicReportCreate.incidentId`), but no channel ever
   * carried it, so every report was orphaned — which is why a VERIFIED report had no incident to scope a
   * DRAFT CAP alert to and the "Approve + CAP" control could not have worked even in principle. Absent means
   * "not linked", never a silently-assumed incident.
   */
  readonly incidentId?: IncidentId;
  /** Optional citizen live-view link (Live Views v1.2, ADR-029, FEATURE_CITIZEN_STREAM). Validated +
   *  host-allowlisted at the HTTP edge (routing.ts); link-only, never fetched server-side. */
  readonly liveViewUrl?: string;
}

/**
 * Advisory vision-assist request optionally attached to a verify decision (E6·T-290/T-291, Art. XII/XIV).
 * PublicReport carries NO imagery field (domain/public-report.ts) — this is per-call plumbing only: a
 * VERIFIER who has consented, PII-screened imagery in hand (e.g. an attached photo or a Sentinel-2 crop)
 * may ask for an advisory, confidence-scored VisionFinding alongside their decision. It NEVER influences
 * `decision` — the finding (if produced) is surfaced in the response `meta` for the human record only.
 */
export interface VisionAssistRequest {
  readonly imageRef: string;
  readonly task: VisionRequest['task'];
  readonly imageConsented: boolean;
  readonly piiScreened: boolean;
}

/** decide — human triage of a report (VERIFIER/EM). The only path from UNVERIFIED → VERIFIED. */
export interface VerifyCommand {
  readonly verb: 'verify';
  readonly reportId: PublicReportId;
  readonly decision: 'TRIAGED' | 'VERIFIED' | 'REJECTED';
  readonly actorId: AppUserId;
  /**
   * The verifier's explicit request to draft a public CAP alert alongside a VERIFIED decision (F-362).
   *
   * Art. XIII is preserved exactly and is the reason this is a DRAFT-only lever: a VERIFIED report may
   * PROPOSE a public alert; only a separate authenticated approval (`POST /alerts/:id/approve`) promotes a
   * DRAFT to ACTUAL and records the approver. `AlertSinkPort.emit` accepts only an approved ACTUAL alert at
   * the TYPE level, so this path cannot reach a public sink however it is called.
   *
   * Honoured ONLY on `decision: 'VERIFIED'` — a TRIAGED or REJECTED report never produces an alert, because
   * "no outbound action from a report that was never verified" is the whole invariant.
   */
  readonly emitCap?: true;
  /** Optional advisory vision-assist (Art. XIV consent/PII-screen enforced at the compliance gateway). */
  readonly visionAssist?: VisionAssistRequest;
}

/**
 * act — create a DRAFT alert for an incident. NEVER emits: a DRAFT cannot reach AlertSinkPort.emit
 * (the port accepts only an approved ACTUAL alert at the type level). Sending is a separate,
 * authenticated approval step — deliberately NOT a channel command (Art. XIII).
 */
export interface AlertDraftCommand {
  readonly verb: 'alert:draft';
  readonly incidentId: IncidentId;
  readonly headline: string;
}

/** The closed set of canonical commands. Adding a channel never widens this — channels map ONTO it. */
export type Command =
  | StatusCommand
  | IncidentsCommand
  | SitRepCommand
  | SourcesCommand
  | RegionsCommand
  | ReportCommand
  | VerifyCommand
  | AlertDraftCommand;

export type CommandVerb = Command['verb'];

/** Where an inbound request originated — recorded for audit + trust decisions. */
export type ChannelKind = 'http' | 'cli' | 'telegram' | 'whatsapp';

/**
 * A fully-parsed, already-authenticated request entering the core. The channel adapter is responsible
 * for auth (resolving `actorRole` from its transport: CLI = local operator, messaging = signed sender
 * allow-list, HTTP = JWT) and for stamping `receivedAt` from an injected clock (deterministic tests).
 */
export interface InteractionRequest {
  readonly channel: ChannelKind;
  readonly actorRole: AppUserRole;
  readonly command: Command;
  readonly receivedAt: string; // ISO-8601 (injected clock — never a wall-clock read in the core)
  readonly requestId?: string; // idempotency / audit correlation
  /**
   * The resolved TRUE actor identity (a verified JWT `sub`, else the role key). SERVER-DERIVED,
   * NEVER client-supplied — the channel adapter resolves it from the authenticated principal and the
   * request body can never influence it (Art. XIII accountability). Optional/additive.
   */
  readonly actorId?: string;
  /**
   * The requester's preferred display language, as a BCP-47 tag the channel resolved from its own
   * transport (HTTP: the `beacon-locale` cookie; Telegram: `from.language_code`; CLI: `--locale`).
   * Optional and additive: a channel that does not know, omits it, and the core answers in English.
   *
   * SCOPE — deliberately narrow (ADR-030, Art. XII): this selects human-readable PRESENTATION only.
   * It never reaches the deterministic engine, never changes a number, a ranking, an enum token, or an
   * identifier, and an unrecognised value is coerced to English rather than rejected — a request must
   * not fail because someone's phone reports a language BEACON does not ship.
   */
  readonly locale?: string;
}

/**
 * The DRIVING port: the single inbound entry point to the core, shared by every channel. Returns the
 * universal Envelope on success; a typed DomainError (e.g. unknown verb, unauthorized) on failure.
 */
export interface InteractionPort {
  handle(request: InteractionRequest): Promise<Result<Envelope, DomainError>>;
}

// ────────────────────────────────────────────────────────────────────────────
// Driven (outbound) ports for the messaging channel.
// ────────────────────────────────────────────────────────────────────────────

/** A raw inbound message from a messaging transport, BEFORE trust/auth mapping to an InteractionRequest. */
export interface InboundMessage {
  readonly transport: 'telegram' | 'whatsapp';
  readonly senderId: string;
  readonly text: string;
  readonly signature?: string; // transport webhook signature — verified before use (ADR-023 §trust)
  readonly receivedAt: string; // ISO-8601
  /** Sender's UI language as the transport reports it (Telegram `from.language_code`). Presentation-only
   *  — the same narrow scope as InteractionRequest.locale, which mapInbound copies this onto. */
  readonly locale?: string;
}

/**
 * P — outbound messaging transport (MOCK by default; live behind a config flag + token). Sends plain
 * text replies/digests. Precise-PII generalization is enforced upstream by NotificationPort (Art. XIV).
 */
export interface MessagingPort {
  send(to: string, text: string): Promise<Result<void, DomainError>>;
}

/**
 * P — outbound public notification. Generalizes geometry (no precise PII outside the responder view,
 * Art. XIV) and audits every send. Wraps a MessagingPort / AlertSinkPort for the actual delivery.
 */
export interface NotificationPort {
  notify(audience: string, envelope: Envelope): Promise<Result<void, DomainError>>;
}
