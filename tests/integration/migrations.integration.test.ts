// BEACON — migrations against a REAL Postgres (V2·WP-0).
//
// These are the assertions that the unit suite structurally cannot make. Each one corresponds to a defect
// that shipped green: the migration set must apply from empty, and — the case that actually broke —
// migration 0007 must survive a database that already holds duplicate `source_record.source` rows with a
// `citation` pinned to one that has to die. `citation.source_id` is NOT NULL ON DELETE RESTRICT, so the
// order of operations inside 0007 is load-bearing, and nothing but a real engine can check it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  NO_PG,
  applyMigration,
  connect,
  migrateUpTo,
  resetAndMigrate,
  type Harness,
} from './pg-harness';

describe.skipIf(NO_PG)('migrations against a real Postgres', () => {
  let h: Harness;
  beforeAll(() => {
    h = connect();
  });
  afterAll(async () => {
    await h.close();
  });

  it('applies every migration from an empty database, in journal order', async () => {
    const applied = await resetAndMigrate(h);
    expect(applied.length).toBeGreaterThanOrEqual(10);
    const tables = await h.db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
    );
    const names = (tables as unknown as readonly { table_name: string }[]).map((r) => r.table_name);
    // The four tables A2's durable claim rests on must exist after a clean migrate.
    for (const t of ['source_record', 'incident', 'sitrep', 'citation', 'evac_route']) {
      expect(names, `${t} must exist after a clean migrate`).toContain(t);
    }
  });

  it('0007 dedups a database that ALREADY holds duplicate sources, without stranding a citation', async () => {
    // Build the pre-0007 world: this is the only database the dedup block in 0007 exists for.
    await migrateUpTo(h, '0007');

    await h.raw.unsafe(`
      INSERT INTO source_record (id, source, adapter, mode, fetched_at) VALUES
        ('00000000-0000-4000-8000-00000000f001','firms','firms','CACHED','2026-09-01T00:00:00Z'),
        ('00000000-0000-4000-8000-00000000f002','firms','firms','LIVE',  '2026-09-10T00:00:00Z'),
        ('00000000-0000-4000-8000-00000000f003','nws','nws','LIVE','2026-09-10T00:00:00Z');
      INSERT INTO region (id,name,scope,bbox) VALUES
        ('00000000-0000-4000-8000-0000000000ca','CA','STATE','{"type":"Polygon","coordinates":[[[-125,32],[-113,32],[-113,42],[-125,42],[-125,32]]]}');
      INSERT INTO incident (id,region_id,type,status) VALUES
        ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000ca','WILDFIRE','ACTIVE');
      INSERT INTO sitrep (id,incident_id) VALUES
        ('00000000-0000-4000-8000-00000000051e','00000000-0000-4000-8000-0000000000e1');
      -- Pinned to the LOSER. Deleting it first would abort the migration on the RESTRICT.
      INSERT INTO citation (id,sitrep_id,source_id,field,claim) VALUES
        ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-00000000051e',
         '00000000-0000-4000-8000-00000000f001','summary','pinned to the loser');
    `);

    // The assertion IS that this does not throw. Before the fix it raised
    // `could not create unique index "uq_source_record_source" … Key (source)=(firms) is duplicated`.
    await applyMigration(h, '0007');

    const rows = await h.db.execute(
      sql`SELECT source, count(*)::int AS n FROM source_record GROUP BY source`,
    );
    const bySource = new Map(
      (rows as unknown as readonly { source: string; n: number }[]).map((r) => [
        r.source,
        Number(r.n),
      ]),
    );
    expect(bySource.get('firms'), 'the duplicate must be collapsed to one row').toBe(1);
    expect(bySource.get('nws')).toBe(1);

    // The citation must still RESOLVE, and to the survivor — the freshest row, not whichever was inserted
    // first. A citation that cannot name its source is the one row this project must never produce.
    const cited = await h.db.execute(sql`
      SELECT s.id::text AS id, s.mode FROM citation c JOIN source_record s ON s.id = c.source_id
    `);
    const citedRows = cited as unknown as readonly { id: string; mode: string }[];
    expect(citedRows).toHaveLength(1);
    expect(citedRows[0]?.id).toBe('00000000-0000-4000-8000-00000000f002');
    expect(citedRows[0]?.mode, 'the survivor is the most recently fetched row').toBe('LIVE');

    const con = await h.db.execute(
      sql`SELECT conname FROM pg_constraint WHERE conname = 'uq_source_record_source'`,
    );
    expect(con as unknown as readonly unknown[]).toHaveLength(1);
  });

  it('rejects a multi-row upsert carrying duplicate keys — the constraint the sink must respect', async () => {
    await resetAndMigrate(h);
    // This is EXACTLY the statement shape the provenance sink emitted before the B2 fix: one region's
    // sources flattened together with another's, so a source enabled in several regions appears twice.
    // Postgres refuses it. The unit fake did not, which is why it shipped.
    await expect(
      h.raw.unsafe(`
        INSERT INTO source_record (source, adapter, mode, fetched_at) VALUES
          ('firms','firms','LIVE','2026-09-11T10:00:00Z'),
          ('firms','firms','LIVE','2026-09-11T10:05:00Z')
        ON CONFLICT (source) DO UPDATE SET mode=excluded.mode, fetched_at=excluded.fetched_at;
      `),
    ).rejects.toThrow(/cannot affect row a second time/i);
  });
});
