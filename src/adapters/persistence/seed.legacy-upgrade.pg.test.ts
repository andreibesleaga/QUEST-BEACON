// BEACON — the legacy `source_record` upgrade, exercised against a REAL Postgres (opt-in).
//
// WHY THIS FILE EXISTS. `planLegacySourceUpgrade` is pure and unit-tested; the part that can strand a
// citation or leave a legacy row behind is the executor — six foreign-key repoints and a delete inside one
// transaction — and a fake driver cannot tell a wrong column from a right one (review, PR #29). This runs
// the real thing: migrate an empty database, seed it, put it into the legacy shape an upgraded deployment
// is actually in, seed again, and read back what happened.
//
// OPT-IN, TWICE, AND LOOPBACK ONLY. A developer's `.env` on this project points `DATABASE_URL` at the live
// Railway database, and this test DROPS AND RECREATES the public schema. It therefore runs only when the
// opt-in variable is set AND the URL is a loopback address — a remote host is refused however it is asked:
//   BEACON_PG_INTEGRATION=1 DATABASE_URL=postgres://postgres:ci@localhost:5432/beacon npx vitest run \
//     src/adapters/persistence/seed.legacy-upgrade.pg.test.ts
// The CI `integration (postgres migrate)` job has exactly such a throwaway database; wiring this file into
// it is one `run:` line, and a change to the pipeline is the owner's to approve.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';
import { citation, hazardGeometry, incident, region, sitrep, sourceRecord } from './schema';
import { loadRegionRegistry } from './region-registry';
import { LEGACY_SOURCE_NAMES, buildSeed, seed } from './seed';
import type { Db } from './client';

const LEGACY_ES_UUID = '11111111-2222-4333-8444-555555555555';
const url = process.env['DATABASE_URL'];
/** Loopback only. This suite drops the schema; a remote URL — the live database — is never eligible. */
const LOOPBACK = /^postgres(?:ql)?:\/\/(?:[^@/]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//;
const optedIn =
  process.env['BEACON_PG_INTEGRATION'] === '1' && url !== undefined && LOOPBACK.test(url);

describe.skipIf(!optedIn)('legacy source_record upgrade against a real Postgres', () => {
  let client: ReturnType<typeof postgres>;
  let db: Db;

  beforeAll(async () => {
    client = postgres(url!, { max: 1 });
    db = drizzle(client, { schema }) as unknown as Db;
    await client.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
    // A pre-0009 database: Spain exists under a uuid the old positional assignment gave it, no domain id.
    const es = loadRegionRegistry();
    if (!es.ok) throw es.error;
    const spain = es.value.regions.find((r) => r.configId === 'es')!;
    await db.insert(region).values({
      id: LEGACY_ES_UUID,
      name: spain.region.name,
      scope: spain.region.scope,
      bbox: spain.region.bbox,
      enabledAdapters: [...spain.region.enabledAdapters],
    });
    await seed(db);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  /** Put the four demo rows back into the display-name shape every pre-2026-09-13 database has. */
  async function makeLegacy(): Promise<void> {
    for (const row of buildSeed().sourceRecords) {
      const legacy = LEGACY_SOURCE_NAMES[row.source];
      if (legacy === undefined) continue;
      await db.update(sourceRecord).set({ source: legacy }).where(eq(sourceRecord.id, row.id!));
    }
  }

  it('claims a pre-0009 region row by name — one Spain, the old uuid kept, every seeded FK pointed at it', async () => {
    const spains = await db
      .select({ id: region.id, domainId: region.domainId })
      .from(region)
      .where(eq(region.domainId, 'es'));
    expect(spains).toHaveLength(1);
    expect(spains[0]!.id).toBe(LEGACY_ES_UUID);
    const named = await db
      .select({ id: region.id })
      .from(region)
      .where(sql`name like 'Spain%'`);
    expect(named).toHaveLength(1);
    const esIncidents = await db
      .select({ regionId: incident.regionId })
      .from(incident)
      .where(eq(incident.regionId, LEGACY_ES_UUID));
    expect(esIncidents.length).toBeGreaterThan(0);
  });

  it('renames a legacy row in place when nothing else claims the adapter id — its uuid survives', async () => {
    await makeLegacy();
    const glofas = buildSeed().sourceRecords.find((r) => r.source === 'glofas')!;
    await seed(db);
    const [row] = await db.select().from(sourceRecord).where(eq(sourceRecord.id, glofas.id!));
    expect(row?.source).toBe('glofas');
    const named = await db
      .select()
      .from(sourceRecord)
      .where(eq(sourceRecord.source, 'Copernicus GloFAS'));
    expect(named).toHaveLength(0);
  });

  it('repoints every reference and deletes the legacy row when the mirror already minted the adapter-keyed one', async () => {
    await makeLegacy();
    const effis = buildSeed().sourceRecords.find((r) => r.source === 'effis')!;
    // The live provenance mirror got there first.
    const [minted] = await db
      .insert(sourceRecord)
      .values({
        source: 'effis',
        adapter: 'effis-adapter',
        license: 'Copernicus',
        mode: 'LIVE',
        fetchedAt: new Date(),
      })
      .returning({ id: sourceRecord.id });
    // Rows that cite the LEGACY uuid: a hazard footprint (SET NULL on delete) and a SitRep citation
    // (RESTRICT on delete) — the two outcomes the executor exists to avoid.
    const [anyIncident] = await db.select({ id: incident.id }).from(incident).limit(1);
    const [haz] = await db
      .insert(hazardGeometry)
      .values({
        incidentId: anyIncident!.id,
        kind: 'PERIMETER',
        geom: { type: 'Point', coordinates: [22, 37.5] },
        sourceId: effis.id!,
      })
      .returning({ id: hazardGeometry.id });
    const [rep] = await db
      .insert(sitrep)
      .values({ incidentId: anyIncident!.id })
      .returning({ id: sitrep.id });
    const [cit] = await db
      .insert(citation)
      .values({ sitrepId: rep!.id, sourceId: effis.id!, field: 'hazards', claim: 'test' })
      .returning({ id: citation.id });

    await seed(db);

    const gone = await db.select().from(sourceRecord).where(eq(sourceRecord.id, effis.id!));
    expect(gone).toHaveLength(0);
    const [hazAfter] = await db
      .select({ sourceId: hazardGeometry.sourceId })
      .from(hazardGeometry)
      .where(eq(hazardGeometry.id, haz!.id));
    expect(hazAfter?.sourceId).toBe(minted!.id); // repointed, not nulled
    const [citAfter] = await db
      .select({ sourceId: citation.sourceId })
      .from(citation)
      .where(eq(citation.id, cit!.id));
    expect(citAfter?.sourceId).toBe(minted!.id); // repointed, not refused
    const effisRows = await db.select().from(sourceRecord).where(eq(sourceRecord.source, 'effis'));
    expect(effisRows).toHaveLength(1);
  });

  it('a second seed run is a no-op — nothing legacy is left to upgrade', async () => {
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(sourceRecord);
    await seed(db);
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(sourceRecord);
    expect(after[0]?.n).toBe(before[0]?.n);
    for (const legacy of Object.values(LEGACY_SOURCE_NAMES)) {
      const rows = await db.select().from(sourceRecord).where(eq(sourceRecord.source, legacy));
      expect(rows).toHaveLength(0);
    }
  });
});
