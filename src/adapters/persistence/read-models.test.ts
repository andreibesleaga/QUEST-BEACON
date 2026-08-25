// BEACON — Postgres read-model + durable report-store tests (Phase-B lane B3). Two layers:
//   1. WRAPPER CONTRACT (no live DB): a driver-mock proves rows→Views mapping, the report round-trip
//      (intake→triage→list), hash-chain continuity, geomPrecise parity, and NOT_FOUND — mirroring the
//      driver-agnostic approach in repository.test.ts.
//   2. REAL round-trip: a DB-gated `describe.skipIf(!DATABASE_URL_TEST)` block exercising the store
//      against a real Postgres (only runs when DATABASE_URL_TEST is set — never in the offline suite).
import { afterEach, describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { linkHash } from '@/domain/audit-event.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AppUserId, PublicReportId } from '@/domain/value-objects/ids.js';
import {
  makePgPublicReportStore,
  makePgRegionReadModel,
  makePgSourceReadModel,
} from './read-models';
import type { Db } from './client';
import { auditEvent, publicReport, region, sourceRecord } from './schema';

// ── Driver mock ──────────────────────────────────────────────────────────────
// A minimal chainable fake of the drizzle query builder covering exactly the shapes read-models use:
//   select().from(t)[.where()][.orderBy()][.limit()]  → rows for table t
//   insert(t).values(v)[.returning()]                 → [onReturn(t,v)] and captures the write
//   update(t).set(s).where()[.returning()]            → [onReturn(t,s)] and captures the write
type Row = Record<string, unknown>;
interface FakeConfig {
  readonly rows?: Map<unknown, readonly Row[]>;
  readonly onReturn?: (table: unknown, values: Row) => Row;
}
interface Captured {
  readonly inserts: Array<{ table: unknown; values: Row }>;
  readonly updates: Array<{ table: unknown; values: Row }>;
}

function makeFakeDb(cfg: FakeConfig = {}): { db: Db; captured: Captured } {
  const captured: Captured = { inserts: [], updates: [] };
  const rowsFor = (t: unknown): readonly Row[] => cfg.rows?.get(t) ?? [];
  const echo = (t: unknown, v: Row): Row => cfg.onReturn?.(t, v) ?? v;

  const selectFrom = (t: unknown) => {
    const rows = rowsFor(t);
    const p = Promise.resolve(rows);
    const builder = {
      where: () => builder,
      orderBy: () => builder,
      limit: () => p,
      then: (res: (r: readonly Row[]) => unknown, rej?: (e: unknown) => unknown) => p.then(res, rej),
    };
    return builder;
  };

  const db = {
    select: () => ({ from: selectFrom }),
    insert: (t: unknown) => ({
      values: (v: Row) => {
        captured.inserts.push({ table: t, values: v });
        const returning = () => Promise.resolve([echo(t, v)]);
        return { returning, then: (r: (x: unknown) => unknown) => Promise.resolve([echo(t, v)]).then(r) };
      },
    }),
    update: (t: unknown) => ({
      set: (s: Row) => ({
        where: () => ({
          returning: () => {
            captured.updates.push({ table: t, values: s });
            return Promise.resolve([echo(t, s)]);
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as Db, captured };
}

const T = new Date('2026-07-13T12:00:00.000Z');
const fixedClock = () => T.toISOString();
const seqId = () => {
  let n = 0;
  return (prefix: string) => `${prefix}-${++n}`;
};

// ── Region read-model ──────────────────────────────────────────────────────────

describe('makePgRegionReadModel', () => {
  it('maps region rows to RegionView{id,name}', async () => {
    const rows = new Map<unknown, readonly Row[]>([
      [
        region,
        [
          { id: 'reg-ca', name: 'California', scope: 'STATE', bbox: [-124.48, 32.53, -114.13, 42.01], enabledAdapters: [], sourceModeOverrides: {}, createdAt: T, updatedAt: T },
          { id: 'reg-ro', name: 'Romania', scope: 'COUNTRY', bbox: [20.26, 43.62, 29.71, 48.27], enabledAdapters: [], sourceModeOverrides: {}, createdAt: T, updatedAt: T },
        ],
      ],
    ]);
    const { db } = makeFakeDb({ rows });
    const res = await makePgRegionReadModel(db).list();
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value).toEqual([
        { id: 'reg-ca', name: 'California' },
        { id: 'reg-ro', name: 'Romania' },
      ]);
    }
  });
});

// ── Source read-model ───────────────────────────────────────────────────────────

describe('makePgSourceReadModel', () => {
  // A fixed PAST fetchedAt — the Freshness VO rejects future timestamps (clock-skew guard); keep it
  // deterministic (no wall-clock-relative values).
  const FETCHED = new Date('2024-09-01T00:00:00.000Z');
  const rows = new Map<unknown, readonly Row[]>([
    [
      sourceRecord,
      [
        { id: 'src-1', source: 'NASA FIRMS', adapter: 'firms-adapter', fetchedAt: FETCHED, license: 'NASA open', mode: 'LIVE', createdAt: FETCHED },
        { id: 'src-2', source: 'Copernicus GloFAS', adapter: 'glofas-adapter', fetchedAt: FETCHED, license: 'Copernicus', mode: 'CACHED', createdAt: FETCHED },
      ],
    ],
  ]);

  it('maps source_record rows to SourceView{sourceId,mode,fetchedAt}', async () => {
    const { db } = makeFakeDb({ rows });
    const res = await makePgSourceReadModel(db).list(asId('reg-ca'));
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value).toEqual([
        { sourceId: 'NASA FIRMS', mode: 'LIVE', fetchedAt: FETCHED.toISOString() },
        { sourceId: 'Copernicus GloFAS', mode: 'CACHED', fetchedAt: FETCHED.toISOString() },
      ]);
    }
  });

  it('returns ALL sources regardless of regionId (documented no-region limitation)', async () => {
    const { db } = makeFakeDb({ rows });
    const rm = makePgSourceReadModel(db);
    const a = await rm.list(asId('reg-ca'));
    const b = await rm.list(asId('reg-ro'));
    expect(isOk(a) && a.value.length).toBe(2);
    expect(isOk(b) && b.value.length).toBe(2);
  });
});

// ── Durable public-report store ─────────────────────────────────────────────────

// A well-formed persisted report row (Date purge_after, jsonb geom, null optionals like real drizzle).
function reportRow(over: Partial<Row> = {}): Row {
  return {
    id: 'db-uuid-1',
    incidentId: null,
    source: 'WEB',
    status: 'UNVERIFIED',
    confidence: null,
    confidenceComponents: null,
    geomGeneralized: null,
    geomPrecise: null,
    consent: true,
    purgeAfter: new Date('2026-08-12T12:00:00.000Z'),
    receivedAt: null,
    liveViewUrl: null,
    sourceId: null,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

describe('makePgPublicReportStore — intake', () => {
  it('inserts an UNVERIFIED report with a clock-derived purgeAfter + precise geometry', async () => {
    // The DB mints the uuid PK — echo the insert values plus a uuid so reportFromRow has an id.
    const { db, captured } = makeFakeDb({
      onReturn: (_t, v) => reportRow({ ...v, id: 'db-uuid-1', status: 'UNVERIFIED' }),
    });
    const store = makePgPublicReportStore(db, fixedClock, seqId());
    const res = await store.intake({ consent: true, source: 'WEB', text: 'smoke', location: [-121.58, 39.71] });
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.status).toBe('UNVERIFIED');
      expect(res.value.geomPrecise).toEqual({ type: 'Point', coordinates: [-121.58, 39.71] });
      // purgeAfter = clock + 30d retention.
      expect(res.value.purgeAfter).toBe('2026-08-12T12:00:00.000Z');
    }
    // The write omits the id (DB-minted uuid PK) and carries the precise geometry.
    const written = captured.inserts.find((i) => i.table === publicReport)?.values;
    expect(written).toBeDefined();
    expect(written).not.toHaveProperty('id');
    expect(written?.geomPrecise).toEqual({ type: 'Point', coordinates: [-121.58, 39.71] });
    // receivedAt is stamped from the injected clock (durable-path parity with the memory store).
    expect(written?.receivedAt).toBe(T.toISOString());
    if (isOk(res)) expect(res.value.receivedAt).toBe(T.toISOString());
  });

  it('persists the citizen live-view link on the durable row (was previously dropped)', async () => {
    const { db, captured } = makeFakeDb({
      onReturn: (_t, v) => reportRow({ ...v, id: 'db-uuid-1', status: 'UNVERIFIED' }),
    });
    const store = makePgPublicReportStore(db, fixedClock, seqId());
    const res = await store.intake({
      consent: true,
      source: 'WEB',
      text: 'streaming the front',
      liveViewUrl: 'https://twitch.tv/firewatch',
    });
    expect(isOk(res)).toBe(true);
    if (isOk(res)) expect(res.value.liveViewUrl).toBe('https://twitch.tv/firewatch');
    const written = captured.inserts.find((i) => i.table === publicReport)?.values;
    expect(written?.liveViewUrl).toBe('https://twitch.tv/firewatch');
  });

  it('round-trips received_at + live_view_url off a persisted row (reportFromRow mapping)', async () => {
    const rows = new Map<unknown, readonly Row[]>([
      [
        publicReport,
        [reportRow({ status: 'TRIAGED', receivedAt: '2026-07-05T22:00:00.000Z', liveViewUrl: 'https://twitch.tv/x' })],
      ],
    ]);
    const { db } = makeFakeDb({ rows });
    const res = await makePgPublicReportStore(db, fixedClock, seqId()).list();
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value[0]?.receivedAt).toBe('2026-07-05T22:00:00.000Z');
      expect(res.value[0]?.liveViewUrl).toBe('https://twitch.tv/x');
    }
  });
});

describe('makePgPublicReportStore — triage', () => {
  it('advances TRIAGED→VERIFIED and appends a GENESIS hash-chained audit event (no prev)', async () => {
    const rows = new Map<unknown, readonly Row[]>([
      [publicReport, [reportRow({ status: 'TRIAGED' })]],
      [auditEvent, []], // no prior triage audit → genesis
    ]);
    const { db, captured } = makeFakeDb({
      rows,
      onReturn: (t, v) => (t === publicReport ? reportRow({ status: v.status as string }) : v),
    });
    const store = makePgPublicReportStore(db, fixedClock, seqId());
    const actor = asId<AppUserId>('user-verifier');
    const res = await store.triage(asId<PublicReportId>('db-uuid-1'), 'VERIFIED', actor);
    expect(isOk(res)).toBe(true);
    if (isOk(res)) expect(res.value.status).toBe('VERIFIED');

    const audit = captured.inserts.find((i) => i.table === auditEvent)?.values;
    expect(audit).toBeDefined();
    expect(audit?.prevHash).toBeUndefined(); // genesis
    const target = `public_report:db-uuid-1|actor:${actor}`;
    expect(audit?.target).toBe(target);
    expect(audit?.action).toBe('VERIFIED');
    // hash = linkHash(undefined, payload) — reproducible from the persisted columns.
    expect(audit?.hash).toBe(linkHash(undefined, { action: 'VERIFIED', target, at: T.toISOString() }));
  });

  it('chains the audit hash onto the current tail (continuity)', async () => {
    const rows = new Map<unknown, readonly Row[]>([
      [publicReport, [reportRow({ status: 'TRIAGED' })]],
      [auditEvent, [{ id: 'ae-prev', action: 'TRIAGED', target: 'public_report:db-uuid-1|actor:x', at: T, hash: 'PREVHASH', prevHash: null, createdAt: T }]],
    ]);
    const { db, captured } = makeFakeDb({
      rows,
      onReturn: (t, v) => (t === publicReport ? reportRow({ status: v.status as string }) : v),
    });
    const store = makePgPublicReportStore(db, fixedClock, seqId());
    const actor = asId<AppUserId>('user-em');
    await store.triage(asId<PublicReportId>('db-uuid-1'), 'REJECTED', actor);
    const audit = captured.inserts.find((i) => i.table === auditEvent)?.values;
    const target = `public_report:db-uuid-1|actor:${actor}`;
    expect(audit?.prevHash).toBe('PREVHASH');
    expect(audit?.hash).toBe(linkHash('PREVHASH', { action: 'REJECTED', target, at: T.toISOString() }));
  });

  it('returns NOT_FOUND for an unknown report id (never fabricates one)', async () => {
    const rows = new Map<unknown, readonly Row[]>([[publicReport, []]]);
    const { db } = makeFakeDb({ rows });
    const store = makePgPublicReportStore(db, fixedClock, seqId());
    const res = await store.triage(asId<PublicReportId>('missing'), 'TRIAGED', asId<AppUserId>('v'));
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('rejects an illegal transition (UNVERIFIED→VERIFIED) via the domain state machine', async () => {
    const rows = new Map<unknown, readonly Row[]>([[publicReport, [reportRow({ status: 'UNVERIFIED' })]]]);
    const { db } = makeFakeDb({ rows });
    const store = makePgPublicReportStore(db, fixedClock, seqId());
    const res = await store.triage(asId<PublicReportId>('db-uuid-1'), 'VERIFIED', asId<AppUserId>('v'));
    expect(isErr(res)).toBe(true);
  });
});

describe('makePgPublicReportStore — list (geomPrecise parity)', () => {
  it('returns reports WITH geomPrecise (gating is the HTTP handler’s job, not the store’s)', async () => {
    const geomPrecise = { type: 'Point', coordinates: [-121.58, 39.71] };
    const rows = new Map<unknown, readonly Row[]>([
      [publicReport, [reportRow({ status: 'TRIAGED', geomPrecise })]],
    ]);
    const { db } = makeFakeDb({ rows });
    const res = await makePgPublicReportStore(db, fixedClock, seqId()).list();
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value).toHaveLength(1);
      expect(res.value[0]?.geomPrecise).toEqual(geomPrecise);
    }
  });
});

// ── DB-gated real round-trip (skipped unless a real Postgres is provided) ────────
// Runs the store against a real DB: intake → triage → list + a verifiable, continuous audit chain.
const DB_URL = process.env.DATABASE_URL_TEST;

describe.skipIf(!DB_URL)('makePgPublicReportStore — real Postgres round-trip', () => {
  // Imported lazily so the offline suite never loads the postgres driver.
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  it('intake → triage → list round-trips with a continuous hash chain', async () => {
    const { makeDb } = await import('./client');
    const db = makeDb(DB_URL);
    const store = makePgPublicReportStore(db, () => new Date().toISOString(), (p) => `${p}-${Math.random()}`);

    const created = await store.intake({ consent: true, source: 'WEB', text: 'real', location: [-121.5, 38.6] });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    const id = created.value.id;

    const t1 = await store.triage(id, 'TRIAGED', asId<AppUserId>('00000000-0000-4000-8000-000000000a03'));
    expect(isOk(t1)).toBe(true);
    const t2 = await store.triage(id, 'VERIFIED', asId<AppUserId>('00000000-0000-4000-8000-000000000a03'));
    expect(isOk(t2) && t2.value.status).toBe('VERIFIED');

    const listed = await store.list();
    expect(isOk(listed) && listed.value.some((r) => r.id === id)).toBe(true);

    const trail = await store.auditTrail();
    expect(isOk(trail)).toBe(true);
    if (isOk(trail)) {
      const mine = trail.value.filter((r) => r.reportId === id);
      expect(mine.length).toBeGreaterThanOrEqual(2);
    }
  });
});
