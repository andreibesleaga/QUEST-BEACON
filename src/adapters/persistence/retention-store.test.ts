// BEACON — Postgres retention-store tests (MW-D/D4.3; finding F-25).
// NO LIVE DATABASE: a chainable driver-mock covering exactly the shapes this adapter uses, mirroring the
// driver-agnostic approach in read-models.test.ts / repository.test.ts. The sweep POLICY is tested in
// src/application/governance/retention-sweep.test.ts; what is asserted here is the SQL shape — that the
// query filters on `purge_after <= cutoff`, that the delete is a real DELETE keyed by the ids it was given,
// and that a driver failure becomes a typed Result rather than a throw.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { makePgRetentionStore } from './retention-store';
import type { Db } from './client';
import { publicReport } from './schema';

type Row = Record<string, unknown>;
interface Captured {
  readonly selects: Array<{ table: unknown; columns: unknown; where: unknown }>;
  readonly deletes: Array<{ table: unknown; where: unknown }>;
}

/** select(cols).from(t).where(w) → rows · delete(t).where(w).returning(c) → the configured deleted rows. */
function makeFakeDb(rows: readonly Row[], opts: { deleted?: readonly Row[]; throwOn?: 'select' | 'delete' } = {}) {
  const captured: Captured = { selects: [], deletes: [] };
  const db = {
    select: (columns: unknown) => ({
      from: (table: unknown) => ({
        where: (where: unknown) => {
          captured.selects.push({ table, columns, where });
          if (opts.throwOn === 'select') return Promise.reject(new Error('driver exploded on select'));
          return Promise.resolve(rows);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (where: unknown) => ({
        returning: () => {
          captured.deletes.push({ table, where });
          if (opts.throwOn === 'delete') return Promise.reject(new Error('driver exploded on delete'));
          return Promise.resolve(opts.deleted ?? []);
        },
      }),
    }),
  };
  return { db: db as unknown as Db, captured };
}

const D1 = new Date('2026-06-05T22:00:00.000Z');
const CUTOFF = '2026-07-05T22:00:00.000Z';

/**
 * Every scalar reachable from a drizzle SQL fragment (cycle-safe; Dates rendered ISO). Used to assert the
 * WHERE clause really names `purge_after` and really carries the cutoff instant — a claim worth checking,
 * since an adapter that filtered on the wrong column would still return rows and still look green.
 */
function scalarsIn(value: unknown, seen = new Set<unknown>(), out: unknown[] = []): unknown[] {
  if (value === null || typeof value !== 'object') {
    out.push(value);
    return out;
  }
  if (seen.has(value)) return out;
  seen.add(value);
  if (value instanceof Date) {
    out.push(value.toISOString());
    return out;
  }
  for (const child of Object.values(value as Record<string, unknown>)) scalarsIn(child, seen, out);
  return out;
}

describe('makePgRetentionStore', () => {
  it('labels itself honestly so the sweep report says WHAT was swept', () => {
    const { db } = makeFakeDb([]);
    const store = makePgRetentionStore(db);
    expect(store.storeLabel).toBe('postgres');
    expect(store.datasetLabel).toBe('public_report');
  });

  it('queries public_report for rows at or before the cutoff and returns id + deadline only', async () => {
    const { db, captured } = makeFakeDb([
      { id: 'rep-1', purgeAfter: D1 },
      { id: 'rep-2', purgeAfter: null },
    ]);
    const res = await makePgRetentionStore(db).expired(CUTOFF);
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value).toEqual([
        { id: 'rep-1', purgeAfter: '2026-06-05T22:00:00.000Z' },
        { id: 'rep-2', purgeAfter: '' }, // a NULL deadline is reported as empty, never guessed
      ]);
    }
    expect(captured.selects).toHaveLength(1);
    expect(captured.selects[0]?.table).toBe(publicReport);
    // The projection is id + purge_after ONLY: a retention query must not read the report body.
    expect(Object.keys(captured.selects[0]?.columns as object)).toEqual(['id', 'purgeAfter']);
    const where = scalarsIn(captured.selects[0]?.where);
    expect(where).toContain('purge_after');
    expect(where).toContain(CUTOFF);
    expect(where).toContain(' <= '); // at-or-before, so a deadline landing exactly now is swept
  });

  it('issues a real DELETE for exactly the given ids and reports the driver’s own count', async () => {
    const { db, captured } = makeFakeDb([], { deleted: [{ id: 'rep-1' }, { id: 'rep-2' }] });
    const res = await makePgRetentionStore(db).purge(['rep-1', 'rep-2']);
    expect(isOk(res) && res.value).toBe(2);
    expect(captured.deletes).toHaveLength(1);
    expect(captured.deletes[0]?.table).toBe(publicReport);
  });

  it('reports the DRIVER’s count, not the requested count (a row may vanish in between)', async () => {
    const { db } = makeFakeDb([], { deleted: [{ id: 'rep-1' }] });
    const res = await makePgRetentionStore(db).purge(['rep-1', 'rep-2']);
    expect(isOk(res) && res.value).toBe(1);
  });

  it('short-circuits an empty purge without touching the driver', async () => {
    const { db, captured } = makeFakeDb([]);
    const res = await makePgRetentionStore(db).purge([]);
    expect(isOk(res) && res.value).toBe(0);
    expect(captured.deletes).toHaveLength(0);
  });

  it('turns a driver failure into a typed Result — persistence never throws upstream', async () => {
    const q = makeFakeDb([], { throwOn: 'select' });
    expect(isErr(await makePgRetentionStore(q.db).expired(CUTOFF))).toBe(true);
    const d = makeFakeDb([], { throwOn: 'delete' });
    expect(isErr(await makePgRetentionStore(d.db).purge(['rep-1']))).toBe(true);
  });
});
