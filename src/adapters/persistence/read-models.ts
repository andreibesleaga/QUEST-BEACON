// BEACON — Postgres-backed read-models + durable public-report store (Phase-B lane B3; ADR-013/Art. II).
// These adapters satisfy the SAME projection interfaces the command-router's CoreServices expect
// (RegionReadModel / SourceReadModel / PublicReportPort), so `FEATURE_STORE=postgres` is a drop-in swap
// for the in-memory defaults (memory-core.ts) — NOT a core rewrite. The incident COP/map/draft-alerts
// stay derived per-read in memory (no pg incident read-model here, by design).
//
// DECISION (locked): Postgres backs the DURABLE, audit-critical data — public reports + the hash-chained
// triage audit + source-records + regions. The report store re-uses the DOMAIN factories (makePublicReport
// / transitionPublicReport) for validation + legal-transition enforcement, and the DOMAIN hash link
// (makeAuditEvent/linkHash) so every triage decision is committed to a tamper-evident chain — parity with
// the compliance audit-chain adapter. Failure NEVER throws upstream: every op is wrapped in a typed Result.
import { desc, eq, like } from 'drizzle-orm';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  AppUserId,
  AuditEventId,
  IncidentId,
  PublicReportId,
} from '@/domain/value-objects/ids.js';
import type { Geometry, PointGeometry } from '@/domain/value-objects/geo.js';
import { makeAuditEvent } from '@/domain/audit-event.js';
import { makePublicReport, transitionPublicReport } from '@/domain/public-report.js';
import type { ConfidenceComponents, PublicReport } from '@/domain/public-report.js';
import type { PublicReportIntake, PublicReportPort } from '@/ports/public-report.js';
import type {
  RegionReadModel,
  RegionView,
  SourceReadModel,
  SourceView,
} from '@/application/interaction/command-router.js';
import type { TriageAuditRecord } from '@/adapters/memory/memory-core.js';
import type { Db } from './client';
import { tryResult } from './repository';
import { regionMapper, sourceViewMapper } from './mappers';
import { auditEvent, incident, publicReport, region, sourceRecord } from './schema';
import { resolveIncidentRowId } from './natural-keys';
import { inArray } from 'drizzle-orm';

const DAY_MS = 86_400_000;
// The durable triage audit lives in `audit_event`; triage rows are tagged with this target prefix so the
// chain can be read back + verified independently of any other (e.g. AI-compliance) audit events.
const TRIAGE_TARGET_PREFIX = 'public_report:';
const ACTOR_SEP = '|actor:';

/** `.returning()` yields ≥1 row; guard so a domain mapper never receives `undefined`. */
function firstRow<R>(rows: readonly R[], what: string): R {
  const row = rows[0];
  if (row === undefined) throw new DomainError('PARSE_ERROR', `${what} returned no row`);
  return row;
}

// ── Region read-model ─────────────────────────────────────────────────────────

/** Region projection over the `region` table → `RegionView{id,name}` (drop-in for CoreServices.regions). */
export function makePgRegionReadModel(db: Db): RegionReadModel {
  return {
    list: (): Promise<Result<readonly RegionView[], DomainError>> =>
      tryResult(async () =>
        (await db.select().from(region)).map((r): RegionView => {
          const dom = regionMapper.fromRow(r);
          return { id: dom.id, name: dom.name };
        }),
      ),
  };
}

// ── Source read-model ───────────────────────────────────────────────────────────

/**
 * Source projection over `source_record` → `SourceView{sourceId,mode,fetchedAt}`.
 *
 * LIMITATION (documented, deliberate): `source_record` has NO region column
 * (schema/core-tables.ts) so the `regionId` filter cannot be honored by the schema. Rather than add a
 * schema migration + a new FK, this returns ALL configured sources for ANY region. Per-region source
 * scoping remains available via the region-registry's `sourceModeOverrides` (config), not this table.
 */
export function makePgSourceReadModel(db: Db): SourceReadModel {
  return {
    // The `regionId` arg is intentionally omitted (structurally valid) — see the no-region limitation above.
    //
    // Projected through `sourceViewMapper`, not `sourceRecordMapper.fromRow`: the view carries no licence,
    // but the entity factory (rightly, Art. XI) refuses a SourceRecord without one — and
    // `source_record.license` is nullable: rows written by the provenance sink before it carried the
    // licence (2026-09-11) stayed NULL because the upsert never repaired them. Routing the projection
    // through the factory made ONE such legacy row turn `/status` and `/sources` into a 422 for everyone
    // (live, 2026-09-15). A read that exposes no licence must not fail on a missing one (Art. XVI); the
    // view mapper still validates the mode and the fetch instant it DOES expose, and the sink now heals
    // the column on the next poll. Where a full SourceRecord is materialised (`makeSourceRecordRepository`
    // in repositories.ts) the entity mapper still enforces the licence; citations resolve source rows by
    // id (`resolveSourceRowId`) and never read it.
    list: (): Promise<Result<readonly SourceView[], DomainError>> =>
      tryResult(async () => (await db.select().from(sourceRecord)).map(sourceViewMapper.fromRow)),
  };
}

// ── Public-report store (durable) ───────────────────────────────────────────────

/** A triage audit record with its tamper-evident chain link (extends the memory-store shape for parity). */
export interface PgTriageAuditRecord extends TriageAuditRecord {
  readonly hash: string;
  readonly prevHash?: string;
}

/** The durable report store: the PublicReportPort plus the verifier-queue `list()` + `auditTrail()`. */
export interface PgPublicReportStore extends PublicReportPort {
  list(): Promise<Result<readonly PublicReport[], DomainError>>;
  auditTrail(): Promise<Result<readonly PgTriageAuditRecord[], DomainError>>;
}

// Insert values for a NEW report. `id` is intentionally omitted — the DB mints the uuid PK
// (idColumn defaultRandom); we read it back from `.returning()`. `newId`/domain ids are not uuids.
function reportInsertValues(
  e: PublicReport,
  incidentRowId: string | null,
): Omit<typeof publicReport.$inferInsert, 'id'> {
  return {
    source: e.source,
    status: e.status,
    consent: e.consent,
    purgeAfter: new Date(e.purgeAfter),
    // `public_report.incident_id` is a uuid FK to `incident.id`; the intake names the incident by its
    // DOMAIN id (`discovered:us-ca:…`, `us-ca-wildfire-demo`). Until 2026-09-14 the domain id was written
    // straight into the FK, so every report that named an incident failed to insert on the live
    // deployment (the checker's "report → verification queue: filed 400"). Resolved through the natural
    // key; an incident the mirror has not written yet leaves the link empty rather than failing the report.
    ...(incidentRowId !== null ? { incidentId: incidentRowId } : {}),
    ...(e.confidence !== undefined ? { confidence: e.confidence } : {}),
    ...(e.confidenceComponents !== undefined
      ? { confidenceComponents: e.confidenceComponents as Record<string, number> }
      : {}),
    ...(e.geomGeneralized !== undefined ? { geomGeneralized: e.geomGeneralized } : {}),
    ...(e.geomPrecise !== undefined ? { geomPrecise: e.geomPrecise } : {}),
    ...(e.receivedAt !== undefined ? { receivedAt: e.receivedAt } : {}),
    ...(e.liveViewUrl !== undefined ? { liveViewUrl: e.liveViewUrl } : {}),
    ...(e.category !== undefined ? { category: e.category } : {}),
    ...(e.text !== undefined ? { reportText: e.text } : {}),
    ...tallyInsertValues(e.casualtyTally),
  };
}

// FR-D6-5: the COUNT is stored; the mandatory caveat is not a column at all (see intel-tables.ts), so a row
// can never be the thing that loses it. `reportFromRow` re-stamps it via the domain factory.
function tallyInsertValues(tally: PublicReport['casualtyTally']): {
  casualtyCount?: number;
  casualtyAsOf?: string;
} {
  if (tally === undefined) return {};
  return {
    casualtyCount: tally.count,
    ...(tally.asOf !== undefined ? { casualtyAsOf: tally.asOf } : {}),
  };
}

/** The inverse: a stored count becomes factory INPUT, so hydration goes through the stamping constructor. */
function tallyFromRow(
  count: number | null,
  asOf: string | null,
): { casualtyTally?: { count: number; asOf?: string } } {
  if (count == null) return {};
  return { casualtyTally: { count, ...(asOf != null ? { asOf } : {}) } };
}

// Re-run the domain factory on read (ACL re-validation — parity with mappers.ts). `!= null` handles both
// a NULL column and an absent key (real drizzle rows use null; a fuller shape stays robust either way).
/**
 * The nullable columns, hoisted out of {@link reportFromRow} so adding a persisted field does not push that
 * function past the complexity ceiling (each `!= null` spread costs a branch). Same `!= null` semantics.
 */
function reportOptionalsFromRow(
  r: typeof publicReport.$inferSelect,
): Partial<Parameters<typeof makePublicReport>[0]> {
  return {
    ...(r.confidence != null ? { confidence: r.confidence } : {}),
    ...(r.confidenceComponents != null
      ? { confidenceComponents: r.confidenceComponents as ConfidenceComponents }
      : {}),
    ...(r.geomGeneralized != null ? { geomGeneralized: r.geomGeneralized as Geometry } : {}),
    ...(r.geomPrecise != null ? { geomPrecise: r.geomPrecise as Geometry } : {}),
    ...(r.receivedAt != null ? { receivedAt: r.receivedAt } : {}),
    ...(r.liveViewUrl != null ? { liveViewUrl: r.liveViewUrl } : {}),
    ...(r.category != null
      ? { category: r.category as NonNullable<PublicReport['category']> }
      : {}),
    ...(r.reportText != null ? { text: r.reportText } : {}),
  };
}

/** The row's incident link, read back as the DOMAIN id the API speaks (`domainIds`: uuid → domain id). */
function reportFromRow(
  r: typeof publicReport.$inferSelect,
  domainIds: ReadonlyMap<string, string> = new Map(),
): PublicReport {
  const incidentId = r.incidentId != null ? domainIds.get(r.incidentId) : undefined;
  return makePublicReport({
    id: asId<PublicReportId>(r.id),
    source: r.source as PublicReport['source'],
    status: r.status as PublicReport['status'],
    consent: r.consent,
    purgeAfter: r.purgeAfter ? r.purgeAfter.toISOString() : '',
    ...reportOptionalsFromRow(r),
    ...(incidentId !== undefined ? { incidentId: asId<IncidentId>(incidentId) } : {}),
    ...tallyFromRow(r.casualtyCount, r.casualtyAsOf),
  });
}

// Parse a persisted triage audit row (target = `public_report:<reportId>|actor:<actorId>`) back to a
// record. The actor is folded into `target` (text, no FK) so the DB `actor_id` uuid FK is never risked.
function auditRowToRecord(r: typeof auditEvent.$inferSelect): PgTriageAuditRecord {
  const body = r.target.startsWith(TRIAGE_TARGET_PREFIX)
    ? r.target.slice(TRIAGE_TARGET_PREFIX.length)
    : r.target;
  const sep = body.indexOf(ACTOR_SEP);
  const reportId = sep >= 0 ? body.slice(0, sep) : body;
  const actorId = sep >= 0 ? body.slice(sep + ACTOR_SEP.length) : '';
  return {
    reportId,
    decision: r.action as TriageAuditRecord['decision'],
    actorId,
    at: r.at.toISOString(),
    hash: r.hash ?? '',
    ...(r.prevHash != null ? { prevHash: r.prevHash } : {}),
  };
}

class PgReportStore implements PgPublicReportStore {
  constructor(
    private readonly db: Db,
    private readonly clock: () => string,
    private readonly newId: (prefix: string) => string,
    private readonly retentionDays = 30,
  ) {}

  intake(report: PublicReportIntake): Promise<Result<PublicReport, DomainError>> {
    return tryResult(async () => {
      const purgeAfter = new Date(
        Date.parse(this.clock()) + this.retentionDays * DAY_MS,
      ).toISOString();
      // Validate via the domain factory (consent/geom/purgeAfter invariants). The id is a throwaway —
      // the DB mints the real uuid PK on insert; precise SOS location is responder-only (app-layer gate).
      const validated = makePublicReport({
        id: asId<PublicReportId>(this.newId('rep')),
        source: report.source,
        consent: report.consent,
        purgeAfter,
        // Receipt instant from the injected clock — parity with the memory store (powers the ~2h TTL fade).
        receivedAt: this.clock(),
        ...(report.location
          ? { geomPrecise: { type: 'Point', coordinates: report.location } satisfies PointGeometry }
          : {}),
        // The reporter's claim — REQUIRED by PublicReportIntake since S03 and dropped here until now, so
        // the verifier queue had nothing to show the human deciding on it (Art. XIII). Purged with the row.
        text: report.text,
        // F-362: carry the incident link (public_report.incident_id — a nullable FK that has existed in
        // schema.sql since S03 and that no intake path ever populated). Parity with the memory store.
        ...(report.incidentId !== undefined ? { incidentId: report.incidentId } : {}),
        // Live Views v1.2: persist the consent-gated citizen live-view link on the durable row (was dropped).
        ...(report.liveViewUrl !== undefined ? { liveViewUrl: report.liveViewUrl } : {}),
      });
      const incidentRowId =
        report.incidentId !== undefined
          ? await resolveIncidentRowId(this.db, String(report.incidentId))
          : null;
      const rows = await this.db
        .insert(publicReport)
        .values(reportInsertValues(validated, incidentRowId))
        .returning();
      return reportFromRow(
        firstRow(rows, 'public_report.intake'),
        incidentRowId !== null ? new Map([[incidentRowId, String(report.incidentId)]]) : new Map(),
      );
    });
  }

  triage(
    id: PublicReportId,
    decision: 'TRIAGED' | 'VERIFIED' | 'REJECTED',
    actorId: AppUserId,
  ): Promise<Result<PublicReport, DomainError>> {
    return tryResult(async () => {
      const [row] = await this.db
        .select()
        .from(publicReport)
        .where(eq(publicReport.id, id))
        .limit(1);
      // Unknown id is NOT_FOUND — triage operates on an existing report (never fabricate one).
      if (row === undefined) {
        throw new DomainError('NOT_FOUND', `public report not found: ${id}`);
      }
      // transitionPublicReport throws InvalidTransition on an illegal hop (e.g. UNVERIFIED→VERIFIED).
      const domainIds = await this.domainIdsFor([row]);
      const next = transitionPublicReport(reportFromRow(row, domainIds), decision);
      const updated = await this.db
        .update(publicReport)
        .set({ status: next.status })
        .where(eq(publicReport.id, id))
        .returning();
      await this.appendTriageAudit(id, decision, actorId);
      return reportFromRow(firstRow(updated, 'public_report.triage'), domainIds);
    });
  }

  // Append a hash-chained triage audit event (durable, tamper-evident). prevHash = the current triage
  // chain tail; hash = linkHash(prevHash, payload) via the domain makeAuditEvent. The surrogate uuid PK
  // is DB-minted (not part of the hash). actor_id column stays NULL; the actor is carried in `target`.
  private async appendTriageAudit(
    id: PublicReportId,
    decision: 'TRIAGED' | 'VERIFIED' | 'REJECTED',
    actorId: AppUserId,
  ): Promise<void> {
    const [tail] = await this.db
      .select()
      .from(auditEvent)
      .where(like(auditEvent.target, `${TRIAGE_TARGET_PREFIX}%`))
      .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id))
      .limit(1);
    const event = makeAuditEvent({
      id: asId<AuditEventId>(this.newId('ae')),
      action: decision,
      target: `${TRIAGE_TARGET_PREFIX}${id}${ACTOR_SEP}${actorId}`,
      at: this.clock(),
      ...(tail?.hash ? { prevHash: tail.hash } : {}),
    });
    await this.db.insert(auditEvent).values({
      action: event.action,
      target: event.target,
      at: new Date(event.at),
      hash: event.hash,
      ...(event.prevHash !== undefined ? { prevHash: event.prevHash } : {}),
    });
  }

  list(): Promise<Result<readonly PublicReport[], DomainError>> {
    // Canonical reports, unfiltered — RBAC + precise-geometry gating (Art. XIV) is the HTTP handler's
    // job (parity with the memory store); the store returns geomPrecise so the handler CAN reveal it.
    return tryResult(async () => {
      const rows = await this.db.select().from(publicReport);
      const domainIds = await this.domainIdsFor(rows);
      return rows.map((r) => reportFromRow(r, domainIds));
    });
  }

  /** uuid → domain id for every incident the rows link to — one query, so a list is not N+1. */
  private async domainIdsFor(
    rows: readonly { readonly incidentId: string | null }[],
  ): Promise<ReadonlyMap<string, string>> {
    const ids = [...new Set(rows.flatMap((r) => (r.incidentId != null ? [r.incidentId] : [])))];
    if (ids.length === 0) return new Map();
    const found = await this.db
      .select({ id: incident.id, domainId: incident.domainId })
      .from(incident)
      .where(inArray(incident.id, ids));
    // A DB-minted incident carries no domain id; its uuid IS the id `resolveIncidentRowId` accepts, so the
    // link survives the round trip either way (review, PR #34).
    return new Map(found.map((f) => [f.id, f.domainId ?? f.id] as const));
  }

  auditTrail(): Promise<Result<readonly PgTriageAuditRecord[], DomainError>> {
    return tryResult(async () => {
      const rows = await this.db
        .select()
        .from(auditEvent)
        .where(like(auditEvent.target, `${TRIAGE_TARGET_PREFIX}%`))
        .orderBy(auditEvent.createdAt, auditEvent.id);
      return rows.map(auditRowToRecord);
    });
  }
}

/**
 * Build the durable Postgres public-report store. Same PublicReportPort surface as MemoryReportStore
 * (+ list/auditTrail), so it is a drop-in for CoreServices.reports and the verifier-queue read-model,
 * and is injectable/overridable (POST/PATCH/GET /reports share ONE instance — the lead wires this).
 */
export function makePgPublicReportStore(
  db: Db,
  clock: () => string,
  newId: (prefix: string) => string,
  retentionDays = 30,
): PgPublicReportStore {
  return new PgReportStore(db, clock, newId, retentionDays);
}
