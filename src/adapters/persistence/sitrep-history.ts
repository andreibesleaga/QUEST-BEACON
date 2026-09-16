// BEACON — durable SitRep HISTORY + its citations (UNIMPLEMENTED_REGISTER row 30; Art. XI/XII, ADR-013).
//
// WHAT THIS IS, AND — more importantly — WHAT IT IS NOT.
//
// The UI's SitRep read path is unchanged and stays ENGINE-COMPUTED PER READ. This store never feeds it.
// A persisted SitRep is a snapshot of what the picture looked like at one instant; rendering it later as
// the current situation would show an operator a fire footprint, a crest and a priority order that the
// sources have since moved past — a stale report presented as live, which is a correctness bug in a common
// operating picture, not a caching optimisation. So the row is written for AUDIT and HISTORY ("what did
// BEACON say at 22:00, and on which sources?") and is deliberately NOT re-hydratable into a `SitRep`:
// `listByIncident` returns a {@link SitRepHistoryRecord}, a type the render path cannot accept.
//
// The grounding travels with it. `sitrep` has no `fields` column — in the relational model the FIELDS ARE
// THE CITATION ROWS (Art. XI: every generated field carries ≥1 citation → SOURCE_RECORD). A history row
// without them would be an ungrounded claim in the audit trail, so the write is all-or-nothing: if any
// citation fails, the sitrep row is removed again.
//
// This is also where the citation repository (repositories.ts) finally gets a caller — it has had a working
// upsert since E3 and no composition ever wired it, which is why `citation` was an empty table.
import { randomUUID } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { makeCitation } from '@/domain/citation.js';
import type { Citation } from '@/domain/citation.js';
import type { AiMode, SitRep, SitRepTrend } from '@/domain/sitrep.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { CitationId, IncidentId, SitRepId } from '@/domain/value-objects/ids.js';
import type { RepositoryPort } from '@/ports/infra.js';
import type { Db } from './client';
import { tryResult } from './repository';
import { makeCitationRepository } from './repositories';
import { resolveIncidentRowId, resolveSourceRowId } from './natural-keys.js';
import { citation, sitrep } from './schema';

/**
 * One persisted SitRep, as HISTORY. Structurally not a `SitRep`: it carries no `fields`, no `priorities`
 * and no `outlook`, so a display path that expects the live report cannot silently accept a stale one.
 * `citationCount` answers the only question the audit trail needs of it — was this report grounded?
 */
export interface SitRepHistoryRecord {
  /** The DB-minted uuid PK of the `sitrep` row (the domain SitRepId is not a uuid). */
  readonly rowId: string;
  readonly incidentId: IncidentId;
  readonly generatedAt: string;
  readonly aiMode: AiMode;
  readonly citationCount: number;
  readonly trend?: SitRepTrend;
  readonly summary?: string;
}

export interface PgSitRepHistoryStore {
  /** Append one synthesized SitRep to the audit history, with a citation row per grounded field. */
  /** Persist one report as history. `null` = skipped because its incident has no stored row (ADR-039 §2a). */
  record(report: SitRep): Promise<Result<SitRepHistoryRecord | null, DomainError>>;
  /** The incident's history, newest first. NOT a read path for the current SitRep — see the file header. */
  listByIncident(
    incidentId: IncidentId,
  ): Promise<Result<readonly SitRepHistoryRecord[], DomainError>>;
}

export interface PgSitRepHistoryOptions {
  readonly db: Db;
  /** The EXISTING citation repository (repositories.ts). Injectable so a test can drive its failure path. */
  readonly citations?: RepositoryPort<Citation, CitationId>;
  /** Mints the citation uuid PK. Defaults to `crypto.randomUUID`; tests inject a counter. */
  readonly newCitationId?: () => string;
  /**
   * ADR-039 — natural-key resolvers. Injectable because they are the seam where the domain's readable ids
   * (`us-ca-wildfire-demo`, `firms`) become the surrogate uuids the FKs require; tests drive them directly
   * instead of standing up a schema. Default to the db-backed pair in `natural-keys.ts`.
   */
  readonly resolveIncident?: (domainIncidentId: string) => Promise<string | null>;
  readonly resolveSource?: (sourceKey: string) => Promise<string>;
}

type SitRepRow = typeof sitrep.$inferSelect;

function firstRow<R>(rows: readonly R[], what: string): R {
  const row = rows[0];
  if (row === undefined) throw new DomainError('PARSE_ERROR', `${what} returned no row`);
  return row;
}

function recordFromRow(r: SitRepRow, citationCount: number): SitRepHistoryRecord {
  return {
    rowId: r.id,
    incidentId: asId<IncidentId>(r.incidentId),
    generatedAt: r.generatedAt.toISOString(),
    aiMode: r.aiMode as AiMode,
    citationCount,
    ...(r.trend !== null ? { trend: r.trend as SitRepTrend } : {}),
    ...(r.summary !== null ? { summary: r.summary } : {}),
  };
}

/**
 * The citation rows one SitRep grounds to. A field with no narrated claim is cited BY NAME: the citation
 * records WHICH field a source grounds, which is the grounding contract itself — it never invents a
 * sentence the report did not make (Art. XII).
 */
function citationsFor(
  report: SitRep,
  rowId: string,
  newId: () => string,
  sourceRowIds: ReadonlyMap<string, string>,
): readonly Citation[] {
  return report.fields.flatMap((field) =>
    field.citations.map((ref) =>
      makeCitation({
        id: asId<CitationId>(newId()),
        sitrepId: asId<SitRepId>(rowId),
        // The RESOLVED uuid, not the citation's natural key. This one substitution is the recorded FK
        // defect (b): `firms` / `news:apnews.com` went straight into a uuid FK, so every citation write
        // failed and took the whole all-or-nothing SitRep row down with it.
        sourceId: asId(sourceRowIds.get(String(ref.sourceId)) ?? String(ref.sourceId)),
        field: field.field,
        claim: field.claim ?? field.field,
      }),
    ),
  );
}

/** How many citations each `sitrep` row carries, counted in ONE query over the history being listed. */
async function citationCounts(db: Db, rowIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (rowIds.length === 0) return counts;
  const rows = await db
    .select({ sitrepId: citation.sitrepId })
    .from(citation)
    .where(inArray(citation.sitrepId, [...rowIds]));
  for (const r of rows) counts.set(r.sitrepId, (counts.get(r.sitrepId) ?? 0) + 1);
  return counts;
}

class SitRepHistoryStore implements PgSitRepHistoryStore {
  private readonly db: Db;
  private readonly citations: RepositoryPort<Citation, CitationId>;
  private readonly newCitationId: () => string;
  private readonly resolveIncident: (domainIncidentId: string) => Promise<string | null>;
  private readonly resolveSource: (sourceKey: string) => Promise<string>;

  constructor(options: PgSitRepHistoryOptions) {
    this.db = options.db;
    this.citations = options.citations ?? makeCitationRepository(options.db);
    this.newCitationId = options.newCitationId ?? randomUUID;
    this.resolveIncident =
      options.resolveIncident ??
      ((id): Promise<string | null> => resolveIncidentRowId(this.db, id));
    this.resolveSource =
      options.resolveSource ?? ((key): Promise<string> => resolveSourceRowId(this.db, key));
  }

  /**
   * Persist one report as history. Resolves to `null` when the incident has no stored row: the SitRep is
   * SKIPPED, never faked. Minting a placeholder incident so the insert could succeed would write a
   * fictional lineage into the audit trail — the one artifact whose only value is being trustworthy
   * (ADR-039 §2a). The caller logs the skip; the operator's live report is unaffected either way.
   */
  record(report: SitRep): Promise<Result<SitRepHistoryRecord | null, DomainError>> {
    return tryResult(async () => {
      // Recorded FK defect (a): `sitrep.incident_id` is a uuid FK while the domain id is
      // `us-ca-wildfire-demo`. This resolve IS the fix — the insert below now carries the stored row's uuid.
      const incidentRowId = await this.resolveIncident(String(report.incidentId));
      if (incidentRowId === null) return null;
      // `id` is omitted — the DB mints the uuid PK (parity with the public-report store); BEACON's SitRepId
      // is not a uuid, and the citations must point at the id the DB actually assigned.
      const rows = await this.db
        .insert(sitrep)
        .values({
          incidentId: incidentRowId,
          generatedAt: new Date(report.generatedAt),
          aiMode: report.aiMode,
          priorities: [...report.priorities],
          ...(report.summary !== undefined ? { summary: report.summary } : {}),
          ...(report.trend !== undefined ? { trend: report.trend } : {}),
        })
        .returning();
      const row = firstRow(rows, 'sitrep.record');
      const written = await this.writeCitations(report, row.id);
      // Report the DOMAIN incident id back, not the surrogate we just resolved to: the caller asked about
      // `us-ca-wildfire-demo` and must not be handed a uuid it cannot correlate with anything it holds.
      return { ...recordFromRow(row, written), incidentId: report.incidentId };
    });
  }

  /**
   * Write the grounding. A failure UNDOES the sitrep row: an audit trail is allowed to be incomplete, but a
   * history entry that claims to be a cited report while carrying no citations is worse than no entry.
   */
  private async writeCitations(report: SitRep, rowId: string): Promise<number> {
    // Resolve each DISTINCT source key once (a SitRep cites the same source across many fields), upserting
    // the row when the source has been cited but not yet polled — typically a news host.
    const keys = [
      ...new Set(report.fields.flatMap((f) => f.citations.map((c) => String(c.sourceId)))),
    ];
    const sourceRowIds = new Map<string, string>();
    for (const key of keys) sourceRowIds.set(key, await this.resolveSource(key));
    const rows = citationsFor(report, rowId, this.newCitationId, sourceRowIds);
    for (const c of rows) {
      const saved = await this.citations.save(c);
      if (!saved.ok) {
        await this.db.delete(sitrep).where(eq(sitrep.id, rowId));
        throw saved.error;
      }
    }
    return rows.length;
  }

  listByIncident(
    incidentId: IncidentId,
  ): Promise<Result<readonly SitRepHistoryRecord[], DomainError>> {
    return tryResult(async () => {
      // Symmetry with `record`: rows are STORED against the resolved uuid, so they must be READ by it too.
      // Querying with the domain id here would return an empty history for an incident that plainly has
      // one — the quietest possible way for an audit trail to lie.
      const incidentRowId = await this.resolveIncident(String(incidentId));
      if (incidentRowId === null) return [];
      const rows = await this.db
        .select()
        .from(sitrep)
        .where(eq(sitrep.incidentId, incidentRowId))
        .orderBy(desc(sitrep.generatedAt));
      const counts = await citationCounts(
        this.db,
        rows.map((r) => r.id),
      );
      // Answer in the caller's id space, as `record` does.
      return rows.map((r) => ({ ...recordFromRow(r, counts.get(r.id) ?? 0), incidentId }));
    });
  }
}

/** Build the durable SitRep history store. Failure never throws upstream (typed Result, repository.ts). */
export function makePgSitRepHistoryStore(options: PgSitRepHistoryOptions): PgSitRepHistoryStore {
  return new SitRepHistoryStore(options);
}
