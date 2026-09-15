// BEACON — durable incident mirror tests (ADR-039; V2·A2). The `incident` table held only fixture rows, so
// a Directus user browsing the database saw a demo rather than the picture the COP was serving — and,
// because `sitrep.incident_id` is a uuid FK, SitRep history had nothing it could legally reference.
import { describe, expect, it } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { makePgIncidentSnapshotStore } from './incident-snapshot';
import type { Db } from './client';
import { incident, region } from './schema';

type Row = Record<string, unknown>;

function makeFakeDb(regionRows: readonly Row[] = [{ id: 'region-uuid' }]): {
  db: Db;
  inserts: Array<{ table: unknown; values: readonly Row[]; conflict?: unknown }>;
  updates: Array<{ table: unknown; values: Row }>;
} {
  const inserts: Array<{ table: unknown; values: readonly Row[]; conflict?: unknown }> = [];
  const updates: Array<{ table: unknown; values: Row }> = [];
  const db = {
    update: (t: unknown) => ({
      set: (v: Row) => ({
        where: () => {
          updates.push({ table: t, values: v });
          return Promise.resolve([]);
        },
      }),
    }),
    select: () => ({
      from: (t: unknown) => {
        const result = Promise.resolve(t === region ? regionRows : []);
        const builder = {
          where: () => builder,
          limit: () => result,
          then: (r: (x: unknown) => unknown) => result.then(r),
        };
        return builder;
      },
    }),
    insert: (t: unknown) => ({
      values: (v: readonly Row[]) => {
        const entry: { table: unknown; values: readonly Row[]; conflict?: unknown } = {
          table: t,
          values: v,
        };
        inserts.push(entry);
        const chain = {
          onConflictDoUpdate: (c: unknown) => {
            entry.conflict = c;
            return Promise.resolve([]);
          },
        };
        return chain;
      },
    }),
  };
  return { db: db as unknown as Db, inserts, updates };
}

const SNAP = {
  incidentId: 'us-ca-wildfire-demo',
  regionId: 'us-ca',
  type: 'WILDFIRE',
  status: 'ACTIVE',
};

describe('makePgIncidentSnapshotStore', () => {
  it('writes the incident with its DOMAIN id as the natural key and the resolved region uuid', async () => {
    const { db, inserts } = makeFakeDb();
    const res = await makePgIncidentSnapshotStore(db).record([SNAP]);
    expect(isOk(res)).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe(incident);
    const row = inserts[0]!.values[0]!;
    expect(row.domainId).toBe('us-ca-wildfire-demo'); // recognisable to an operator browsing the table
    expect(row.regionId).toBe('region-uuid'); // the FK gets the surrogate it requires
    expect(row).not.toHaveProperty('id'); // the DB mints and KEEPS the surrogate, so history stays valid
  });

  it('UPSERTS on the natural key — a restart refreshes rows instead of duplicating them', async () => {
    const { db, inserts } = makeFakeDb();
    await makePgIncidentSnapshotStore(db).record([SNAP]);
    const conflict = inserts[0]!.conflict as { target?: unknown; set?: Record<string, unknown> };
    expect(conflict.target).toBe(incident.domainId);
    expect(Object.keys(conflict.set ?? {}).sort()).toEqual([
      'regionId',
      'status',
      'type',
      'updatedAt',
    ]); // updatedAt: last seen;
  });

  it('SKIPS an incident whose region was never seeded — never attaches it to an arbitrary region', async () => {
    // A wrongly-regioned incident is worse than an absent one: it reads as fact.
    const { db, inserts } = makeFakeDb([]);
    const res = await makePgIncidentSnapshotStore(db).record([SNAP]);
    expect(isOk(res)).toBe(true);
    expect(inserts).toHaveLength(0);
  });

  it('resolves each distinct region once, however many incidents it holds', async () => {
    let lookups = 0;
    const db = {
      select: () => ({
        from: () => {
          lookups += 1;
          const result = Promise.resolve([{ id: 'region-uuid' }]);
          const b = {
            where: () => b,
            limit: () => result,
            then: (r: (x: unknown) => unknown) => result.then(r),
          };
          return b;
        },
      }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve([]) }) }),
    } as unknown as Db;
    await makePgIncidentSnapshotStore(db).record([
      SNAP,
      { ...SNAP, incidentId: 'us-ca-flood-demo' },
    ]);
    expect(lookups).toBe(1);
  });

  it('is a no-op for an empty batch', async () => {
    const { db, inserts } = makeFakeDb();
    expect(isOk(await makePgIncidentSnapshotStore(db).record([]))).toBe(true);
    expect(inserts).toHaveLength(0);
  });

  it('a driver fault becomes a typed Result, never an exception at the COP', async () => {
    const broken = {
      select: () => {
        throw new Error('connection terminated');
      },
    } as unknown as Db;
    expect(isOk(await makePgIncidentSnapshotStore(broken).record([SNAP]))).toBe(false);
  });
});

describe('the mirror records, it does not decide (lifecycle)', () => {
  /** The string parts of a drizzle `sql` template, for asserting what a conflict clause says. */
  const text = (q: unknown): string =>
    JSON.stringify(
      ((q as { queryChunks?: readonly unknown[] }).queryChunks ?? []).map(
        (c) => (c as { value?: unknown }).value ?? null,
      ),
    );

  it('preserves an operator’s CLOSED on conflict — CLOSED is terminal and a composition never reopens it', async () => {
    const { db, inserts } = makeFakeDb();
    await makePgIncidentSnapshotStore(db).record([SNAP]);
    const set = (inserts[0]!.conflict as { set: Record<string, unknown> }).set;
    expect(text(set['status'])).toContain("'CLOSED'");
    expect(text(set['status'])).toContain('excluded.status');
  });

  it('refreshes updated_at on every composition — last seen is the mirror’s only lifecycle claim', async () => {
    const { db, inserts } = makeFakeDb();
    await makePgIncidentSnapshotStore(db).record([SNAP]);
    const set = (inserts[0]!.conflict as { set: Record<string, unknown> }).set;
    expect(text(set['updatedAt'])).toContain('now()');
  });

  it('issues no UPDATE of its own — a vanished discovered cluster stops being refreshed, nothing is closed', async () => {
    const { db, updates } = makeFakeDb();
    await makePgIncidentSnapshotStore(db).record([SNAP]);
    expect(updates).toHaveLength(0);
  });
});
