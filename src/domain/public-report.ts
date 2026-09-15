// BEACON — PUBLIC_REPORT entity (E1·T-060/T-061). Consented crowdsourced SOS (DOMAIN_MODEL §3).
// Pure TS — no framework/HTTP/DB imports (F9).
import type { IncidentId, PublicReportId } from './value-objects/ids.js';
import type { Geometry } from './value-objects/geo.js';
import { InvalidTransition } from './errors.js';
import { invariant, definedOnly } from './shared/guard.js';
import { assertLinkOnlyUrl } from './shared/link-policy.js';
// A DATA document, not a layer: `schemas/` is the repo's shared contract directory and is neither an outer
// layer (`.dependency-cruiser.cjs` `domain-is-pure`) nor a framework/runtime import (`f9-domain-purity`).
// It is imported here for exactly one reason — so the mandatory casualty caveat string has ONE definition in
// the repo, the same one `src/application/aggregate/casualty-tally.ts` reads. See CASUALTY_TALLY_CAVEAT.
import casualtyTallySchema from '../../schemas/d6-casualty-tally.schema.json';

// Enums mirror schema.sql CHECK constraints exactly (public_report).
export const PUBLIC_REPORT_SOURCES = ['WEB', 'SMS', 'SOCIAL'] as const;
export type PublicReportSource = (typeof PUBLIC_REPORT_SOURCES)[number];

export const PUBLIC_REPORT_STATUSES = ['UNVERIFIED', 'TRIAGED', 'VERIFIED', 'REJECTED'] as const;
export type PublicReportStatus = (typeof PUBLIC_REPORT_STATUSES)[number];

/**
 * FR-D4-4 report categories (ADR-036 §7 finding G14: `source` is a CHANNEL — WEB/SMS/SOCIAL — and was never
 * a category, so a damage report and an SOS were indistinguishable). `SOS` is the pre-existing crowdsourced
 * report; `DAMAGE`/`NEED` are the post-impact ones. Closes finding F-151.
 *
 * THIS IS THE ONE DEFINITION. `src/domain/damage-assessment.ts` previously declared its own
 * `DAMAGE_REPORT_CATEGORIES` because the field had not landed here yet; it now ALIASES this array rather
 * than holding a second copy (the F-24/F-140/F-141/F-192 "re-declared contract" defect class). The dependency
 * runs damage-assessment → public-report only, so no import cycle is created.
 */
export const PUBLIC_REPORT_CATEGORIES = ['SOS', 'DAMAGE', 'NEED'] as const;
export type PublicReportCategory = (typeof PUBLIC_REPORT_CATEGORIES)[number];

/**
 * Hard cap on the stored reporter claim (`PublicReport.text`). ONE definition, enforced in the domain
 * factory so every channel and both stores inherit it — the transport edge only checks "non-empty".
 */
export const REPORT_TEXT_MAX_LENGTH = 2000;

/**
 * FR-D6-5 (ADR-035 §4): the MANDATORY casualty-tally caveat, READ from the JSON-Schema `const` in
 * `schemas/d6-casualty-tally.schema.json` — never a second copy of the string. `CASUALTY_TALLY_LABEL` in
 * `src/application/aggregate/casualty-tally.ts` reads the same `const`, so the two constants are the same
 * byte sequence by construction and `tests/architecture/casualty-tally-label-sites.test.ts` proves it.
 */
export const CASUALTY_TALLY_CAVEAT: string = casualtyTallySchema.properties.label.const;
/** Structural restatement of the caveat for consumers that branch rather than render. Always `false`. */
export const CASUALTY_TALLY_AUTHORITATIVE = false;

/**
 * The FR-D6-5 aggregate casualty tally AS IT SITS ON A REPORT (ADR-035 §4 hosts it on the D4 damage report).
 *
 * WHY THE SHAPE IS RESTATED HERE AND WHY THAT IS NOT THE DEFECT IT LOOKS LIKE. The value object
 * `CasualtyTally` lives in `src/application/aggregate/casualty-tally.ts`; `.dependency-cruiser.cjs`'s
 * `domain-is-pure` rule forbids `src/domain` → `src/application`, so this entity CANNOT import it, and that
 * module is outside this lane's write set so it cannot be moved inward either. The contract both sides
 * derive from is therefore the shared JSON Schema, not a hand-copied string: `label` comes from the schema
 * `const` above, and `tests/architecture/casualty-tally-label-sites.test.ts` asserts (a) this shape and the
 * schema's `properties` agree key-for-key and (b) an application `CasualtyTally` is assignable here — so a
 * change to one is a test failure, not a silent drift. The residual duplication is recorded as a finding
 * with the fix (move the value object into `src/domain/`) named, rather than papered over.
 *
 * `reportId` is deliberately ABSENT: the report this hangs on IS the report, so carrying its id again would
 * be a second, droppable copy of the same fact.
 */
export interface ReportCasualtyTally {
  /** Site-level aggregate count. Zero is meaningful ("none observed here") and is preserved. */
  readonly count: number;
  /** ISO-8601 UTC observation instant, supplied by the caller from the injected clock. */
  readonly asOf?: string;
  /** The caveat that TRAVELS WITH the number. Stamped by the factory — never caller-supplied. */
  readonly label: string;
  /** Always `false`. Stamped by the factory — there is no code path that makes a tally authoritative. */
  readonly authoritative: false;
}

/**
 * What a CALLER may supply. `label`/`authoritative` are absent by design: the factory stamps them, so there
 * is no way to put a casualty COUNT on a report without the count acquiring its caveat in the same step.
 * That is the F-174 guarantee stated structurally — not "the label exists somewhere", but "the number cannot
 * be constructed without it". A full `CasualtyTally` from `makeCasualtyTally` satisfies this input as-is.
 */
export interface ReportCasualtyTallyInput {
  readonly count: number;
  readonly asOf?: string;
}

// Deterministic confidence blend components (Art. XII — never LLM-produced).
export interface ConfidenceComponents {
  readonly geocode?: number;
  readonly authority?: number;
  readonly classifier?: number;
  readonly corroboration?: number;
}

export interface PublicReport {
  readonly id: PublicReportId;
  readonly incidentId?: IncidentId; // nullable FK in schema
  readonly source: PublicReportSource;
  /** FR-D4-4 category (G14/F-151). Optional: legacy/seed rows carry none, and an uncategorised report is
   *  still a report — absent means "not categorised", never a silently-assumed 'SOS'. */
  readonly category?: PublicReportCategory;
  /**
   * The reporter's own words — THE CLAIM a verifier approves or rejects (Art. XIII).
   *
   * `PublicReportIntake.text` has been REQUIRED since S03 and every channel supplies it, but no store ever
   * persisted it: the entity had no field, so the claim was validated at the edge and dropped on the floor
   * (found 2026-08-04). The verifier queue therefore asked humans to decide on reports whose content they
   * could not read — which makes the HITL gate ceremonial, and a ceremonial gate is worse than none.
   *
   * Art. XIV is satisfied by lifecycle + audience, exactly as it is for `geomPrecise`, NOT by discarding
   * the evidence: the text lives on the row and is PURGED WITH IT at `purgeAfter`, and `GET /reports` is
   * VERIFIER+ only. Optional on the entity because legacy/seed rows predate the column.
   */
  readonly text?: string;
  readonly status: PublicReportStatus;
  /** FR-D6-5 aggregate casualty tally (ADR-035 §4), hosted on the D4 damage report. Always carries its own
   *  caveat — see {@link ReportCasualtyTally}. */
  readonly casualtyTally?: ReportCasualtyTally;
  readonly confidence?: number; // 0..1 deterministic blend (schema CHECK)
  readonly confidenceComponents?: ConfidenceComponents;
  readonly geomGeneralized?: Geometry; // public view
  readonly geomPrecise?: Geometry; // responder-only (Art. XIV) — app-layer RBAC gates serialization
  readonly consent: true; // EV4: a report must be consented to exist (schema chk_public_report_consent)
  readonly purgeAfter: string; // no PII retention past incident lifecycle (UW6) — ISO-8601
  // Receipt instant (ISO-8601) stamped at intake from the injected clock. Powers the live-view chip's ~2h
  // TTL auto-fade in the verifier queue (isLiveViewFresh). Optional: legacy/seed rows may carry none, in
  // which case the chip fails open (treats an absent timestamp as fresh).
  readonly receivedAt?: string;
  // Live Views v1.2 (ADR-029; FEATURE_CITIZEN_STREAM). An OPTIONAL, consent-gated citizen live-view link
  // the reporter operates — link-only, NEVER fetched/embedded server-side, permanently badged "Unofficial",
  // HITL-reviewable, allowlist-validated at intake. Stored on the report row, so it is PURGED with the report
  // when `purgeAfter` elapses (no separate lifecycle — the retention sweep that drops the row drops this too).
  readonly liveViewUrl?: string;
}

export interface MakePublicReportInput {
  readonly id: PublicReportId;
  readonly incidentId?: IncidentId;
  readonly source: PublicReportSource;
  readonly category?: PublicReportCategory; // FR-D4-4; absent ⇒ uncategorised (never assumed 'SOS')
  readonly text?: string; // the reporter's claim — see PublicReport.text (bounded by REPORT_TEXT_MAX_LENGTH)
  readonly status?: PublicReportStatus; // defaults to UNVERIFIED (schema default)
  /** FR-D6-5 tally. Supply the COUNT; the factory stamps the mandatory caveat onto it. */
  readonly casualtyTally?: ReportCasualtyTallyInput;
  readonly confidence?: number;
  readonly confidenceComponents?: ConfidenceComponents;
  readonly geomGeneralized?: Geometry;
  readonly geomPrecise?: Geometry;
  readonly consent: boolean; // rejected unless true
  readonly purgeAfter: string;
  readonly receivedAt?: string; // optional receipt instant (ISO-8601; stamped at intake) — see PublicReport.receivedAt
  readonly liveViewUrl?: string; // optional citizen live-view link (v1.2; see PublicReport.liveViewUrl)
}

// Legal state transitions per DOMAIN_MODEL §3. A report must pass THROUGH TRIAGED
// before it can be VERIFIED/REJECTED — no UNVERIFIED→VERIFIED direct hop.
const TRANSITIONS: Readonly<Record<PublicReportStatus, readonly PublicReportStatus[]>> = {
  UNVERIFIED: ['TRIAGED'],
  TRIAGED: ['VERIFIED', 'REJECTED'],
  VERIFIED: [], // terminal
  REJECTED: [], // terminal
};

/**
 * Normalise a caller-supplied casualty COUNT into a tally that carries its caveat.
 *
 * The caveat is STAMPED from the schema constant, never copied from the input — so a mapper, a DB row, a
 * spread or a JS caller that reaches this factory with only a number leaves with a number AND its label.
 * There is no branch here that can produce a tally without one; that is the whole of the F-174 guarantee at
 * the construction boundary (the render/export boundaries are pinned by
 * `tests/architecture/casualty-tally-label-sites.test.ts`).
 */
function stampCasualtyTally(input: ReportCasualtyTallyInput): ReportCasualtyTally {
  invariant(
    Number.isInteger(input.count) && input.count >= 0,
    `PublicReport.casualtyTally.count must be a non-negative integer (a site-level aggregate, never a per-person record), got ${String(input.count)}`,
  );
  invariant(
    input.asOf === undefined || !Number.isNaN(Date.parse(input.asOf)),
    `PublicReport.casualtyTally.asOf must be a valid ISO timestamp: ${String(input.asOf)}`,
  );
  return definedOnly({
    count: input.count,
    asOf: input.asOf,
    label: CASUALTY_TALLY_CAVEAT,
    authoritative: CASUALTY_TALLY_AUTHORITATIVE,
  }) as ReportCasualtyTally;
}

/**
 * The two ISO-8601 instants on a report: `purgeAfter` (REQUIRED — the retention deadline, so an unparseable
 * one would mean a row that never expires) and `receivedAt` (optional, same rule when present). Extracted
 * together from the factory to stay under the complexity ceiling; both guards are unchanged.
 */
function assertTimestamps(input: MakePublicReportInput): void {
  invariant(
    Boolean(input.purgeAfter) && !Number.isNaN(Date.parse(input.purgeAfter)),
    `PublicReport.purgeAfter must be a valid ISO timestamp: ${input.purgeAfter}`,
  );
  invariant(
    input.receivedAt === undefined ||
      (Boolean(input.receivedAt) && !Number.isNaN(Date.parse(input.receivedAt))),
    `PublicReport.receivedAt must be a valid ISO timestamp: ${input.receivedAt}`,
  );
}

/**
 * Bound the stored claim in BOTH directions. The transport edge (routing.ts) already rejects blank and
 * over-long bodies, but the domain must hold the invariant for ANY caller (a non-HTTP adapter invoking the
 * port directly): a blank claim is not evidence a verifier can judge, and an unbounded one would be
 * persisted verbatim and then rendered into every verifier's queue. Extracted from the factory to keep it
 * under the complexity ceiling.
 */
function assertTextWithinCap(text: string): void {
  invariant(text.trim().length > 0, 'PublicReport.text must not be blank when provided');
  invariant(
    text.length <= REPORT_TEXT_MAX_LENGTH,
    `PublicReport.text exceeds ${REPORT_TEXT_MAX_LENGTH} characters: ${text.length}`,
  );
}

/** The closed-vocabulary invariants (consent + the three enums). Split out of `makePublicReport` purely to
 *  keep that function under the project's cyclomatic-complexity ceiling as fields are added. */
function assertVocabularies(input: MakePublicReportInput, status: PublicReportStatus): void {
  // EV4 / Art. XIV: consent is the intake invariant — reject the report outright without it.
  invariant(input.consent === true, 'PublicReport requires consent=true (EV4)');
  invariant(
    PUBLIC_REPORT_SOURCES.includes(input.source),
    `PublicReport.source invalid: ${String(input.source)}`,
  );
  invariant(
    input.category === undefined || PUBLIC_REPORT_CATEGORIES.includes(input.category),
    `PublicReport.category must be one of ${PUBLIC_REPORT_CATEGORIES.join('|')}, got ${String(input.category)}`,
  );
  invariant(
    PUBLIC_REPORT_STATUSES.includes(status),
    `PublicReport.status invalid: ${String(status)}`,
  );
}

/** Construct a PublicReport, enforcing consent + enum + confidence-range invariants. */
export function makePublicReport(input: MakePublicReportInput): PublicReport {
  const status = input.status ?? 'UNVERIFIED';
  assertVocabularies(input, status);
  invariant(
    input.confidence === undefined ||
      (!Number.isNaN(input.confidence) && input.confidence >= 0 && input.confidence <= 1),
    `PublicReport.confidence must be in [0,1]: ${input.confidence}`,
  );
  assertTimestamps(input);
  // SSRF-hygiene floor for a citizen live-view URL (ADR-029 / Part-B red lines). The host ALLOW-LIST lives
  // at the intake edge (routing.ts); the DOMAIN enforces the transport-independent invariant that must hold
  // for ANY stored link — `https://` only, a NAMED host (never an IP literal: the classic SSRF/metadata
  // pivot), and a hard 2048-char cap. That rule was this file's own private `assertValidLiveViewUrl`; F-153
  // converged it onto `shared/link-policy.ts`, whose policy is that check verbatim (LINK_POLICY_MAX_LENGTH
  // === 2048), so nothing was loosened. The URL is only ever PARSED for validation — it is NEVER fetched
  // (no thumbnail, no HEAD) anywhere in the system.
  if (input.liveViewUrl !== undefined)
    assertLinkOnlyUrl(input.liveViewUrl, 'PublicReport.liveViewUrl');
  if (input.text !== undefined) assertTextWithinCap(input.text);

  // Build with exactOptionalPropertyTypes: definedOnly drops absent optional keys.
  return definedOnly({
    id: input.id,
    source: input.source,
    category: input.category,
    text: input.text,
    status,
    casualtyTally:
      input.casualtyTally === undefined ? undefined : stampCasualtyTally(input.casualtyTally),
    consent: true,
    purgeAfter: input.purgeAfter,
    receivedAt: input.receivedAt,
    incidentId: input.incidentId,
    confidence: input.confidence,
    confidenceComponents: input.confidenceComponents,
    geomGeneralized: input.geomGeneralized,
    geomPrecise: input.geomPrecise,
    liveViewUrl: input.liveViewUrl,
  }) as PublicReport;
}

/** Guard a lifecycle transition (DOMAIN_MODEL §3). Rejects illegal hops (e.g. UNVERIFIED→VERIFIED). */
export function transitionPublicReport(
  report: PublicReport,
  next: PublicReportStatus,
): PublicReport {
  if (!TRANSITIONS[report.status].includes(next)) {
    throw new InvalidTransition(`PublicReport cannot go ${report.status}→${next}`);
  }
  return { ...report, status: next };
}
