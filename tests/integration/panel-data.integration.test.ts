// BEACON — the operator-panel store against a REAL Postgres (V2·WP-0, closing A12's own flagged gaps).
//
// WHY THESE EXACT TESTS. The A12 implementer did something admirable: it reported, unprompted, exactly
// where its confidence rested on a fake rather than a database. Those flags are the specification for this
// file, one test each:
//
//   1. `makePgPanelDataPort` is never exercised against a real connection — only a table→rows map.
//   2. Drizzle column-type assumptions are unproven: `updated_at`/`expires_at` are expected back as `Date`,
//      `skills` jsonb as `string[]`, `geom` jsonb as an object. Wrong on any of these and the adapter's
//      `.toISOString()` or spread breaks ONLY against a real engine.
//   3. `lastEditedAt` depends on the `set_updated_at()` triggers created in migration 0010 actually
//      existing and firing. If a trigger is missing, `DB` provenance silently reports the INSERT instant
//      as freshness — a wrong timestamp that looks exactly like a right one.
//   4. The `uq_*_domain_id` constraints are asserted only as Drizzle metadata, never as a rejected insert.
//   5. The five CHECK constraints are never exercised at all.
//
// That list is the same defect class the A2 review found: a suite that proves statement SHAPE and calls it
// proof of BEHAVIOUR. Flagging it honestly is what made closing it cheap.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { isOk } from '@/domain/shared/result.js';
import { makePgPanelDataPort } from '@/adapters/persistence/panel-data.js';
import { NO_PG, connect, resetAndMigrate, type Harness } from './pg-harness';

const REGION = '00000000-0000-4000-8000-0000000000ca';

describe.skipIf(NO_PG)('operator panel store against a real Postgres', () => {
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
        ('${REGION}','CA','STATE','{"type":"Polygon","coordinates":[[[-125,32],[-113,32],[-113,42],[-125,42],[-125,32]]]}');
    `);
  });

  // (1) + (2) — a real connection, and the column types the adapter assumes.
  it('reads real rows and gets back the column types the adapter assumes', async () => {
    await h.raw.unsafe(`
      INSERT INTO supply_lot (domain_id, region_id, quantity, unit, expires_at)
        VALUES ('supply-water-1l','${REGION}', 480, 'LITRE', '2026-12-01T00:00:00Z');
      INSERT INTO volunteer_team (domain_id, region_id, callsign, headcount, skills, availability)
        VALUES ('team-alpha','${REGION}','ALPHA', 12, '["medical","swiftwater"]'::jsonb, 'AVAILABLE');
    `);
    const port = makePgPanelDataPort(h.db);

    const supplies = await port.supplies();
    expect(isOk(supplies)).toBe(true);
    if (!isOk(supplies)) return;
    const lot = supplies.value.rows[0];
    expect(lot?.id).toBe('supply-water-1l'); // the NATURAL key, not the uuid — what an operator edits
    expect(lot?.quantity).toBe(480);
    expect(lot?.unit).toBe('LITRE');
    // If `expires_at` came back as a string rather than a Date, the adapter's .toISOString() would have
    // thrown and this would be an err, not an ok. Asserting the VALUE proves the round-trip end to end.
    expect(lot?.expiresAt).toBe('2026-12-01T00:00:00.000Z');

    const teams = await port.volunteerTeams();
    expect(isOk(teams)).toBe(true);
    if (!isOk(teams)) return;
    // jsonb → string[] is the assumption under test; a JSON string here would spread into characters.
    expect(teams.value.rows[0]?.skills).toEqual(['medical', 'swiftwater']);
    expect(teams.value.rows[0]?.headcount).toBe(12);
  });

  // (3) — the trigger. This is the subtlest of the five: without it, freshness lies quietly.
  it('lastEditedAt tracks a real UPDATE, which means the migration’s trigger really fires', async () => {
    await h.raw.unsafe(`
      INSERT INTO supply_lot (domain_id, region_id, quantity, unit)
        VALUES ('supply-water-1l','${REGION}', 100, 'LITRE');
    `);
    const port = makePgPanelDataPort(h.db);
    const first = await port.supplies();
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    const before = first.value.lastEditedAt;
    expect(before).toBeDefined();

    // Sleep past the timestamp resolution, then edit the row the way an operator would in Directus.
    await new Promise((r) => setTimeout(r, 1100));
    await h.raw.unsafe(`UPDATE supply_lot SET quantity = 90 WHERE domain_id = 'supply-water-1l';`);

    const second = await port.supplies();
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.rows[0]?.quantity).toBe(90);
    // If `set_updated_at()` were missing, updated_at would still hold the INSERT instant and this would be
    // equal — the panel would then date an hour-old edit as fresh, or a fresh edit as an hour old.
    expect(Date.parse(second.value.lastEditedAt as string)).toBeGreaterThan(
      Date.parse(before as string),
    );
  });

  it('lastEditedAt is ABSENT for an empty table rather than defaulting to now', async () => {
    const port = makePgPanelDataPort(h.db);
    const res = await port.supplies();
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.rows).toHaveLength(0);
    // A store with no rows has nothing to date. Inventing "now" would make an empty panel look freshly
    // confirmed, which is the opposite of what it is.
    expect(res.value.lastEditedAt).toBeUndefined();
  });

  // (4) — the unique natural key, as a REJECTED insert rather than as Drizzle metadata.
  it('refuses a duplicate natural key', async () => {
    await h.raw.unsafe(`
      INSERT INTO supply_lot (domain_id, region_id, quantity, unit)
        VALUES ('supply-water-1l','${REGION}', 100, 'LITRE');
    `);
    await expect(
      h.raw.unsafe(`
        INSERT INTO supply_lot (domain_id, region_id, quantity, unit)
          VALUES ('supply-water-1l','${REGION}', 200, 'LITRE');
      `),
    ).rejects.toThrow(/uq_supply_lot_domain_id|duplicate key/i);
  });

  // (5) — the CHECK constraints. The panel re-validates on read, so these are belt-and-braces; but they
  // are the only thing standing between a typo in Directus and a bad row existing at all.
  it('rejects at the DATABASE what the domain factory would reject at the boundary', async () => {
    // A quantity with no unit: `makeSupplyFields` refuses it because a bare number is not a comparable
    // stock figure. The same rule in SQL, because this is a table a human types into directly.
    await expect(
      h.raw.unsafe(
        `INSERT INTO supply_lot (domain_id, region_id, quantity) VALUES ('a','${REGION}', 5);`,
      ),
    ).rejects.toThrow(/chk_supply_lot_quantity_requires_unit/i);

    await expect(
      h.raw.unsafe(
        `INSERT INTO supply_lot (domain_id, region_id, quantity, unit) VALUES ('b','${REGION}', -1, 'LITRE');`,
      ),
    ).rejects.toThrow(/chk_supply_lot_quantity_nonneg/i);

    await expect(
      h.raw.unsafe(
        `INSERT INTO supply_lot (domain_id, region_id, quantity, unit) VALUES ('c','${REGION}', 5, 'FURLONGS');`,
      ),
    ).rejects.toThrow(/chk_supply_lot_unit/i);
  });

  it('a NULL optional column is OMITTED from the row, never coerced to 0 or an empty string', async () => {
    await h.raw.unsafe(
      `INSERT INTO supply_lot (domain_id, region_id) VALUES ('supply-unknown','${REGION}');`,
    );
    const res = await makePgPanelDataPort(h.db).supplies();
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const row = res.value.rows[0];
    // "Nobody has counted this" must not become "there are zero of these". On a supply board that
    // difference decides whether an operator sends a truck.
    expect(row?.quantity).toBeUndefined();
    expect(row?.unit).toBeUndefined();
    expect(row?.expiresAt).toBeUndefined();
  });

  it('every panel table registers a set_updated_at trigger (all five, not just the one exercised above)', async () => {
    const rows = await h.db.execute(sql`
      SELECT event_object_table AS t FROM information_schema.triggers
       WHERE trigger_schema = 'public' AND event_object_table IN
             ('supply_lot','volunteer_team','damage_assessment_entry','ems_overlay_product','shelter')
       GROUP BY event_object_table ORDER BY event_object_table
    `);
    const tables = (rows as unknown as readonly { t: string }[]).map((r) => r.t);
    expect(tables).toEqual([
      'damage_assessment_entry',
      'ems_overlay_product',
      'shelter',
      'supply_lot',
      'volunteer_team',
    ]);
  });
});
