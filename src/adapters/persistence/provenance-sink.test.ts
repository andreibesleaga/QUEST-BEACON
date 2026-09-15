// BEACON — live provenance sink tests (ADR-039 / V2·A2).
//
// The guarantee under test: under FEATURE_STORE=postgres the durable `source_record` table must MIRROR the
// sources the COP actually consulted — that is what `/sources` renders, and it was empty on the deployment
// because nothing wrote provenance at runtime. Two properties matter beyond "a row appears": the write is
// an UPSERT keyed on the source's natural key (so a long-running deployment holds one current row per
// source, not one per poll, and each source's uuid stays STABLE for citations to reference), and a storage
// failure NEVER propagates — provenance mirrors what happened, it does not gate serving it (Art. XVI).
import { describe, expect, it } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { makePgProvenanceSink } from './provenance-sink';
import type { Db } from './client';
import { sourceRecord } from './schema';

type Row = Record<string, unknown>;
interface Captured {
  readonly inserts: Array<{ table: unknown; values: Row | readonly Row[]; conflict?: unknown }>;
}

/** Minimal chainable drizzle fake covering insert().values().onConflictDoUpdate(). */
function makeFakeDb(opts: { failOn?: 'insert' } = {}): { db: Db; captured: Captured } {
  const captured: Captured = { inserts: [] };
  const db = {
    insert: (t: unknown) => ({
      values: (v: Row | readonly Row[]) => {
        if (opts.failOn === 'insert') throw new Error('connection terminated unexpectedly');
        const entry = { table: t, values: v } as {
          table: unknown;
          values: Row | readonly Row[];
          conflict?: unknown;
        };
        captured.inserts.push(entry);
        const done = Promise.resolve([]);
        return {
          onConflictDoUpdate: (c: unknown) => {
            entry.conflict = c;
            return done;
          },
          then: (r: (x: unknown) => unknown) => done.then(r),
        };
      },
    }),
  };
  return { db: db as unknown as Db, captured };
}

const ENTRY = {
  sourceId: 'firms',
  adapter: 'firms',
  mode: 'LIVE' as const,
  fetchedAt: '2026-07-13T12:00:00.000Z',
};

describe('makePgProvenanceSink', () => {
  it('writes the consulted sources into source_record', async () => {
    const { db, captured } = makeFakeDb();
    const res = await makePgProvenanceSink(db).record([
      ENTRY,
      { ...ENTRY, sourceId: 'nws', adapter: 'nws', mode: 'CACHED' },
    ]);
    expect(isOk(res)).toBe(true);
    expect(captured.inserts).toHaveLength(1);
    expect(captured.inserts[0]!.table).toBe(sourceRecord);
    const values = captured.inserts[0]!.values as readonly Row[];
    expect(values).toHaveLength(2);
    // `source` carries the manifest id the COP shows — the SAME key space the memory posture renders, so
    // /sources reads identically in both stores.
    expect(values[0]!.source).toBe('firms');
    expect(values[0]!.mode).toBe('LIVE');
    expect(values[1]!.source).toBe('nws');
    expect(values[1]!.mode).toBe('CACHED');
  });

  it('UPSERTS on the source key, so a poll refreshes a row instead of appending one', async () => {
    const { db, captured } = makeFakeDb();
    await makePgProvenanceSink(db).record([ENTRY]);
    const conflict = captured.inserts[0]!.conflict as {
      target?: unknown;
      set?: Record<string, unknown>;
    };
    expect(conflict).toBeDefined();
    expect(conflict.target).toBe(sourceRecord.source);
    // Refreshed on conflict: the fetch instant, the served mode, and the licence (healed, never erased —
    // see below). The row's uuid is deliberately NOT touched — its stability is what lets a citation
    // point at it (ADR-039 §2).
    expect(Object.keys(conflict.set ?? {}).sort()).toEqual([
      'adapter',
      'fetchedAt',
      'license',
      'mode',
    ]);
  });

  it('repairs a NULL licence on conflict and never erases a stored one (coalesce)', async () => {
    const { db, captured } = makeFakeDb();
    await makePgProvenanceSink(db).record([{ ...ENTRY, license: 'NASA open' }]);
    const conflict = captured.inserts[0]!.conflict as { set?: Record<string, unknown> };
    // The statement is SQL, not a value: the new licence wins when present, the stored one otherwise.
    const chunks = (conflict.set!.license as { queryChunks: unknown[] }).queryChunks;
    const text = chunks
      .map((c) =>
        typeof c === 'object' && c !== null && 'value' in c
          ? String((c as { value: unknown }).value)
          : '',
      )
      .join('');
    expect(text).toContain('coalesce(excluded.license, ');
    const values = captured.inserts[0]!.values as readonly Row[];
    expect(values[0]!.license).toBe('NASA open');
  });

  it('never mints an id — the stored row keeps the uuid it was created with', async () => {
    const { db, captured } = makeFakeDb();
    await makePgProvenanceSink(db).record([ENTRY]);
    const values = captured.inserts[0]!.values as readonly Row[];
    expect(values[0]).not.toHaveProperty('id');
  });

  it('is a no-op for an empty batch (a quiet region must not issue a statement)', async () => {
    const { db, captured } = makeFakeDb();
    const res = await makePgProvenanceSink(db).record([]);
    expect(isOk(res)).toBe(true);
    expect(captured.inserts).toHaveLength(0);
  });

  it('FAILS OPEN: a storage error is reported as an error Result, never thrown at the COP', async () => {
    const { db } = makeFakeDb({ failOn: 'insert' });
    const res = await makePgProvenanceSink(db).record([ENTRY]);
    expect(isOk(res)).toBe(false); // surfaced to the caller, which logs and continues serving
  });
});

// ── The B2 defect (found by the A2 all-lens review, 2026-09-10) ──────────────────────────────────────
//
// The batch handed to this sink is EVERY region's SourceView[] flattened into ONE array
// (`live-composition.ts` recordProvenance). A source enabled in several regions — `firms` is enabled in
// all five — therefore appears several times in the SAME statement. Postgres does NOT collapse duplicates
// within a single `ON CONFLICT DO UPDATE`; it rejects the whole command:
//
//   ERROR: ON CONFLICT DO UPDATE command cannot affect row a second time
//
// So the multi-region deployment — the only deployment there is — failed EVERY provenance write, and
// because the call site is fail-open the sole trace was a debug line. The sink's own header promises one
// current row per source; delivering that is the ADAPTER's job, because the constraint that makes it
// necessary is the adapter's constraint. Newest fetch instant wins, which is what "current" means.
describe('makePgProvenanceSink — duplicate source keys within one batch', () => {
  it('collapses a source enabled in several regions into ONE row, keeping the newest fetch', async () => {
    const { db, captured } = makeFakeDb();
    const res = await makePgProvenanceSink(db).record([
      { ...ENTRY, fetchedAt: '2026-07-13T12:00:00.000Z', mode: 'CACHED' },
      { ...ENTRY, sourceId: 'nws', adapter: 'nws' },
      { ...ENTRY, fetchedAt: '2026-07-13T12:30:00.000Z', mode: 'LIVE' }, // same `firms`, newer
      { ...ENTRY, fetchedAt: '2026-07-13T11:00:00.000Z', mode: 'MOCK' }, // same `firms`, older
    ]);
    expect(isOk(res)).toBe(true);
    const values = captured.inserts[0]!.values as readonly Row[];
    // One row per DISTINCT source — anything else is a statement Postgres refuses outright.
    expect(values.map((v) => v.source)).toEqual(['firms', 'nws']);
    const firms = values.find((v) => v.source === 'firms')!;
    // The NEWEST entry wins: this table is current state, so a stale poll must not overwrite a fresh one.
    expect((firms.fetchedAt as Date).toISOString()).toBe('2026-07-13T12:30:00.000Z');
    expect(firms.mode).toBe('LIVE');
  });

  it('keeps the first-seen order stable so the statement is deterministic across replicas', async () => {
    const { db, captured } = makeFakeDb();
    await makePgProvenanceSink(db).record([
      { ...ENTRY, sourceId: 'nws', adapter: 'nws' },
      { ...ENTRY },
      { ...ENTRY, sourceId: 'nws', adapter: 'nws', fetchedAt: '2026-07-13T13:00:00.000Z' },
    ]);
    const values = captured.inserts[0]!.values as readonly Row[];
    expect(values.map((v) => v.source)).toEqual(['nws', 'firms']);
  });
});
