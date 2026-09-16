// BEACON — in-memory core adapters (E-main; ADR-023/Art. XVI offline-first). The DEFAULT, air-gapped
// wiring for the read-models + public-report store the router needs: zero infra, deterministic, seeded
// from a CoreSeed. The Postgres/live equivalents plug in behind flags (config switch, not a rewrite).
// Adapters may import application read-model interfaces (only application→adapters is forbidden).
import type { Result } from '@/domain/shared/result.js';
import { ok, err, isErr } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  PublicReportId,
  RegionId,
  IncidentId,
  AppUserId,
} from '@/domain/value-objects/ids.js';
import type { PointGeometry } from '@/domain/value-objects/geo.js';
import type { SpatialPort } from '@/ports/infra.js';
import { makePublicReport, transitionPublicReport } from '@/domain/public-report.js';
import type { PublicReport } from '@/domain/public-report.js';
import type { PublicReportPort, PublicReportIntake } from '@/ports/public-report.js';
import type { RetentionCandidate, RetentionStorePort } from '@/ports/governance.js';
import type { SourceRef } from '@/ports/interaction.js';
import type { NewsItem } from '@/ports/intel.js';
import {
  deriveIncidentFacts,
  type IncidentDerivationInput,
} from '@/application/derivation/derive-cop.js';
import type {
  RegionReadModel,
  IncidentReadModel,
  SourceReadModel,
  RegionView,
  IncidentView,
  SourceView,
} from '@/application/interaction/command-router.js';

/** A seeded incident as RAW INPUTS: its identity/provenance + the derivation inputs whose facts/trend are
 *  COMPUTED at read time (exposure count, top-priority asset, escalation trend — never hand-authored). */
export interface IncidentSeed {
  readonly id: IncidentId;
  readonly regionId: RegionId;
  readonly type: string;
  readonly status: string;
  readonly headline: string;
  readonly provenance: readonly SourceRef[];
  readonly freshness?: string;
  readonly derivation: IncidentDerivationInput;
  /** Region-scoped news/social batch (live-seed-fetched) for the deterministic news-grounding pass (Art. XIV). */
  readonly news?: readonly NewsItem[];
}

/** The offline dataset the memory core serves. Region-keyed sources; incidents carry their own regionId. */
export interface CoreSeed {
  readonly defaultRegionId: string;
  readonly regions: readonly RegionView[];
  readonly incidents: readonly IncidentSeed[];
  readonly sources: Readonly<Record<string, readonly SourceView[]>>; // regionId → sources
}

/** Read-models over the seed. Pure lookups + deterministic derivation — no IO, no clock. Facts/trend are
 *  COMPUTED via the injected SpatialPort (Art. XII); the LLM never lands here. Sources are exposed via
 *  `listSources` (wrapped by `sourceReadModel()`) to avoid a `list()` clash between region + source models. */
export class MemoryReadModel implements RegionReadModel, IncidentReadModel {
  constructor(
    private readonly seed: CoreSeed,
    private readonly spatial: SpatialPort,
  ) {}

  async list(): Promise<Result<readonly RegionView[], DomainError>> {
    return ok(this.seed.regions);
  }

  /** Compute a seeded incident's grounded facts + escalation trend (deterministic; SpatialPort-backed). */
  private toView(seed: IncidentSeed): Result<IncidentView, DomainError> {
    const res = deriveIncidentFacts(seed.derivation, this.spatial);
    if (isErr(res)) return res;
    return ok({
      id: seed.id,
      regionId: seed.regionId,
      type: seed.type,
      status: seed.status,
      headline: seed.headline,
      facts: res.value.facts,
      priorities: res.value.priorities,
      trend: res.value.trend,
      provenance: seed.provenance,
      // The trend-derived predictions the derivation just COMPUTED (C2.2; ADR-033 §4.1/§4.2), carried to the
      // SitRep path so the outlook engine can rank them (§5). Geometry-less by design, so this is the only
      // path they reach a reader by (F-77). Omitted when neither kind projected — an absent Outlook, not an
      // empty claim.
      ...(res.value.predictions.length > 0 ? { predictions: res.value.predictions } : {}),
      ...(seed.freshness !== undefined ? { freshness: seed.freshness } : {}),
      ...(seed.news !== undefined ? { news: seed.news } : {}),
    });
  }

  async listByRegion(regionId: RegionId): Promise<Result<readonly IncidentView[], DomainError>> {
    const views: IncidentView[] = [];
    for (const seed of this.seed.incidents) {
      if (seed.regionId !== regionId) continue;
      const view = this.toView(seed);
      if (isErr(view)) return view;
      views.push(view.value);
    }
    return ok(views);
  }

  async getById(id: IncidentId): Promise<Result<IncidentView | null, DomainError>> {
    const seed = this.seed.incidents.find((i) => i.id === id);
    if (seed === undefined) return ok(null);
    return this.toView(seed);
  }

  async listSources(regionId: RegionId): Promise<Result<readonly SourceView[], DomainError>> {
    return ok(this.seed.sources[regionId] ?? this.seed.sources[this.seed.defaultRegionId] ?? []);
  }
}

/** SourceReadModel.list delegates to the read-model's region-keyed lookup (kept as a distinct binding). */
export function sourceReadModel(rm: MemoryReadModel): SourceReadModel {
  return { list: (regionId) => rm.listSources(regionId) };
}

const DAY_MS = 86_400_000;

/**
 * The seeded CA demo incident the queue rows belong to (F-417). Declared as a plain literal rather than
 * imported from `src/main/feature-seed.ts`: this adapter must not depend on the composition root (the
 * dependency-cruiser `adapters-never-import-main` boundary). The pairing is held by
 * `memory-core.test.ts`, which asserts this id is one the default feature seed actually creates — so a
 * rename there fails a test here instead of silently re-orphaning the demo reports.
 */
const DEMO_INCIDENT_ID = 'us-ca-wildfire-demo';

/**
 * The offline verifier-queue seed (GET /reports). A small set of CONSENTED, already-TRIAGED reports so a
 * VERIFIER can drive the decide leg end-to-end (TRIAGED → VERIFIED/REJECTED is a legal hop; UNVERIFIED is
 * not directly approvable). One carries a precise SOS location — revealed ONLY to RESPONDER+ (Art. XIV,
 * gated in the GET /reports handler). MOCK/offline; `purgeAfter` is derived from the injected clock.
 *
 * **Both rows are LINKED to the seeded CA incident (F-417).** They were not, and the consequence was a
 * silent hole on the most consequential demo path: `emitCap` scopes its DRAFT CAP to the report's incident
 * (F-362), so an unlinked report correctly answers `meta.capNotEmitted: "report is not linked to an
 * incident"` — meaning **"Approve + CAP" on either pre-seeded queue row emitted nothing at all.** The
 * scripted golden path happens to survive it (it selects an incident and files a fresh SOS), but a
 * presenter or judge who simply opens the verifier queue and clicks the CAP button — the obvious thing to
 * do — would have seen nothing happen, on camera, on the Art. XIII surface.
 *
 * Linking them is not a test accommodation: a report sitting in a verifier's queue for a live incident IS
 * associated with that incident. The unlinked state remains reachable and meaningful (a citizen reporting
 * before any incident exists), and `capForVerifiedReport` still handles it honestly — it is simply no
 * longer the state the demo seed ships in.
 */
export function defaultReportQueueSeed(purgeAfter: string): readonly PublicReport[] {
  return [
    makePublicReport({
      id: asId<PublicReportId>('rep-demo-1'),
      incidentId: asId<IncidentId>(DEMO_INCIDENT_ID),
      source: 'WEB',
      status: 'TRIAGED',
      consent: true,
      purgeAfter,
      confidence: 0.62,
      // The CLAIM the verifier reads before approving/rejecting (Art. XIII). Deliberately PII-free — a
      // landmark, not a person or address — because this row is demo material AND the retention example.
      // Written to MATCH its blend below: a specific, well-located, corroborated observation reads as 0.62.
      text: 'Heavy smoke and a visible flame front on the ridge above the canyon road. Neighbours are reporting the same. We are packing to leave now.',
      // Deterministic blend sub-scores (Art. XII — never LLM): the verifier UI renders these so a human
      // sees WHY the report scored 0.62 (well-geocoded WEB report, medium authority, decent corroboration).
      confidenceComponents: { geocode: 0.8, authority: 0.5, classifier: 0.6, corroboration: 0.55 },
      geomPrecise: { type: 'Point', coordinates: [-121.58, 39.71] },
    }),
    makePublicReport({
      id: asId<PublicReportId>('rep-demo-2'),
      incidentId: asId<IncidentId>(DEMO_INCIDENT_ID),
      source: 'SMS',
      status: 'TRIAGED',
      consent: true,
      purgeAfter,
      confidence: 0.41,
      // The contrasting claim: vague location, no corroboration, second-hand — which is exactly why the
      // blend below lands at 0.41. Seeing the two texts side by side is what makes the score legible.
      text: 'smoke smell really strong here, cant see flames yet. someone said the road out is already blocked',
      // Lower blend: a low-corroboration SMS report — the classic "flag for the verifier" profile (Art. XIV).
      confidenceComponents: { geocode: 0.45, authority: 0.4, classifier: 0.5, corroboration: 0.2 },
    }),
  ];
}

/**
 * In-memory PublicReportPort. Intake creates an UNVERIFIED report; triage advances it through the
 * domain state machine (transitionPublicReport enforces legal transitions). Consent is a type-level
 * precondition on the intake payload (EV4). `clock`/`newId` injected → deterministic.
 *
 * Every state-changing triage writes a `TriageAuditRecord` (actor, decision, target, time) so the human
 * approver required by Art. XIII / CLARIF Q6 is recorded — the port's `actorId` is not dropped.
 * Reports live only in this process (offline default); durable persistence is the Postgres adapter.
 */
export interface TriageAuditRecord {
  readonly reportId: string;
  readonly decision: 'TRIAGED' | 'VERIFIED' | 'REJECTED';
  readonly actorId: string;
  readonly at: string; // ISO-8601
}

export class MemoryReportStore implements PublicReportPort, RetentionStorePort {
  private readonly reports = new Map<string, PublicReport>();
  private readonly audit: TriageAuditRecord[] = [];

  constructor(
    private readonly clock: () => string,
    private readonly newId: (prefix: string) => string,
    private readonly retentionDays = 30,
    seed: readonly PublicReport[] = [],
  ) {
    for (const r of seed) this.reports.set(r.id, r);
  }

  /** The append-only triage audit trail (who approved/rejected what, when). Read-only view. */
  auditTrail(): readonly TriageAuditRecord[] {
    return this.audit;
  }

  /**
   * The verifier queue (GET /reports): every held report, insertion-ordered. RBAC + precise-geometry
   * gating (Art. XIV) live in the HTTP handler — the store returns the canonical reports unfiltered.
   */
  list(): Promise<Result<readonly PublicReport[], DomainError>> {
    return Promise.resolve(ok([...this.reports.values()]));
  }

  async intake(report: PublicReportIntake): Promise<Result<PublicReport, DomainError>> {
    const purgeAfter = new Date(
      Date.parse(this.clock()) + this.retentionDays * DAY_MS,
    ).toISOString();
    const created = makePublicReport({
      id: asId<PublicReportId>(this.newId('rep')),
      source: report.source,
      consent: report.consent,
      purgeAfter,
      // Receipt instant from the injected clock — powers the live-view chip's ~2h TTL fade (isLiveViewFresh).
      receivedAt: this.clock(),
      // The reporter's claim — REQUIRED by PublicReportIntake since S03 and dropped here until now, so the
      // verifier queue had nothing to show the human approving/rejecting it (Art. XIII). Purged with the row.
      text: report.text,
      // Precise SOS location is responder-only (Art. XIV); the app layer gates its serialization.
      ...(report.location
        ? { geomPrecise: { type: 'Point', coordinates: report.location } satisfies PointGeometry }
        : {}),
      // F-362: persist the incident link the intake now carries. Absent stays absent — an orphaned report
      // is a real state (a citizen may report before any incident exists), never a guessed association.
      ...(report.incidentId !== undefined ? { incidentId: report.incidentId } : {}),
      // Live Views v1.2: persist the consent-gated citizen live-view link on the row (purged with it).
      ...(report.liveViewUrl !== undefined ? { liveViewUrl: report.liveViewUrl } : {}),
    });
    this.reports.set(created.id, created);
    return ok(created);
  }

  async triage(
    id: PublicReportId,
    decision: 'TRIAGED' | 'VERIFIED' | 'REJECTED',
    actorId: AppUserId,
  ): Promise<Result<PublicReport, DomainError>> {
    const existing = this.reports.get(id);
    // An unknown id is NOT_FOUND — PATCH /reports/:id operates on an existing report (SPEC §2.2); never
    // fabricate one (that would let "verify" record a decision on a report nobody submitted).
    if (existing === undefined) {
      return err(new DomainError('NOT_FOUND', `public report not found: ${id}`));
    }
    const next = transitionPublicReport(existing, decision); // throws InvalidTransition on an illegal hop
    this.reports.set(next.id, next);
    this.audit.push({ reportId: id, decision, actorId: String(actorId), at: this.clock() });
    return ok(next);
  }

  // ── RetentionStorePort (Art. XIV purge sweep; finding F-25) ─────────────────────────────────────
  // `purgeAfter` was stamped on every report from the start and NOTHING ever deleted an expired one, so
  // the "no PII retention beyond the incident lifecycle" guarantee was claimed and unenforced. These two
  // id-only operations are the seam the sweep executor (src/application/governance/retention-sweep.ts)
  // needs; the retention window, the cutoff arithmetic and the governance record all live in that pure
  // use-case, so this store holds no policy. Implemented on the DEFAULT (offline) store as well as on
  // Postgres, because a sweep that only ran against the durable store would leave the default unenforced.

  readonly storeLabel = 'memory';
  readonly datasetLabel = 'public_report';

  /** Reports whose retention deadline is at or before `asOf` (the injected cutoff instant). */
  expired(asOf: string): Promise<Result<readonly RetentionCandidate[], DomainError>> {
    const cutoff = Date.parse(asOf);
    if (Number.isNaN(cutoff)) {
      return Promise.resolve(
        err(new DomainError('PARSE_ERROR', `retention cutoff is not an instant: ${asOf}`)),
      );
    }
    const due = [...this.reports.values()]
      .filter((r) => Date.parse(r.purgeAfter) <= cutoff)
      .map((r): RetentionCandidate => ({ id: r.id, purgeAfter: r.purgeAfter }));
    return Promise.resolve(ok(due));
  }

  /** Hard-drop the rows. The whole report goes — including `geomPrecise` and `liveViewUrl`, which are
   *  fields ON it (src/domain/public-report.ts:41), so no personal datum survives its own deadline. */
  purge(ids: readonly string[]): Promise<Result<number, DomainError>> {
    let removed = 0;
    for (const id of ids) if (this.reports.delete(id)) removed += 1;
    return Promise.resolve(ok(removed));
  }
}
