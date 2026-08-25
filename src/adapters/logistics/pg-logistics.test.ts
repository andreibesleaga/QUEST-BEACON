// BEACON — Postgres ResourceLogisticsPort adapter tests (FR-8, EV9, Art. XIII/ST1).
//
// The behavioural claims come from the SHARED contract suite that also drives the in-memory store, so the
// two implementations cannot answer the same question differently without turning the build red. What is
// added here is pg-specific: the DB-minted surrogate key, the exact SQL the store issues, and that a driver
// fault becomes a typed Result rather than an exception.
//
// No live DB: a stateful driver mock stands in for the drizzle query builder (the read-models.test.ts
// approach, extended to remember writes so a create→advance round trip is real). It EVALUATES the `eq(...)`
// predicates the store issues — a fake that ignored `where` would let a store that forgot its filter pass.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { makeResource } from '@/domain/resource.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ResourceId } from '@/domain/value-objects/ids.js';
import type { Db } from '@/adapters/persistence/client.js';
import { resource, resourceTask, shelter } from '@/adapters/persistence/schema.js';
import { makePgLogisticsStore } from './pg-logistics.js';
import {
  CONTRACT_FIXTURE,
  CONTRACT_INCIDENT,
  describeLogisticsContract,
} from './logistics-contract.test-suite.js';
import type { LogisticsContractFixture } from './logistics-contract.test-suite.js';

type Row = Record<string, unknown>;

/**
 * The `eq(column, value)` pairs of a drizzle where-clause, read off the SQL object's query chunks
 * (`[StringChunk(''), Column, StringChunk(' = '), Param, StringChunk('')]`). The store only ever filters on
 * `id` and `status`, whose column name and field name coincide, so the db name indexes the row directly; a
 * future snake_case filter would match nothing here and fail loudly rather than pass silently.
 */
function eqPairs(where: unknown): Array<readonly [string, unknown]> {
  const chunks = (where as { queryChunks?: readonly unknown[] } | undefined)?.queryChunks;
  if (!Array.isArray(chunks)) return [];
  const pairs: Array<readonly [string, unknown]> = [];
  for (let i = 0; i + 2 < chunks.length; i++) {
    const col = chunks[i] as { name?: unknown };
    const op = chunks[i + 1] as { value?: unknown };
    const param = chunks[i + 2] as { value?: unknown };
    if (typeof col.name === 'string' && Array.isArray(op.value) && op.value[0] === ' = ') {
      pairs.push([col.name, param.value]);
    }
  }
  return pairs;
}

const matches = (where: unknown, row: Row): boolean =>
  eqPairs(where).every(([column, value]) => row[column] === value);

/** Nullable columns the DDL fills with NULL, so a hydrated row has every key its mapper reads. */
const NULL_COLUMNS = new Map<unknown, Row>([
  [resource, { org: null, geom: null }],
  [resourceTask, { shelterId: null, target: null, edxlRmRef: null }],
  [shelter, { org: null }],
]);

/** Deterministic stand-in for `gen_random_uuid()` — sequential, valid uuid text, no randomness. */
function uuidMinter(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

interface FakeDb {
  readonly db: Db;
  readonly rows: Map<unknown, Row[]>;
  readonly inserts: Array<{ table: unknown; values: Row }>;
}

function makeFakeDb(seeded: Map<unknown, Row[]>, onWrite?: () => void): FakeDb {
  const rows = seeded;
  const inserts: Array<{ table: unknown; values: Row }> = [];
  const nextId = uuidMinter();
  const rowsFor = (t: unknown): Row[] => {
    const existing = rows.get(t);
    if (existing) return existing;
    const fresh: Row[] = [];
    rows.set(t, fresh);
    return fresh;
  };

  const selectFrom = (t: unknown) => {
    let where: unknown;
    const result = (): Promise<Row[]> => Promise.resolve(rowsFor(t).filter((r) => matches(where, r)));
    const builder = {
      where: (w: unknown) => {
        where = w;
        return builder;
      },
      limit: (n: number) => result().then((r) => r.slice(0, n)),
      then: (res: (r: Row[]) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    return builder;
  };

  const db = {
    select: () => ({ from: selectFrom }),
    insert: (t: unknown) => ({
      values: (v: Row) => {
        const row: Row = { ...NULL_COLUMNS.get(t), ...v, id: nextId() };
        return {
          returning: () => {
            onWrite?.();
            inserts.push({ table: t, values: v });
            rowsFor(t).push(row);
            return Promise.resolve([row]);
          },
        };
      },
    }),
    update: (t: unknown) => ({
      set: (s: Row) => ({
        where: (w: unknown) => ({
          returning: () => {
            onWrite?.();
            const hit = rowsFor(t).filter((r) => matches(w, r));
            for (const r of hit) Object.assign(r, s);
            return Promise.resolve(hit);
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as Db, rows, inserts };
}

/** The fixture, as the rows a real `resource`/`shelter` table would hold. */
function seededRows(fixture: LogisticsContractFixture): Map<unknown, Row[]> {
  return new Map<unknown, Row[]>([
    [
      resource,
      fixture.resources.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        org: r.orgId ?? null,
        geom: r.geom ?? null,
      })),
    ],
    [
      shelter,
      fixture.shelters.map((s) => ({
        id: s.id,
        geom: s.geom,
        capacity: s.capacity,
        occupancy: s.occupancy,
        status: s.status,
        org: s.orgId ?? null,
      })),
    ],
    [resourceTask, []],
  ]);
}

const pgStore = (fixture: LogisticsContractFixture) =>
  makePgLogisticsStore({
    db: makeFakeDb(seededRows(fixture)).db,
    verifiedIncidents: fixture.verifiedIncidents,
    ...(fixture.capacityMatchDirection !== undefined
      ? { capacityMatchDirection: fixture.capacityMatchDirection }
      : {}),
  });

describeLogisticsContract('makePgLogisticsStore', pgStore);

describe('makePgLogisticsStore — durable-store specifics', () => {
  it('lets the DB mint the surrogate uuid PK and returns the STORED entity', async () => {
    const fake = makeFakeDb(seededRows(CONTRACT_FIXTURE));
    const store = makePgLogisticsStore({ db: fake.db, verifiedIncidents: [CONTRACT_INCIDENT] });
    const registered = await store.register(
      makeResource({ id: asId<ResourceId>('res-not-a-uuid'), kind: 'MEDICAL', status: 'AVAILABLE' }),
    );
    expect(isOk(registered)).toBe(true);
    if (isOk(registered)) expect(registered.value.id).toMatch(/^[0-9a-f]{8}-/);
    // The write itself never carries the caller's id — the column is a uuid the DB owns.
    const written = fake.inserts.find((i) => i.table === resource)?.values;
    expect(written).toBeDefined();
    expect(written).not.toHaveProperty('id');
  });

  it('survives a "restart": a second store over the SAME rows sees the earlier tasking', async () => {
    // The whole point of FEATURE_STORE=postgres — the in-memory twin cannot make this promise.
    const rows = seededRows(CONTRACT_FIXTURE);
    const first = makePgLogisticsStore({ db: makeFakeDb(rows).db, verifiedIncidents: [CONTRACT_INCIDENT] });
    const created = await first.task({
      id: asId('t-restart'),
      resourceId: asId('res-1'),
      incidentId: CONTRACT_INCIDENT,
      status: 'PROPOSED',
    });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    const second = makePgLogisticsStore({ db: makeFakeDb(rows).db, verifiedIncidents: [CONTRACT_INCIDENT] });
    const advanced = await second.task({
      id: created.value.id,
      resourceId: asId('res-1'),
      incidentId: CONTRACT_INCIDENT,
      status: 'TASKED',
    });
    expect(isOk(advanced) && advanced.value.status).toBe('TASKED');
  });

  it('never queries Postgres for a non-uuid task id (a malformed literal is not an error to raise)', async () => {
    const fake = makeFakeDb(seededRows(CONTRACT_FIXTURE));
    const store = makePgLogisticsStore({ db: fake.db, verifiedIncidents: [CONTRACT_INCIDENT] });
    const created = await store.task({
      id: asId('task-1754-1'),
      resourceId: asId('res-1'),
      incidentId: CONTRACT_INCIDENT,
      status: 'PROPOSED',
    });
    // Treated as a brand-new task and CREATED, rather than sent to a uuid column that would reject it.
    expect(isOk(created) && created.value.status).toBe('PROPOSED');
    expect(fake.inserts.filter((i) => i.table === resourceTask)).toHaveLength(1);
  });

  it('a driver fault becomes a typed Result, never an exception (Art. XVI)', async () => {
    const boom = () => {
      throw Object.assign(new Error('connection reset'), { code: '08006' });
    };
    const fake = makeFakeDb(seededRows(CONTRACT_FIXTURE), boom);
    const store = makePgLogisticsStore({ db: fake.db, verifiedIncidents: [CONTRACT_INCIDENT] });
    const r = await store.register(
      makeResource({ id: asId<ResourceId>('res-x'), kind: 'CREW', status: 'AVAILABLE' }),
    );
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PARSE_ERROR');
  });

  it('returns an empty ranking when no shelter row is eligible (never a dead-end)', async () => {
    const rows = seededRows({ ...CONTRACT_FIXTURE, shelters: [] });
    const store = makePgLogisticsStore({ db: makeFakeDb(rows).db });
    const r = await store.findShelters([0, 0]);
    expect(isOk(r) && r.value).toEqual([]);
  });
});
