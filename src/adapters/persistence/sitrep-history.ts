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
  record(report: SitRep): Promise<Result<SitRepHistoryRecord, DomainError>>;
  /** The incident's history, newest first. NOT a read path for the current SitRep — see the file header. */
  listByIncident(incidentId: IncidentId): Promise<Result<readonly SitRepHistoryRecord[], DomainError>>;
}

export interface PgSitRepHistoryOptions {
  readonly db: Db;
  /** The EXISTING citation repository (repositories.ts). Injectable so a test can drive its failure path. */
  readonly citations?: RepositoryPort<Citation, CitationId>;
  /** Mints the citation uuid PK. Defaults to `crypto.randomUUID`; tests inject a counter. */
  readonly newCitationId?: () => string;
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
function citationsFor(report: SitRep, rowId: string, newId: () => string): readonly Citation[] {
  return report.fields.flatMap((field) =>
    field.citations.map((ref) =>
      makeCitation({
        id: asId<CitationId>(newId()),
        sitrepId: asId<SitRepId>(rowId),
        sourceId: ref.sourceId,
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

  constructor(options: PgSitRepHistoryOptions) {
    this.db = options.db;
    this.citations = options.citations ?? makeCitationRepository(options.db);
    this.newCitationId = options.newCitationId ?? randomUUID;
  }

  record(report: SitRep): Promise<Result<SitRepHistoryRecord, DomainError>> {
    return tryResult(async () => {
      // `id` is omitted — the DB mints the uuid PK (parity with the public-report store); BEACON's SitRepId
      // is not a uuid, and the citations must point at the id the DB actually assigned.
      const rows = await this.db
        .insert(sitrep)
        .values({
          incidentId: report.incidentId,
          generatedAt: new Date(report.generatedAt),
          aiMode: report.aiMode,
          priorities: [...report.priorities],
          ...(report.summary !== undefined ? { summary: report.summary } : {}),
          ...(report.trend !== undefined ? { trend: report.trend } : {}),
        })
        .returning();
      const row = firstRow(rows, 'sitrep.record');
      const written = await this.writeCitations(report, row.id);
      return recordFromRow(row, written);
    });
  }

  /**
   * Write the grounding. A failure UNDOES the sitrep row: an audit trail is allowed to be incomplete, but a
   * history entry that claims to be a cited report while carrying no citations is worse than no entry.
   */
  private async writeCitations(report: SitRep, rowId: string): Promise<number> {
    const rows = citationsFor(report, rowId, this.newCitationId);
    for (const c of rows) {
      const saved = await this.citations.save(c);
      if (!saved.ok) {
        await this.db.delete(sitrep).where(eq(sitrep.id, rowId));
        throw saved.error;
      }
    }
    return rows.length;
  }

  listByIncident(incidentId: IncidentId): Promise<Result<readonly SitRepHistoryRecord[], DomainError>> {
    return tryResult(async () => {
      const rows = await this.db
        .select()
        .from(sitrep)
        .where(eq(sitrep.incidentId, incidentId))
        .orderBy(desc(sitrep.generatedAt));
      const counts = await citationCounts(this.db, rows.map((r) => r.id));
      return rows.map((r) => recordFromRow(r, counts.get(r.id) ?? 0));
    });
  }
}

/** Build the durable SitRep history store. Failure never throws upstream (typed Result, repository.ts). */
export function makePgSitRepHistoryStore(options: PgSitRepHistoryOptions): PgSitRepHistoryStore {
  return new SitRepHistoryStore(options);
}
