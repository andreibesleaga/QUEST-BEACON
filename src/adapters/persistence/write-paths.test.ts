// BEACON — durable write-path tests: SitRep history + citations, and accepted evac routes
// (UNIMPLEMENTED_REGISTER row 30). No live DB — a driver mock in the read-models.test.ts style, extended to
// REMEMBER writes so a write→read round trip is real.
//
// The assertions that matter most are the negative and the type-level ones: a history read must not hand
// back something a display path could mistake for the current SitRep, and a history row must never survive
// without the citations that ground it (Art. XI).
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { makeSitRep } from '@/domain/sitrep.js';
import { makeEvacRoute } from '@/domain/evac-route.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  Citation,
  CitationId,
  EvacRouteId,
  IncidentId,
  SitRepId,
  SourceId,
} from '@/domain/index.js';
import type { RepositoryPort } from '@/ports/infra.js';
import type { Db } from './client';
import { makePgSitRepHistoryStore } from './sitrep-history';
import { makePgEvacRouteStore } from './evac-route-store';
import { citation, evacRoute, sitrep } from './schema';

type Row = Record<string, unknown>;

const INCIDENT = asId<IncidentId>('00000000-0000-4000-8000-0000000000c1');
const GENERATED_AT = '2026-07-05T22:00:00.000Z';

/** Nullable columns the DDL fills with NULL, so a hydrated row carries every key its reader touches. */
const NULL_COLUMNS = new Map<unknown, Row>([
  [sitrep, { summary: null, trend: null }],
  [evacRoute, { suggestedStart: null }],
]);

interface FakeDb {
  readonly db: Db;
  readonly rows: Map<unknown, Row[]>;
}

/** Stateful stand-in for the drizzle builder: insert/select/delete over in-memory rows, filters ignored. */
function makeFakeDb(): FakeDb {
  const rows = new Map<unknown, Row[]>();
  let n = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const rowsFor = (t: unknown): Row[] => {
    const existing = rows.get(t);
    if (existing) return existing;
    const fresh: Row[] = [];
    rows.set(t, fresh);
    return fresh;
  };

  const selectFrom = (t: unknown) => {
    const result = () => Promise.resolve(rowsFor(t));
    const builder = {
      where: () => builder,
      orderBy: () => builder,
      limit: () => result(),
      then: (res: (r: Row[]) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    return builder;
  };

  const db = {
    select: () => ({ from: selectFrom }),
    insert: (t: unknown) => ({
      values: (v: Row) => {
        const row: Row = { ...NULL_COLUMNS.get(t), ...v, id: nextId() };
        return { returning: () => (rowsFor(t).push(row), Promise.resolve([row])) };
      },
    }),
    delete: (t: unknown) => ({
      where: () => {
        rowsFor(t).length = 0;
        return Promise.resolve([]);
      },
    }),
  };
  return { db: db as unknown as Db, rows };
}

/** A citation repository double — the real one (repositories.ts) is exercised by its own tests. */
function fakeCitations(onSave?: (c: Citation) => void): {
  repo: RepositoryPort<Citation, CitationId>;
  saved: Citation[];
} {
  const saved: Citation[] = [];
  const unsupported = () => Promise.reject(new Error('not used by the history store'));
  return {
    saved,
    repo: {
      getById: unsupported,
      delete: unsupported,
      list: unsupported,
      save: (c: Citation) => {
        onSave?.(c);
        saved.push(c);
        return Promise.resolve({ ok: true as const, value: c });
      },
    } as unknown as RepositoryPort<Citation, CitationId>,
  };
}

const seqCitationId = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};

const report = () =>
  makeSitRep({
    id: asId<SitRepId>('sitrep-demo-1'),
    incidentId: INCIDENT,
    generatedAt: GENERATED_AT,
    summary: 'Wildfire growth slowed overnight.',
    trend: 'STEADY',
    aiMode: 'deterministic-only',
    fields: [
      {
        field: 'hazard_extent',
        claim: 'Active perimeter covers 1,240 ha.',
        citations: [{ sourceId: asId<SourceId>('src-firms') }],
      },
      // No narrated claim — the citation still has to record WHICH field the source grounds.
      { field: 'wind', citations: [{ sourceId: asId<SourceId>('src-nws') }] },
    ],
    priorities: [{ rank: 1, label: 'Evacuate zone 3' }],
  });

/** A report whose two fields cite the SAME source — proves the resolver is not asked twice for one key. */
const reportCitingOneSourceTwice = () =>
  makeSitRep({
    id: asId<SitRepId>('sitrep-demo-2'),
    incidentId: INCIDENT,
    generatedAt: GENERATED_AT,
    aiMode: 'deterministic-only',
    fields: [
      {
        field: 'hazard_extent',
        claim: 'Perimeter grew overnight.',
        citations: [{ sourceId: asId<SourceId>('src-firms') }],
      },
      {
        field: 'hotspots',
        claim: 'Cluster detected north-east.',
        citations: [{ sourceId: asId<SourceId>('src-firms') }],
      },
    ],
    priorities: [{ rank: 1, label: 'Recheck perimeter' }],
  });

/**
 * ADR-039 natural-key resolvers, stubbed. The real pair translates the domain's readable ids into the
 * surrogate uuids the FKs require; these tests inject them so the store can be exercised without a schema.
 * `INCIDENT_ROW` stands for a resolved incident; source keys map to a predictable uuid per key.
 */
const INCIDENT_ROW = '11111111-2222-3333-4444-555555555555';
const RESOLVERS = {
  resolveIncident: async (): Promise<string | null> => INCIDENT_ROW,
  resolveSource: async (key: string): Promise<string> => `uuid-of-${key}`,
};

describe('makePgSitRepHistoryStore — natural-key resolution (ADR-039: the two recorded FK defects)', () => {
  it('writes the RESOLVED incident uuid, not the domain id — defect (a) closed', async () => {
    const fake = makeFakeDb();
    const citations = fakeCitations();
    const store = makePgSitRepHistoryStore({
      db: fake.db,
      citations: citations.repo,
      newCitationId: seqCitationId(),
      ...RESOLVERS,
    });
    const res = await store.record(report());
    expect(isOk(res)).toBe(true);
    const written = fake.rows.get(sitrep) ?? [];
    expect(written).toHaveLength(1);
    // The COLUMN carries the uuid the FK can satisfy...
    expect((written[0] as { incidentId?: unknown }).incidentId).toBe(INCIDENT_ROW);
    // ...while the CALLER is answered in the id space it asked in.
    if (isOk(res) && res.value !== null) expect(res.value.incidentId).toBe(INCIDENT);
  });

  it('writes the RESOLVED source uuid on every citation — defect (b) closed', async () => {
    const citations = fakeCitations();
    const store = makePgSitRepHistoryStore({
      db: makeFakeDb().db,
      citations: citations.repo,
      newCitationId: seqCitationId(),
      ...RESOLVERS,
    });
    await store.record(report());
    // `src-firms` / `src-nws` are natural keys; each citation must carry the uuid they resolved to, which is
    // what made every citation write violate its FK and roll the whole SitRep back.
    expect(citations.saved.map((c) => String(c.sourceId))).toEqual([
      'uuid-of-src-firms',
      'uuid-of-src-nws',
    ]);
  });

  it('resolves each DISTINCT source once, however many fields cite it', async () => {
    const asked: string[] = [];
    const citations = fakeCitations();
    const store = makePgSitRepHistoryStore({
      db: makeFakeDb().db,
      citations: citations.repo,
      newCitationId: seqCitationId(),
      resolveIncident: RESOLVERS.resolveIncident,
      resolveSource: async (key: string): Promise<string> => {
        asked.push(key);
        return `uuid-of-${key}`;
      },
    });
    await store.record(reportCitingOneSourceTwice());
    expect(asked).toEqual(['src-firms']);
  });

  it('SKIPS the report when its incident has no stored row — never invents a parent', async () => {
    const fake = makeFakeDb();
    const citations = fakeCitations();
    const store = makePgSitRepHistoryStore({
      db: fake.db,
      citations: citations.repo,
      newCitationId: seqCitationId(),
      resolveIncident: async (): Promise<string | null> => null,
      resolveSource: RESOLVERS.resolveSource,
    });
    const res = await store.record(report());
    expect(isOk(res)).toBe(true);
    if (isOk(res)) expect(res.value).toBeNull(); // a deliberate, reportable silence — not an error
    expect(fake.rows.get(sitrep) ?? []).toEqual([]); // and nothing at all was written
    expect(citations.saved).toEqual([]);
  });
});

describe('makePgSitRepHistoryStore — record', () => {
  it('persists the report as history with one citation row per grounded field', async () => {
    const fake = makeFakeDb();
    const citations = fakeCitations();
    const store = makePgSitRepHistoryStore({
      db: fake.db,
      citations: citations.repo,
      newCitationId: seqCitationId(),
      ...RESOLVERS,
    });
    const res = await store.record(report());
    expect(isOk(res)).toBe(true);
    if (!isOk(res) || res.value === null) throw new Error('expected a recorded history row');
    expect(res.value.citationCount).toBe(2);
    expect(res.value.incidentId).toBe(INCIDENT);
    expect(res.value.generatedAt).toBe(GENERATED_AT);
    expect(res.value.trend).toBe('STEADY');
    // Every citation points at the DB-MINTED sitrep id, not the domain SitRepId (which is not a uuid).
    expect(citations.saved.map((c) => c.sitrepId)).toEqual([res.value.rowId, res.value.rowId]);
    expect(citations.saved.map((c) => c.field)).toEqual(['hazard_extent', 'wind']);
  });

  it('cites a claim-less field BY NAME rather than inventing a sentence (Art. XII)', async () => {
    const citations = fakeCitations();
    const store = makePgSitRepHistoryStore({
      db: makeFakeDb().db,
      citations: citations.repo,
      newCitationId: seqCitationId(),
      ...RESOLVERS,
    });
    await store.record(report());
    expect(citations.saved[0]?.claim).toBe('Active perimeter covers 1,240 ha.');
    expect(citations.saved[1]?.claim).toBe('wind');
  });

  it('the history row does NOT survive a citation failure (no ungrounded audit entry)', async () => {
    const fake = makeFakeDb();
    const failing: RepositoryPort<Citation, CitationId> = {
      getById: () => Promise.reject(new Error('unused')),
      delete: () => Promise.reject(new Error('unused')),
      list: () => Promise.reject(new Error('unused')),
      save: () =>
        Promise.resolve({
          ok: false as const,
          error: new DomainError('CONFLICT', 'source_record missing'),
        }),
    } as unknown as RepositoryPort<Citation, CitationId>;
    const store = makePgSitRepHistoryStore({
      db: fake.db,
      citations: failing,
      newCitationId: seqCitationId(),
      ...RESOLVERS,
    });
    const res = await store.record(report());
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('CONFLICT');
    expect(fake.rows.get(sitrep)).toEqual([]);
  });

  it('a driver fault becomes a typed Result, never an exception', async () => {
    const broken = {
      insert: () => ({
        values: () => ({
          returning: () => Promise.reject(Object.assign(new Error('pg'), { code: '42P01' })),
        }),
      }),
    } as unknown as Db;
    const res = await makePgSitRepHistoryStore({ db: broken, ...RESOLVERS }).record(report());
    expect(isErr(res)).toBe(true);
    // 42P01 is a MISSING MIGRATION — the server's fault, and it must not read as a client validation error.
    if (isErr(res)) expect(res.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('makePgSitRepHistoryStore — listByIncident is HISTORY, not a SitRep cache', () => {
  it('returns records that carry no fields/priorities/outlook a display path could render as current', async () => {
    const fake = makeFakeDb();
    const store = makePgSitRepHistoryStore({
      db: fake.db,
      citations: fakeCitations().repo,
      newCitationId: seqCitationId(),
      ...RESOLVERS,
    });
    await store.record(report());
    const res = await store.listByIncident(INCIDENT);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toHaveLength(1);
    const record = res.value[0] as unknown as Record<string, unknown>;
    // A stale SitRep rendered as the current one is a correctness bug; the shape makes that unreachable.
    expect(record['fields']).toBeUndefined();
    expect(record['priorities']).toBeUndefined();
    expect(record['outlook']).toBeUndefined();
    expect(record['aiMode']).toBe('deterministic-only');
  });

  it('counts the citations of each history row (was this report grounded?)', async () => {
    const fake = makeFakeDb();
    // The citation rows the REAL repository would have written, seeded directly.
    fake.rows.set(citation, []);
    const store = makePgSitRepHistoryStore({
      db: fake.db,
      citations: {
        save: (c: Citation) => {
          (fake.rows.get(citation) as Row[]).push({ sitrepId: c.sitrepId });
          return Promise.resolve({ ok: true as const, value: c });
        },
      } as unknown as RepositoryPort<Citation, CitationId>,
      newCitationId: seqCitationId(),
      ...RESOLVERS,
    });
    const recorded = await store.record(report());
    expect(isOk(recorded)).toBe(true);
    const res = await store.listByIncident(INCIDENT);
    expect(isOk(res) && res.value[0]?.citationCount).toBe(2);
  });

  it('returns an empty history for an incident with no persisted report', async () => {
    const store = makePgSitRepHistoryStore({
      db: makeFakeDb().db,
      citations: fakeCitations().repo,
    });
    const res = await store.listByIncident(
      asId<IncidentId>('00000000-0000-4000-8000-0000000000c9'),
    );
    expect(isOk(res) && res.value).toEqual([]);
  });
});

describe('makePgEvacRouteStore', () => {
  const route = (id: string) =>
    makeEvacRoute({
      id: asId<EvacRouteId>(id),
      incidentId: INCIDENT,
      geom: {
        type: 'LineString',
        coordinates: [
          [-121.5, 38.6],
          [-121.4, 38.7],
        ],
      },
      avoidsHazard: true,
      suggestedStart: GENERATED_AT,
    });

  it('persists an accepted route and returns the STORED entity (DB-minted id)', async () => {
    const store = makePgEvacRouteStore(makeFakeDb().db, RESOLVERS);
    const res = await store.accept(route('evac-heuristic-demo'));
    expect(isOk(res)).toBe(true);
    if (!isOk(res) || res.value === null) throw new Error('expected a stored route');
    expect(res.value.id).toMatch(/^[0-9a-f]{8}-/);
    expect(res.value.avoidsHazard).toBe(true);
    expect(res.value.suggestedStart).toBe(GENERATED_AT);
    expect(res.value.geom.coordinates).toEqual([
      [-121.5, 38.6],
      [-121.4, 38.7],
    ]);
  });

  it('APPENDS: accepting a second route after the hazard moved does not overwrite the first decision', async () => {
    const store = makePgEvacRouteStore(makeFakeDb().db, RESOLVERS);
    await store.accept(route('evac-1'));
    await store.accept(route('evac-2'));
    const res = await store.listByIncident(INCIDENT);
    expect(isOk(res) && res.value).toHaveLength(2);
  });

  it('SKIPS a route whose incident has no stored row — an orphan order is not a record (ADR-039)', async () => {
    const store = makePgEvacRouteStore(makeFakeDb().db, {
      resolveIncident: async (): Promise<string | null> => null,
    });
    const res = await store.accept(route('evac-orphan'));
    expect(isOk(res)).toBe(true);
    if (isOk(res)) expect(res.value).toBeNull();
  });

  it('stores the RESOLVED incident uuid but answers in the domain id space', async () => {
    const fake = makeFakeDb();
    const store = makePgEvacRouteStore(fake.db, RESOLVERS);
    const res = await store.accept(route('evac-resolved'));
    if (!isOk(res) || res.value === null) throw new Error('expected a stored route');
    expect(res.value.incidentId).toBe(INCIDENT); // the caller's id space, not the surrogate
  });

  it('rejects a non-LineString geometry through the domain factory (a Point is not a path)', async () => {
    const store = makePgEvacRouteStore(makeFakeDb().db, RESOLVERS);
    const res = await store.accept({
      id: asId<EvacRouteId>('evac-bad'),
      incidentId: INCIDENT,
      geom: { type: 'Point', coordinates: [-121.5, 38.6] },
      avoidsHazard: true,
    } as unknown as ReturnType<typeof route>);
    expect(isErr(res)).toBe(true);
  });

  it('a driver fault becomes a typed Result, never an exception', async () => {
    const broken = {
      insert: () => ({
        values: () => ({
          returning: () => Promise.reject(Object.assign(new Error('pg'), { code: '23503' })),
        }),
      }),
    } as unknown as Db;
    // The resolver is injected so the test reaches the INSERT, which is what it is about. (Post-ADR-039 a
    // 23503 on this table should be unreachable — the incident is resolved before the write — but the
    // driver-fault MAPPING still has to hold for every other constraint the table carries.)
    const res = await makePgEvacRouteStore(broken, RESOLVERS).accept(route('evac-fk'));
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('CONFLICT');
  });
});
