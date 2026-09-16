// BEACON — natural-key resolver tests (ADR-039 §2). These cover the translation that two write paths were
// missing for a whole release: the domain says `us-ca-wildfire-demo` and `firms`, the FKs demand uuids.
import { describe, expect, it } from 'vitest';
import { isUuid, resolveIncidentRowId, resolveSourceRowId } from './natural-keys';
import { NEWS_OUTLET_LICENSE } from '@/application/sitrep-synthesis/news-grounding.js';
import type { Db } from './client';
import { incident, sourceRecord } from './schema';

type Row = Record<string, unknown>;

/** Chainable drizzle fake covering select().from().where().limit() and insert().onConflictDoUpdate().returning(). */
function makeFakeDb(rows: Map<unknown, readonly Row[]> = new Map()): {
  db: Db;
  inserts: Array<{ table: unknown; values: Row; conflict?: unknown }>;
  wheres: unknown[];
} {
  const inserts: Array<{ table: unknown; values: Row; conflict?: unknown }> = [];
  const wheres: unknown[] = [];
  const db = {
    select: () => ({
      from: (t: unknown) => {
        const result = Promise.resolve(rows.get(t) ?? []);
        const builder = {
          where: (w: unknown) => {
            wheres.push(w);
            return builder;
          },
          limit: () => result,
          then: (r: (x: unknown) => unknown) => result.then(r),
        };
        return builder;
      },
    }),
    insert: (t: unknown) => ({
      values: (v: Row) => {
        const entry: { table: unknown; values: Row; conflict?: unknown } = { table: t, values: v };
        inserts.push(entry);
        const chain = {
          onConflictDoUpdate: (c: unknown) => {
            entry.conflict = c;
            return chain;
          },
          returning: () => Promise.resolve([{ id: 'resolved-uuid' }]),
        };
        return chain;
      },
    }),
  };
  return { db: db as unknown as Db, inserts, wheres };
}

describe('resolveSourceRowId', () => {
  it('returns the stable uuid a citation can reference', async () => {
    const { db } = makeFakeDb();
    expect(await resolveSourceRowId(db, 'firms')).toBe('resolved-uuid');
  });

  it('materialises a cited-but-unpolled source rather than losing the grounding', async () => {
    const { db, inserts } = makeFakeDb();
    await resolveSourceRowId(db, 'news:apnews.com');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe(sourceRecord);
    expect(inserts[0]!.values.source).toBe('news:apnews.com');
  });

  it('labels an unknown source at its WEAKEST mode — never assumes it was live (Art. XI)', async () => {
    const { db, inserts } = makeFakeDb();
    await resolveSourceRowId(db, 'news:apnews.com');
    expect(inserts[0]!.values.mode).toBe('MOCK');
  });

  it('gives a cited outlet the outlet licence, so the row is never unlicensed (live 422, 2026-09-15)', async () => {
    const { db, inserts } = makeFakeDb();
    await resolveSourceRowId(db, 'news:apnews.com');
    expect(inserts[0]!.values.license).toBe(NEWS_OUTLET_LICENSE);
  });

  it('records no licence for a non-outlet key unless the caller supplies one (never a guess)', async () => {
    const { db, inserts } = makeFakeDb();
    await resolveSourceRowId(db, 'firms');
    expect(inserts[0]!.values).not.toHaveProperty('license');
    await resolveSourceRowId(db, 'firms', { license: 'NASA open' });
    expect(inserts[1]!.values.license).toBe('NASA open');
  });

  it('records the supplied provenance context when the caller knows it', async () => {
    const { db, inserts } = makeFakeDb();
    await resolveSourceRowId(db, 'firms', {
      adapter: 'firms',
      mode: 'LIVE',
      fetchedAt: '2026-07-13T12:00:00.000Z',
    });
    expect(inserts[0]!.values.mode).toBe('LIVE');
    expect(inserts[0]!.values.adapter).toBe('firms');
  });

  it('upserts with DO UPDATE, not DO NOTHING — an existing source must still return its id', async () => {
    // DO NOTHING returns no row on conflict, which would report "missing" for a source that plainly exists.
    const { db, inserts } = makeFakeDb();
    await resolveSourceRowId(db, 'firms');
    const conflict = inserts[0]!.conflict as { target?: unknown; set?: Record<string, unknown> };
    expect(conflict.target).toBe(sourceRecord.source);
    // Self-assignment (changes nothing, yields the row) plus the licence heal: an existing NULL licence is
    // filled from the new value, an existing licence is kept (coalesce(stored, excluded)).
    expect(conflict.set?.source).toBe('firms');
    expect(Object.keys(conflict.set ?? {}).sort()).toEqual(['license', 'source']);
  });
});

describe('resolveIncidentRowId', () => {
  it('finds the stored row by its domain id', async () => {
    const { db } = makeFakeDb(new Map([[incident, [{ id: 'inc-uuid' }]]]));
    expect(await resolveIncidentRowId(db, 'us-ca-wildfire-demo')).toBe('inc-uuid');
  });

  it('returns null when the incident has never been stored — the caller SKIPS, it does not invent', async () => {
    const { db } = makeFakeDb();
    expect(await resolveIncidentRowId(db, 'us-ca-wildfire-demo')).toBeNull();
  });

  it('never queries the uuid PK with a domain string (that is a Postgres type error, not a miss)', async () => {
    const { db, wheres } = makeFakeDb();
    await resolveIncidentRowId(db, 'us-ca-wildfire-demo');
    expect(wheres).toHaveLength(1); // domain-id lookup only; the PK probe is skipped for a non-uuid
  });

  it('falls back to the primary key for a uuid-shaped id (a DB-minted incident has no natural key)', async () => {
    const { db, wheres } = makeFakeDb();
    await resolveIncidentRowId(db, '11111111-2222-3333-4444-555555555555');
    expect(wheres).toHaveLength(2);
  });
});

describe('isUuid', () => {
  it('accepts a canonical uuid and rejects a domain id', () => {
    expect(isUuid('11111111-2222-3333-4444-555555555555')).toBe(true);
    expect(isUuid('us-ca-wildfire-demo')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
