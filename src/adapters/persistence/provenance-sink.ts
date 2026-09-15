// BEACON — durable provenance sink (ADR-039; V2·A2).
//
// WHY THIS EXISTS. Under `FEATURE_STORE=postgres` the deployment served an EMPTY `/sources`. The read path
// was fine — `makePgSourceReadModel` projects `source_record` faithfully — the table was simply never
// written at runtime: live provenance lived only inside the in-memory seed `live-composition` assembles,
// so the durable posture read a table that only the reference seed populated. This is the write path that
// makes the durable claim true: the database fills itself from the live world, per region, per poll.
//
// WHY UPSERT ON `source`, NOT INSERT. Appending a row per fetch would grow without bound on a long-running
// deployment and, more importantly, would give every poll a NEW uuid. One current row per source keeps the
// row's uuid STABLE, and that stability is precisely what a `citation.source_id` FK needs to point at
// (ADR-039 §2) — the sink and the citation resolver deliberately share one key space.
//
// WHAT IS NOT KEPT. This table is CURRENT STATE, not a fetch log: it answers "what served this source, and
// how fresh is it", which is what the operator reads. Per-call history belongs to the audit ledger.
//
// WHY THE BATCH IS DEDUPED HERE (defect B2, found by the A2 all-lens review 2026-09-10). The caller hands
// this sink EVERY region's sources flattened into one array, and a source enabled in several regions —
// `firms` is enabled in all five — therefore appears several times in one statement. Postgres does not
// collapse duplicates inside a single `ON CONFLICT DO UPDATE`; it rejects the whole command with
// "ON CONFLICT DO UPDATE command cannot affect row a second time". So EVERY provenance write failed on the
// only deployment shape there is, and the fail-open call site reduced that to one debug line. Collapsing
// belongs here rather than at the call site because the constraint that demands it is this adapter's
// constraint: a caller reasoning about the COP should not have to know Postgres's cardinality rule.
import { sql } from 'drizzle-orm';
import { tryResult } from './repository.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { ProvenanceEntry, ProvenanceSinkPort } from '@/ports/infra.js';
import type { Db } from './client.js';
import { sourceRecord } from './schema.js';

/**
 * One entry per DISTINCT source key, newest fetch instant winning, first-seen order preserved.
 *
 * "Newest wins" is what CURRENT STATE means: when two regions report the same source, the row must hold the
 * fresher observation, never whichever happened to be flattened last. Order is kept stable so the emitted
 * statement is deterministic across replicas — two processes issuing the same rows in different orders can
 * deadlock each other on the unique index.
 */
function latestPerSource(entries: readonly ProvenanceEntry[]): readonly ProvenanceEntry[] {
  const bySource = new Map<string, ProvenanceEntry>();
  for (const e of entries) {
    const seen = bySource.get(e.sourceId);
    if (seen === undefined || Date.parse(e.fetchedAt) > Date.parse(seen.fetchedAt))
      bySource.set(e.sourceId, e);
  }
  return [...bySource.values()];
}

/** Durable provenance mirror over `source_record`. Upserts on the source's natural key. */
export function makePgProvenanceSink(db: Db): ProvenanceSinkPort {
  return {
    record: (entries: readonly ProvenanceEntry[]): Promise<Result<void, DomainError>> =>
      tryResult(async () => {
        const distinct = latestPerSource(entries);
        if (distinct.length === 0) return; // a quiet region issues no statement
        await db
          .insert(sourceRecord)
          .values(
            distinct.map((e) => ({
              // `id` is deliberately OMITTED: the DB mints it on first sight and keeps it forever after, so
              // a citation minted against this source stays valid across every later poll.
              source: e.sourceId,
              adapter: e.adapter,
              mode: e.mode,
              fetchedAt: new Date(e.fetchedAt),
              ...(e.license !== undefined ? { license: e.license } : {}),
            })),
          )
          .onConflictDoUpdate({
            target: sourceRecord.source,
            set: {
              adapter: sql`excluded.adapter`,
              mode: sql`excluded.mode`,
              fetchedAt: sql`excluded.fetched_at`,
              // HEAL, NEVER ERASE: a row first written before the sink carried the licence holds NULL, and
              // an upsert that left the column alone kept it NULL forever (live 2026-09-15: one such row
              // made every `/status` and `/sources` read a 422). A known licence now repairs the row on the
              // next poll; an entry without one keeps whatever the row already holds.
              license: sql`coalesce(excluded.license, ${sourceRecord.license})`,
            },
          });
      }),
  };
}
