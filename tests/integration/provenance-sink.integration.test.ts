// BEACON — the durable provenance + SitRep-history adapters against a REAL Postgres (V2·WP-0).
//
// The unit suites for these adapters drive a hand-rolled chainable fake. That fake proved the statements
// were SHAPED right and could not have proven they WORK — which is precisely how B2 shipped. Here the real
// adapter runs against a real engine, with the real multi-region batch shape.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { isOk } from '@/domain/shared/result.js';
import { makePgProvenanceSink } from '@/adapters/persistence/provenance-sink.js';
import { NO_PG, connect, resetAndMigrate, type Harness } from './pg-harness';

/** The real batch shape: `firms` is enabled in all five regions, so it arrives five times in one array. */
function multiRegionBatch(): readonly {
  sourceId: string;
  adapter: string;
  mode: 'LIVE';
  fetchedAt: string;
}[] {
  const regions = ['us-ca', 'ro', 'es', 'gr', 'ph'];
  return regions.flatMap((_, i) => [
    {
      sourceId: 'firms',
      adapter: 'firms',
      mode: 'LIVE' as const,
      fetchedAt: `2026-09-11T10:0${i}:00.000Z`,
    },
    {
      sourceId: 'open-meteo',
      adapter: 'open-meteo',
      mode: 'LIVE' as const,
      fetchedAt: `2026-09-11T10:0${i}:00.000Z`,
    },
  ]);
}

describe.skipIf(NO_PG)('makePgProvenanceSink against a real Postgres', () => {
  let h: Harness;
  beforeAll(async () => {
    h = connect();
    await resetAndMigrate(h);
  });
  afterAll(async () => {
    await h.close();
  });

  it('writes a five-region batch in ONE statement without being rejected', async () => {
    const res = await makePgProvenanceSink(h.db).record(multiRegionBatch());
    // Before the B2 fix this came back as an err carrying
    // "ON CONFLICT DO UPDATE command cannot affect row a second time", and the fail-open call site
    // reduced that to a single debug line — so /sources stayed empty in production, silently.
    expect(isOk(res), 'the real multi-region batch must not be rejected').toBe(true);

    // `fetched_at` is projected as an ISO string here (raw SQL, not the typed query builder) — asserted as
    // an instant rather than a literal so the assertion cannot be broken by driver formatting.
    const rows = await h.db.execute(
      sql`SELECT source, mode, to_char(fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fetched_at
            FROM source_record ORDER BY source`,
    );
    const out = rows as unknown as readonly { source: string; mode: string; fetched_at: string }[];
    expect(out.map((r) => r.source)).toEqual(['firms', 'open-meteo']);
    // Newest fetch wins: this table is CURRENT STATE, so a stale region's poll must not overwrite a fresher one.
    expect(out[0]?.fetched_at).toBe('2026-09-11T10:04:00Z');
  });

  it('is an UPSERT, not an append: a second poll keeps one row per source AND the same uuid', async () => {
    const before = await h.db.execute(
      sql`SELECT id::text AS id FROM source_record WHERE source='firms'`,
    );
    const firstId = (before as unknown as readonly { id: string }[])[0]?.id;
    expect(firstId).toBeDefined();

    const res = await makePgProvenanceSink(h.db).record([
      {
        sourceId: 'firms',
        adapter: 'firms',
        mode: 'CACHED',
        fetchedAt: '2026-09-11T11:00:00.000Z',
      },
    ]);
    expect(isOk(res)).toBe(true);

    const after = await h.db.execute(
      sql`SELECT id::text AS id, mode FROM source_record WHERE source='firms'`,
    );
    const rows = after as unknown as readonly { id: string; mode: string }[];
    expect(rows, 'one CURRENT row per source, never one per poll').toHaveLength(1);
    // The STABLE uuid is the whole reason the upsert keys on `source`: a citation minted against this
    // source must stay valid across every later poll. If this id moved, every citation would dangle.
    expect(rows[0]?.id).toBe(firstId);
    expect(rows[0]?.mode).toBe('CACHED');
  });

  it('a source enabled in one region only is written exactly once', async () => {
    const res = await makePgProvenanceSink(h.db).record([
      { sourceId: 'nifc', adapter: 'nifc', mode: 'LIVE', fetchedAt: '2026-09-11T10:00:00.000Z' },
    ]);
    expect(isOk(res)).toBe(true);
    const rows = await h.db.execute(
      sql`SELECT count(*)::int AS n FROM source_record WHERE source='nifc'`,
    );
    expect(Number((rows as unknown as readonly { n: number }[])[0]?.n)).toBe(1);
  });

  it('an empty batch issues no statement and still succeeds', async () => {
    const res = await makePgProvenanceSink(h.db).record([]);
    expect(isOk(res)).toBe(true);
  });
});
