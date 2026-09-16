// BEACON — the SitRep history + citation write path against a REAL Postgres (V2·WP-0).
//
// ADR-039's whole subject is a TRANSLATION: the schema addresses rows by surrogate uuid while the domain
// addresses them by natural key (`us-ca-wildfire-demo`, `firms`, `news:apnews.com`), and the FK is what
// makes getting it wrong loud. The unit suite drives injected resolver stubs and a chainable fake, so it
// proves the store CALLS a resolver — it cannot prove the resolver satisfies an actual foreign key, or
// that a value written under one id space reads back under the other.
//
// These are the assertions that need a real engine:
//   * an unresolvable incident is SKIPPED, not faked into existence;
//   * a resolvable one round-trips, and `listByIncident` answers in the CALLER'S id space — reading with
//     the domain id must not return an empty history for an incident that plainly has one, which is the
//     quietest possible way for an audit trail to lie;
//   * a cited-but-never-polled source MATERIALISES on miss rather than losing the grounding, and is
//     labelled at its weakest mode because nothing is known about its provenance;
//   * two fields citing one source resolve it once and never violate the unique key.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, SitRepId, SourceId } from '@/domain/value-objects/ids.js';
import { makeSitRep } from '@/domain/sitrep.js';
import { makePgSitRepHistoryStore } from '@/adapters/persistence/sitrep-history.js';
import { NO_PG, connect, resetAndMigrate, type Harness } from './pg-harness';

const REGION_UUID = '00000000-0000-4000-8000-0000000000ca';
const INCIDENT_UUID = '00000000-0000-4000-8000-0000000000e1';
const INCIDENT_DOMAIN = 'us-ca-wildfire-demo';
const GENERATED_AT = '2026-09-11T12:00:00.000Z';

function report(id: string, incident: string) {
  return makeSitRep({
    id: asId<SitRepId>(id),
    incidentId: asId<IncidentId>(incident),
    generatedAt: GENERATED_AT,
    summary: 'Wildfire growth slowed overnight.',
    trend: 'STEADY',
    aiMode: 'deterministic-only',
    fields: [
      {
        field: 'hazard_extent',
        claim: 'Active perimeter covers 1,240 ha.',
        citations: [{ sourceId: asId<SourceId>('firms') }],
      },
      // A news host that no adapter polls. Its row must be MATERIALISED rather than dropped — losing it
      // would silently un-ground a narrated claim, which is worse than a loud failure.
      {
        field: 'context',
        claim: 'Evacuation order widened.',
        citations: [{ sourceId: asId<SourceId>('news:apnews.com') }],
      },
    ],
    priorities: [{ rank: 1, label: 'Evacuate zone 3' }],
  });
}

describe.skipIf(NO_PG)('SitRep history + citations against a real Postgres', () => {
  let h: Harness;
  beforeAll(() => {
    h = connect();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await resetAndMigrate(h);
    await h.raw.unsafe(`
      INSERT INTO region (id,name,scope,bbox) VALUES
        ('${REGION_UUID}','CA','STATE','{"type":"Polygon","coordinates":[[[-125,32],[-113,32],[-113,42],[-125,42],[-125,32]]]}');
    `);
  });

  it('SKIPS a SitRep whose incident has no stored row — it never invents a parent to make the insert succeed', async () => {
    const store = makePgSitRepHistoryStore({ db: h.db });
    const res = await store.record(report('sitrep-1', 'an-incident-that-was-never-stored'));

    expect(isOk(res)).toBe(true);
    // `null` is the contract for "skipped". A fabricated parent row would put a fictional lineage into
    // the one artifact whose entire value is being trustworthy.
    expect(isOk(res) ? res.value : undefined).toBeNull();

    const rows = await h.db.execute(sql`SELECT count(*)::int AS n FROM sitrep`);
    expect(Number((rows as unknown as readonly { n: number }[])[0]?.n)).toBe(0);
  });

  it('records against a real FK and reads back in the CALLER’S id space, not the uuid space', async () => {
    await h.raw.unsafe(`
      INSERT INTO incident (id,region_id,type,status,domain_id) VALUES
        ('${INCIDENT_UUID}','${REGION_UUID}','WILDFIRE','ACTIVE','${INCIDENT_DOMAIN}');
    `);
    const store = makePgSitRepHistoryStore({ db: h.db });

    const res = await store.record(report('sitrep-1', INCIDENT_DOMAIN));
    expect(isOk(res)).toBe(true);
    expect(isOk(res) ? res.value : null).not.toBeNull();

    // The row really landed, and really points at the incident through the FK.
    const stored = await h.db.execute(sql`SELECT incident_id::text AS incident_id FROM sitrep`);
    const storedRows = stored as unknown as readonly { incident_id: string }[];
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]?.incident_id).toBe(INCIDENT_UUID);

    // …and the read leg translates symmetrically. Querying with the domain id must NOT come back empty.
    const listed = await store.listByIncident(asId<IncidentId>(INCIDENT_DOMAIN));
    expect(isOk(listed)).toBe(true);
    expect(isOk(listed) ? listed.value.length : 0).toBe(1);
  });

  it('materialises a cited-but-never-polled source, labelled at its weakest mode', async () => {
    await h.raw.unsafe(`
      INSERT INTO incident (id,region_id,type,status,domain_id) VALUES
        ('${INCIDENT_UUID}','${REGION_UUID}','WILDFIRE','ACTIVE','${INCIDENT_DOMAIN}');
    `);
    const store = makePgSitRepHistoryStore({ db: h.db });
    expect(isOk(await store.record(report('sitrep-1', INCIDENT_DOMAIN)))).toBe(true);

    const sources = await h.db.execute(sql`SELECT source, mode FROM source_record ORDER BY source`);
    const rows = sources as unknown as readonly { source: string; mode: string }[];
    expect(rows.map((r) => r.source)).toEqual(['firms', 'news:apnews.com']);
    // Nothing is known about how these served, so the row must claim the LEAST — never LIVE by default.
    for (const r of rows) expect(r.mode).toBe('MOCK');

    // Every citation resolved to a real source row: the join is what proves the grounding survived.
    const cited = await h.db.execute(sql`
      SELECT c.field, s.source FROM citation c JOIN source_record s ON s.id = c.source_id ORDER BY c.field
    `);
    expect(
      (cited as unknown as readonly { field: string; source: string }[]).map((r) => r.source),
    ).toEqual(['news:apnews.com', 'firms']);
  });

  it('two fields citing ONE source resolve it once and never breach the unique key', async () => {
    await h.raw.unsafe(`
      INSERT INTO incident (id,region_id,type,status,domain_id) VALUES
        ('${INCIDENT_UUID}','${REGION_UUID}','WILDFIRE','ACTIVE','${INCIDENT_DOMAIN}');
    `);
    const store = makePgSitRepHistoryStore({ db: h.db });
    const twice = makeSitRep({
      id: asId<SitRepId>('sitrep-2'),
      incidentId: asId<IncidentId>(INCIDENT_DOMAIN),
      generatedAt: GENERATED_AT,
      aiMode: 'deterministic-only',
      fields: [
        {
          field: 'hazard_extent',
          claim: 'Perimeter grew overnight.',
          citations: [{ sourceId: asId<SourceId>('firms') }],
        },
        {
          field: 'hotspots',
          claim: 'Cluster north-east.',
          citations: [{ sourceId: asId<SourceId>('firms') }],
        },
      ],
      priorities: [{ rank: 1, label: 'Recheck perimeter' }],
    });

    expect(isOk(await store.record(twice))).toBe(true);
    const rows = await h.db.execute(
      sql`SELECT count(*)::int AS n FROM source_record WHERE source='firms'`,
    );
    expect(Number((rows as unknown as readonly { n: number }[])[0]?.n)).toBe(1);
    const cites = await h.db.execute(sql`SELECT count(*)::int AS n FROM citation`);
    expect(Number((cites as unknown as readonly { n: number }[])[0]?.n)).toBe(2);
  });
});
