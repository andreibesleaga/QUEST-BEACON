// BEACON — command router (E10·T-452; ADR-023 channel-agnostic core). The single dispatcher every
// channel (HTTP/CLI/messaging) funnels through: it authorizes the command by RBAC rank, routes to the
// right use-case/port, and returns the universal Envelope. Imports PORTS + DOMAIN + sibling use-cases
// only — NO adapter/framework imports (F9/ADR-001, enforced by eslint + depcruise).
//
// The router is deliberately THIN: deterministic assembly (exposure/priorities/trend → GroundedFacts)
// lives in the read-model behind CoreServices, so numbers always come from the engine, never here and
// never the LLM (Art. XII). One envelope shape, identical guarantees on every channel.
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError, Unauthorized } from '@/domain/errors.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { roleRank } from '@/domain/app-user.js';
import type { Alert } from '@/domain/alert.js';
import { makeAlert } from '@/domain/alert.js';
import type { PublicReport } from '@/domain/public-report.js';
import type { BBox } from '@/domain/value-objects/geo.js';
import type { SitRep, AiMode, RankedPriority } from '@/domain/sitrep.js';
import type { Prediction } from '@/domain/prediction.js';
import type { ModelTier } from '@/domain/audit-event.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  RegionId,
  IncidentId,
  AlertId,
  SitRepId,
} from '@/domain/value-objects/ids.js';
import type { AICompliancePort, ComplianceRequest, NewsItem, VisionFinding, VisionMediatePayload } from '@/ports/intel.js';
import type { PublicReportPort } from '@/ports/public-report.js';
import type {
  InteractionPort,
  InteractionRequest,
  Command,
  CommandVerb,
  Envelope,
  SourceRef,
  CitationView,
} from '@/ports/interaction.js';
import {
  synthesizeSitRep,
  type GroundedFact,
  type SynthesizeSitRepInput,
} from '../sitrep-synthesis/sitrep-synthesis.js';
import { newsOutletProvenance } from '../sitrep-synthesis/news-grounding.js';

// ── Read models (deterministic, adapter-supplied via the composition root) ───

/**
 * A configured region as the `regions` verb serves it (ADR-031 §Decision-4). `id`/`name` are always
 * present; the geography/locale fields are OPTIONAL because they come from whichever read-model is wired:
 * the config-backed registry supplies all four, while the Postgres projection (`region` table) has no
 * iso/tz/languages column and supplies none of them. An absent field is OMITTED rather than defaulted —
 * substituting a value here is exactly how an unconfigured region once inherited California's bbox (F-06).
 */
export interface RegionView {
  readonly id: RegionId;
  readonly name: string;
  /** ISO-3166-1 alpha-2 of the containing country — decides country-scoped source coverage (ADR-031). */
  readonly iso?: string;
  /** IANA timezone. Every timestamp shown for this region is formatted in it (FU-8). */
  readonly tz?: string;
  /** BCP-47 tags, most significant first. Outbound alerts carry these AND English (FR-I18N-6). */
  readonly languages?: readonly string[];
  /** [minLon, minLat, maxLon, maxLat] — the region's own extent, never another region's. */
  readonly bbox?: BBox;
}

/** A monitor/assess projection of an incident. `facts`/`priorities` are pre-assembled by the engine (F2/F3). */
export interface IncidentView {
  readonly id: IncidentId;
  readonly regionId: RegionId;
  readonly type: string; // 'WILDFIRE' | 'FLOOD' | …
  readonly status: string; // 'ACTIVE' | …
  readonly headline: string;
  readonly facts: readonly GroundedFact[]; // deterministic grounded facts for the SitRep
  readonly priorities: readonly RankedPriority[]; // engine-ranked attention areas (FR-13, SPEC §5.2)
  /**
   * The incident's labeled predictions in derivation order (ADR-033 §5). Ranked into the SitRep's
   * `outlook[]` by the outlook engine (`rankOutlook`), never here — the router stays THIN. Optional because
   * a read-model that derives no prediction simply omits it, and an incident with no forecastable signal has
   * no Outlook (Art. XVI: an absent section, never a faked one).
   */
  readonly predictions?: readonly Prediction[];
  readonly trend?: SitRep['trend'];
  readonly provenance: readonly SourceRef[];
  readonly freshness?: string;
  /** Region-scoped news/social batch for the deterministic grounding pass (flag-not-merge, Art. XIV). */
  readonly news?: readonly NewsItem[];
}

export interface SourceView {
  readonly sourceId: string;
  readonly mode: 'LIVE' | 'CACHED' | 'MOCK';
  readonly fetchedAt: string;
}

export interface RegionReadModel {
  list(): Promise<Result<readonly RegionView[], DomainError>>;
}
export interface IncidentReadModel {
  listByRegion(regionId: RegionId): Promise<Result<readonly IncidentView[], DomainError>>;
  getById(id: IncidentId): Promise<Result<IncidentView | null, DomainError>>;
}
export interface SourceReadModel {
  list(regionId: RegionId): Promise<Result<readonly SourceView[], DomainError>>;
}

/**
 * SitRep narration posture, present only when AI is enabled via config (AI_MODE=cloud|local). When absent,
 * the SitRep degrades to deterministic-only (the offline default). The gateway is still the chokepoint — this
 * only labels the successful narration + picks the model tier the compliance role-scope checks (Art. XII/XV).
 */
export interface NarrationConfig {
  readonly aiMode: Extract<AiMode, 'cloud' | 'local'>;
  readonly modelTier: ModelTier;
}

/**
 * Everything the router needs, all behind ports/read-models. The composition root builds this from real
 * adapters (offline-first: memory-backed by default; Postgres/live behind flags). Tests inject fakes.
 * `clock` and `newId` are injected so the core never reads a wall-clock or RNG (deterministic tests).
 */
export interface CoreServices {
  readonly clock: () => string; // ISO-8601 now
  readonly newId: (prefix: string) => string; // stable, deterministic id minting
  readonly defaultRegionId: RegionId;
  readonly regions: RegionReadModel;
  readonly incidents: IncidentReadModel;
  readonly sources: SourceReadModel;
  readonly reports: PublicReportPort;
  readonly ai: AICompliancePort;
  /** SitRep narration posture (AI_MODE cloud|local). Absent ⇒ deterministic-only SitRep (offline default, F7). */
  readonly narration?: NarrationConfig;
  /**
   * Vision-assist gateway (FEATURE_VISION=on only; absent otherwise — byte-identical to today, F16/Art.
   * XVI). When present, `verify` may request an ADVISORY VisionFinding alongside a human decision; it
   * never influences `decision` and a refusal/failure never blocks the triage (Art. XII/XIII/XIV).
   */
  readonly vision?: AICompliancePort;
}

// ── RBAC: minimum role rank per verb (Art. XIII — enforced on every channel) ──

const MIN_ROLE: Readonly<Record<CommandVerb, AppUserRole>> = Object.freeze({
  status: 'PUBLIC',
  incidents: 'PUBLIC',
  sitrep: 'PUBLIC',
  sources: 'PUBLIC',
  regions: 'PUBLIC', // the shipped-zone registry is public metadata (FR-ZONE-1) — no operational posture in it
  report: 'PUBLIC', // anyone may submit a CONSENTED report; it starts UNVERIFIED
  verify: 'VERIFIER', // only a verifier/EM may triage (the UNVERIFIED → VERIFIED gate)
  'alert:draft': 'VERIFIER', // SPEC §2.2 / CLARIF Q6: the alert/CAP family is VERIFIER+ (sending still needs approval)
});

const KNOWN_VERBS = new Set<string>(Object.keys(MIN_ROLE));

// ── Envelope helpers ─────────────────────────────────────────────────────────

/** Dedupe provenance by sourceId (a datum may cite the same source many times). */
function dedupeProvenance(refs: readonly SourceRef[]): readonly SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const r of refs) if (!seen.has(r.sourceId)) seen.set(r.sourceId, r);
  return [...seen.values()];
}

/** Oldest contributing fetchedAt = the response's freshness (SPEC §2.1). Compares by parsed instant so a
 *  mixed-offset/precision timestamp can't yield the wrong "oldest" (lexicographic compare would). */
function oldest(refs: readonly SourceRef[]): string | undefined {
  if (refs.length === 0) return undefined;
  return refs.reduce((min, r) => (Date.parse(r.fetchedAt) < Date.parse(min) ? r.fetchedAt : min), refs[0]!.fetchedAt);
}

function sourcesAsProvenance(sources: readonly SourceView[]): readonly SourceRef[] {
  return sources.map((s) => ({ sourceId: s.sourceId, mode: s.mode, fetchedAt: s.fetchedAt }));
}

// ── The router ────────────────────────────────────────────────────────────────

/** Create the InteractionPort backed by the wired core services. Pure over its deps → fully testable. */
export function createCommandRouter(services: CoreServices): InteractionPort {
  return { handle: (request) => dispatch(request, services) };
}

/** Render a typed failure as an Envelope so every channel reports errors uniformly (no data, code+message). */
export function errorEnvelope(error: DomainError): Envelope<null> {
  return { data: null, provenance: [], errors: [{ code: error.code, message: error.message }] };
}

/**
 * The two channel-agnostic pre-dispatch guards, extracted so the verb switch below stays inside the
 * complexity budget as the command set grows: an unknown verb from untyped channel input is a typed
 * PARSE_ERROR (T-451), and the RBAC rank gate is identical on every channel (Art. XIII). Returns the
 * rejection, or null when the command may proceed.
 */
function rejectCommand(command: Command, actorRole: AppUserRole): DomainError | null {
  if (!KNOWN_VERBS.has(command.verb)) {
    return new DomainError('PARSE_ERROR', `unknown command: ${String(command.verb)}`);
  }
  if (roleRank(actorRole) < roleRank(MIN_ROLE[command.verb])) {
    return new Unauthorized(`${command.verb} requires ${MIN_ROLE[command.verb]}, actor is ${actorRole}`);
  }
  return null;
}

async function dispatch(
  request: InteractionRequest,
  services: CoreServices,
): Promise<Result<Envelope, DomainError>> {
  const { command, actorRole } = request;

  const rejection = rejectCommand(command, actorRole);
  if (rejection !== null) return err(rejection);

  switch (command.verb) {
    case 'status':
      return handleStatus(command, services);
    case 'incidents':
      return handleIncidents(command, services);
    case 'sitrep':
      return handleSitRep(command, request, services);
    case 'sources':
      return handleSources(command, services);
    case 'regions':
      return handleRegions(services);
    case 'report':
      return handleReport(command, services);
    case 'verify':
      return handleVerify(command, services);
    case 'alert:draft':
      return handleAlertDraft(command, services);
  }
}

type CommandByVerb<V extends CommandVerb> = Extract<Command, { verb: V }>;

/** F1 guarantee: a data response never ships empty provenance — fall back to the region's configured sources. */
async function ensureProvenance(
  refs: readonly SourceRef[],
  regionId: RegionId,
  services: CoreServices,
): Promise<readonly SourceRef[]> {
  const deduped = dedupeProvenance(refs);
  return deduped.length > 0 ? deduped : regionSourceProvenance(regionId, services);
}

/** monitor — region incident overview; provenance from configured sources (non-empty even with 0 incidents, F1). */
async function handleStatus(
  command: CommandByVerb<'status'>,
  services: CoreServices,
): Promise<Result<Envelope, DomainError>> {
  const regionId = command.regionId ?? services.defaultRegionId;
  const srcRes = await services.sources.list(regionId);
  if (!srcRes.ok) return srcRes;
  const incRes = await services.incidents.listByRegion(regionId);
  if (!incRes.ok) return incRes;
  const provenance = dedupeProvenance(sourcesAsProvenance(srcRes.value));
  const data = {
    regionId,
    incidentCount: incRes.value.length,
    incidents: incRes.value.map((i) => ({
      id: i.id,
      type: i.type,
      status: i.status,
      headline: i.headline,
    })),
  };
  return ok(envelope(data, provenance));
}

/** monitor — active incidents in a region. */
async function handleIncidents(
  command: CommandByVerb<'incidents'>,
  services: CoreServices,
): Promise<Result<Envelope, DomainError>> {
  const regionId = command.regionId ?? services.defaultRegionId;
  const incRes = await services.incidents.listByRegion(regionId);
  if (!incRes.ok) return incRes;
  const provenance = dedupeProvenance(incRes.value.flatMap((i) => i.provenance));
  const fallback = provenance.length > 0 ? provenance : await regionSourceProvenance(regionId, services);
  return ok(envelope({ regionId, incidents: incRes.value }, fallback));
}

/** assess — cited SitRep (deterministic facts → LLM narration through the compliance gateway, F2/F3). */
/** Present-only locale spread (extracted to keep handleSitRep under the complexity ceiling). */
function localeOf(request: InteractionRequest): { locale?: string } {
  return request.locale !== undefined ? { locale: request.locale } : {};
}

async function handleSitRep(
  command: CommandByVerb<'sitrep'>,
  request: InteractionRequest,
  services: CoreServices,
): Promise<Result<Envelope, DomainError>> {
  const viewRes = await services.incidents.getById(command.incidentId);
  if (!viewRes.ok) return viewRes;
  const view = viewRes.value;
  if (view === null) {
    return err(new DomainError('NOT_FOUND', `incident not found: ${command.incidentId}`));
  }
  const input: SynthesizeSitRepInput = {
    id: asId<SitRepId>(services.newId('sitrep')),
    generatedAt: request.receivedAt,
    actorRole: request.actorRole,
    // The requester's display language → the narration prose (NarrativeRequest.locale, ADR-030). This
    // line is the OTHER half of the connection the ports contract promised: SynthesizeSitRepInput.locale
    // existed and threaded all the way to the model, but no channel ever set it (found 2026-08-04).
    ...localeOf(request),
    facts: {
      incidentId: view.id,
      facts: view.facts,
      priorities: view.priorities,
      // Ranked into `outlook[]` by the engine inside synthesizeSitRep (ADR-033 §5) — the wire contract
      // SPEC-FINAL-VERSION-DELTA §5 states for GET /incidents/{id}/sitrep.
      ...(view.predictions !== undefined && view.predictions.length > 0 ? { predictions: view.predictions } : {}),
      ...(view.trend ? { trend: view.trend } : {}),
      // News/social fusion (W2c): the raw region-scoped batch — grounded deterministically BEFORE the LLM.
      ...(view.news !== undefined && view.news.length > 0
        ? { news: view.news, newsOptions: { region: String(view.regionId) } }
        : {}),
    },
  };
  const res = await synthesizeSitRep(input, { ai: services.ai, ...(services.narration ?? {}) });
  if (!res.ok) return res;
  const sitrep = res.value;
  const citations: readonly CitationView[] = sitrep.fields.flatMap((f) =>
    f.citations.map((c) => ({ field: f.field, sourceId: String(c.sourceId) })),
  );
  // Every citation must resolve to a provenance row IN THIS ENVELOPE (Art. XI made checkable). The
  // news-grounded fields cite outlet ids (`news:<host>`) the adapter provenance cannot contain, so the
  // outlet rows are appended here — derived by the same module that mints the citation ids, weakest-mode
  // labelled (see newsOutletProvenance). Found by the S3 SitRep sweep, 2026-08-08.
  const outletRefs = newsOutletProvenance(view.news, view.provenance);
  return ok(
    envelope(sitrep, await ensureProvenance([...view.provenance, ...outletRefs], view.regionId, services), {
      citations,
      meta: { ai_mode: sitrep.aiMode },
    }),
  );
}

/** monitor — data-source catalogue with per-source mode + freshness (provenance transparency, U4). */
async function handleSources(
  command: CommandByVerb<'sources'>,
  services: CoreServices,
): Promise<Result<Envelope, DomainError>> {
  const regionId = command.regionId ?? services.defaultRegionId;
  const srcRes = await services.sources.list(regionId);
  if (!srcRes.ok) return srcRes;
  const provenance = dedupeProvenance(sourcesAsProvenance(srcRes.value));
  return ok(envelope({ regionId, sources: srcRes.value }, provenance));
}

/**
 * monitor — the configured region registry (FR-ZONE-1; closes finding F-01 — the read-model was injected
 * and never consumed). The views are served EXACTLY as the read-model projects them: absent geography/
 * locale fields stay absent, so a client can tell "this deployment does not know the region's tz" apart
 * from a defaulted value (Art. XVI honest degradation, and the F-06 no-substitution rule).
 *
 * Provenance is the REGISTRY itself, not a feed: this data comes from the deployment's region
 * configuration, so attributing it to an upstream source (or to a region's per-source modes) would
 * misreport where it came from. `mode: 'LIVE'` is literal — the real configured registry, never a
 * recorded mock — and `fetchedAt` is the injected clock, so the F1 non-empty-provenance +
 * freshness guarantee holds for this response like every other data response.
 */
async function handleRegions(services: CoreServices): Promise<Result<Envelope, DomainError>> {
  const res = await services.regions.list();
  if (!res.ok) return res;
  const provenance: readonly SourceRef[] = [
    { sourceId: 'region-registry', mode: 'LIVE', fetchedAt: services.clock() },
  ];
  return ok(envelope({ regions: res.value }, provenance));
}

/**
 * Resolve the REGION a mutation belongs to, so the transport can publish a region-keyed SSE delta (F-416).
 *
 * The delta channel is region-keyed for cross-region isolation (THREAT T13.1), so a change nobody can
 * attribute to a region cannot be published to one. `PublicReport.incidentId` is optional — a citizen may
 * report before any incident exists — so this returns `undefined` rather than guessing, and the caller
 * simply publishes nothing. **An unattributable change is silently NOT pushed; it is still picked up by the
 * client's polling rung** (Art. XVI: the degraded path is the one that always works).
 *
 * Never throws and never fails the command: a lookup problem must not turn a successful mutation into an
 * error response. Notification is a side effect of the write, never a precondition for it.
 */
async function regionOfIncident(
  incidentId: IncidentId | undefined,
  services: CoreServices,
): Promise<RegionId | undefined> {
  if (incidentId === undefined) return undefined;
  try {
    const res = await services.incidents.getById(incidentId);
    return res.ok && res.value !== null ? res.value.regionId : undefined;
  } catch {
    return undefined;
  }
}

/** intake — consented public SOS report → UNVERIFIED (no outbound action until verified, Art. XIII). */
async function handleReport(
  command: CommandByVerb<'report'>,
  services: CoreServices,
): Promise<Result<Envelope, DomainError>> {
  const res = await services.reports.intake({
    consent: true,
    source: 'WEB',
    text: command.text,
    ...(command.location ? { location: command.location } : {}),
    // F-362: carry the incident link the entity/DDL/OpenAPI always modelled but no channel ever supplied.
    ...(command.incidentId !== undefined ? { incidentId: command.incidentId } : {}),
    // Live Views v1.2: pass the already-validated (allowlist + SSRF) citizen live-view link through to the
    // entity, which re-enforces the https/non-IP/length floor. Absent unless FEATURE_CITIZEN_STREAM is on.
    ...(command.liveViewUrl !== undefined ? { liveViewUrl: command.liveViewUrl } : {}),
  });
  if (!res.ok) return res;
  const provenance: readonly SourceRef[] = [
    { sourceId: 'public-report', mode: 'LIVE', fetchedAt: services.clock() },
  ];
  // F-416: surface the region so the transport can publish a region-keyed delta. Present only when the
  // report is actually linked to an incident — never a guess (see regionOfIncident).
  const regionId = await regionOfIncident(res.value.incidentId, services);
  return ok(
    envelope(res.value, provenance, {
      meta: { status: res.value.status, ...(regionId !== undefined ? { regionId } : {}) },
    }),
  );
}

/**
 * One triage hop as a Result, whichever failure shape the store uses. The memory store lets the domain's
 * `InvalidTransition` THROW while the pg store returns it as `err` (tryResult) — `commitDecision` needs
 * ONE shape to branch on, so the throw is normalised here. Non-domain throws still propagate (opaque 500).
 */
async function tryTriage(
  services: CoreServices,
  id: CommandByVerb<'verify'>['reportId'],
  decision: CommandByVerb<'verify'>['decision'],
  actorId: CommandByVerb<'verify'>['actorId'],
): Promise<Result<PublicReport, DomainError>> {
  try {
    return await services.reports.triage(id, decision, actorId);
  } catch (e) {
    if (e instanceof DomainError) return err(e);
    throw e;
  }
}

/**
 * Commit the human's decision, making the state machine's mandatory intermediate hop EXPLICIT when the
 * verifier decides an UNVERIFIED report in one click. `TRANSITIONS` is deliberately two-step
 * (UNVERIFIED→TRIAGED→terminal) so the audit trail always shows a human took the report up before
 * deciding it — widening it would erase that guarantee for every caller. Until 2026-08-05 the one-click
 * path just 409'd (InvalidTransition), the queue swallowed the error, and "rejected" reports resurrected
 * on the next refetch. Now the terminal decision performs both hops, EACH audited; a decision that is
 * genuinely illegal (e.g. re-deciding a terminal report) still returns the original conflict truthfully.
 */
async function commitDecision(
  command: CommandByVerb<'verify'>,
  services: CoreServices,
): Promise<Result<PublicReport, DomainError>> {
  const first = await tryTriage(services, command.reportId, command.decision, command.actorId);
  if (first.ok || command.decision === 'TRIAGED' || first.error.code !== 'INVALID_TRANSITION') {
    return first;
  }
  const hop = await tryTriage(services, command.reportId, 'TRIAGED', command.actorId);
  if (!hop.ok) return first; // not the UNVERIFIED case — surface the original conflict, never the hop's
  return tryTriage(services, command.reportId, command.decision, command.actorId);
}

/** decide — human triage (VERIFIER/EM). The only UNVERIFIED → VERIFIED path. */
async function handleVerify(
  command: CommandByVerb<'verify'>,
  services: CoreServices,
): Promise<Result<Envelope, DomainError>> {
  const res = await commitDecision(command, services);
  if (!res.ok) return res;
  const provenance: readonly SourceRef[] = [
    { sourceId: 'public-report', mode: 'LIVE', fetchedAt: services.clock() },
  ];
  // ADVISORY ONLY (Art. XII/XIII/XIV): runs AFTER the decision is already committed above — a vision
  // refusal/disabled/failure never blocks or alters the human's triage decision (fail-open, Art. XVI).
  const visionFinding = await requestVisionAssist(command, services);
  const cap = await capForVerifiedReport(command, res.value, services);
  const regionId = await regionOfIncident(res.value.incidentId, services); // F-416
  return ok(
    envelope(res.value, provenance, {
      meta: {
        decision: command.decision,
        ...(visionFinding !== undefined ? { visionFinding } : {}),
        ...(regionId !== undefined ? { regionId } : {}),
        ...cap,
      },
    }),
  );
}

/**
 * The verifier's "Approve + CAP" lever (F-362): on a VERIFIED decision with `emitCap`, draft a CAP alert for
 * the report's incident and return it under `meta.emittedAlert` — the shape `openapi.yaml` has documented
 * for this transition since S03 and that no code produced.
 *
 * Art. XIII holds at three independent points, so no single mistake re-opens the gate:
 *   1. `emitCap` is honoured ONLY on VERIFIED — a TRIAGED or REJECTED report yields nothing, because "no
 *      outbound action from a report that was never verified" is the invariant, not a policy.
 *   2. What is produced is a DRAFT. Promotion to ACTUAL stays a separate authenticated approval that records
 *      the approver, and `AlertSinkPort.emit` accepts only an approved ACTUAL alert AT THE TYPE LEVEL.
 *   3. An unlinked report drafts NOTHING and says so (`capNotEmitted`) rather than inventing an incident to
 *      attach a public alert to.
 *
 * Failure is non-fatal by design (Art. XVI): the human's triage decision is already committed above, so an
 * unknown incident degrades to a labelled explanation instead of failing a decision that already happened.
 */
async function capForVerifiedReport(
  command: CommandByVerb<'verify'>,
  report: PublicReport,
  services: CoreServices,
): Promise<Readonly<Record<string, unknown>>> {
  if (command.emitCap !== true || command.decision !== 'VERIFIED') return {};
  if (report.incidentId === undefined) {
    return { capNotEmitted: 'report is not linked to an incident — no alert was drafted' };
  }
  const draftRes = await draftCapAlertFor(report.incidentId, services);
  if (!draftRes.ok || draftRes.value === null) {
    return { capNotEmitted: `incident not found: ${report.incidentId} — no alert was drafted` };
  }
  return {
    emittedAlert: draftRes.value.alert,
    note: 'DRAFT — requires authenticated approval before emit (Art. XIII)',
  };
}

/**
 * When the verifier attaches consented, PII-screened imagery to their decision (`visionAssist`) AND the
 * vision-assist gateway is wired (`services.vision`, FEATURE_VISION=on), request an advisory,
 * confidence-scored VisionFinding to inform the human record. Consent/PII-screen gates are enforced by
 * the compliance gateway + VisionAdapter (Art. XIV); this helper NEVER throws and NEVER returns a
 * finding that could be mistaken for a state change — callers attach it to `meta` only.
 */
async function requestVisionAssist(
  command: CommandByVerb<'verify'>,
  services: CoreServices,
): Promise<VisionFinding | undefined> {
  if (!services.vision || !command.visionAssist) return undefined;
  const { imageRef, task, imageConsented, piiScreened } = command.visionAssist;
  const request: ComplianceRequest<VisionMediatePayload> = {
    actorRole: 'VERIFIER', // vision-assist is a triage-time aid — scoped like the verify RBAC gate itself
    modelTier: 'VISION',
    operation: 'vision.analyze',
    payload: { request: { imageRef, task }, context: { imageConsented, piiScreened } },
  };
  try {
    const decision = await services.vision.mediate<VisionMediatePayload, VisionFinding>(request);
    if (!decision.ok || !decision.value.allowed || !decision.value.result) return undefined;
    return decision.value.result;
  } catch {
    return undefined; // an advisory failure must never block or fail the human decision (Art. XIII)
  }
}

/**
 * Build the DRAFT CAP alert for an incident, or `null` when that incident is unknown.
 *
 * Extracted (F-362) so the `alert:draft` verb and the VERIFIED + `emitCap` triage path construct the SAME
 * alert by the SAME rules. Two call sites each building "the DRAFT alert for an incident" is precisely the
 * re-declared-contract defect class this codebase has now hit ten times (F-24/F-140/F-141/F-190/F-192/
 * F-240/F-72/F-380/F-381/F-382) — the second copy does not have to be wrong today to be wrong later.
 *
 * DRAFT is structural, not a convention: `makeAlert` mints a DRAFT, and `AlertSinkPort.emit` accepts only an
 * approved ACTUAL alert at the type level, so neither caller can reach a public sink (Art. XIII).
 */
async function draftCapAlertFor(
  incidentId: IncidentId,
  services: CoreServices,
): Promise<Result<{ readonly alert: Alert; readonly view: IncidentView } | null, DomainError>> {
  const viewRes = await services.incidents.getById(incidentId);
  if (!viewRes.ok) return viewRes;
  const view = viewRes.value;
  if (view === null) return ok(null);
  const category = view.type === 'WILDFIRE' ? 'Fire' : view.type === 'FLOOD' ? 'Met' : 'Safety';
  return ok({
    alert: makeAlert({
      id: asId<AlertId>(services.newId('alert')),
      incidentId: view.id,
      category,
      severity: 'MODERATE',
      edxlKind: 'CAP',
    }),
    view,
  });
}

/**
 * The `data` payload the `alert:draft` verb returns — the ONE declaration of that shape (F-407, the F-200
 * pattern). It was an anonymous literal, and the frontend mirrored it by hand as `{id, state}`: neither key
 * exists on it, so `draftAlert()` returned an object whose every field read `undefined`. The alert's DRAFT
 * marker is `capStatus` (the domain and CAP vocabulary), never `state`.
 */
export interface AlertDraftData {
  readonly alert: Alert;
  readonly headline: string;
}

/** act — construct a DRAFT alert (never emitted here; sending is a separate authenticated step, Art. XIII). */
async function handleAlertDraft(
  command: CommandByVerb<'alert:draft'>,
  services: CoreServices,
): Promise<Result<Envelope, DomainError>> {
  const draftRes = await draftCapAlertFor(command.incidentId, services);
  if (!draftRes.ok) return draftRes;
  if (draftRes.value === null) {
    return err(new DomainError('NOT_FOUND', `incident not found: ${command.incidentId}`));
  }
  const { alert, view } = draftRes.value;
  const data: AlertDraftData = { alert, headline: command.headline };
  return ok(
    envelope(data, await ensureProvenance(view.provenance, view.regionId, services), {
      // F-416: `regionId` comes straight off the incident view here — the one mutating verb that never
      // needs a lookup, because the alert is scoped to an incident by construction.
      meta: {
        note: 'DRAFT — requires authenticated approval before emit (Art. XIII)',
        regionId: view.regionId,
      },
    }),
  );
}

async function regionSourceProvenance(
  regionId: RegionId,
  services: CoreServices,
): Promise<readonly SourceRef[]> {
  const srcRes = await services.sources.list(regionId);
  return srcRes.ok ? dedupeProvenance(sourcesAsProvenance(srcRes.value)) : [];
}

/** Assemble the universal Envelope; freshness defaults to the oldest contributing source (SPEC §2.1). */
function envelope<T>(
  data: T,
  provenance: readonly SourceRef[],
  opts: {
    readonly citations?: readonly CitationView[];
    readonly meta?: Readonly<Record<string, unknown>>;
  } = {},
): Envelope<T> {
  const freshness = oldest(provenance);
  return {
    data,
    provenance,
    ...(freshness ? { freshness } : {}),
    ...(opts.citations ? { citations: opts.citations } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
  };
}
