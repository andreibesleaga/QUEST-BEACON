// BEACON — deterministic reference seed (E3·T-129; MIGRATION_PLAN §5). California (LIVE) + Romania
// (CACHED) regions, one SOURCE_RECORD per mode, one APP_USER per RBAC role, agency-seeded shelters.
// Fully deterministic (fixed demo UUIDs + a fixed fetched_at — no Date.now/randomness). Idempotent
// (ON CONFLICT DO NOTHING keyed by the demo UUIDs). Wired to `npm run db:seed`. Respects every DB
// invariant: shelter occupancy<=capacity; no ACTUAL alert seeded; source records carry provenance.
import { fileURLToPath } from 'node:url';
import type { Db } from './client';
import { getDb } from './client';
import { loadRegionRegistry } from './region-registry';
import { allShelters, loadShelterRegistry } from './shelter-registry';
import { shelterMapper } from './mappers';
import { appUser, region, shelter, sourceRecord } from './schema';

// Fixed, valid v4-shaped demo UUIDs (hex-only — the illustrative ids in MIGRATION_PLAN used non-hex
// placeholders like 's001'/'usr01'; here they are corrected to valid uuid text the DB will accept).
const fixedId = (suffix: string): string => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const FIXED_FETCHED_AT = new Date('2024-09-01T00:00:00.000Z'); // demo fixture: EMSR758 window (D-25)

const REGION_UUID: Record<string, string> = {
  'us-ca': fixedId('ca'),
  ro: fixedId('e0'),
};

type RegionRow = typeof region.$inferInsert;
type SourceRow = typeof sourceRecord.$inferInsert;
type UserRow = typeof appUser.$inferInsert;
type ShelterRow = typeof shelter.$inferInsert;

export interface SeedData {
  readonly regions: readonly RegionRow[];
  readonly sourceRecords: readonly SourceRow[];
  readonly appUsers: readonly UserRow[];
  readonly shelters: readonly ShelterRow[];
}

function buildRegionRows(): RegionRow[] {
  const registry = loadRegionRegistry();
  if (!registry.ok) throw registry.error;
  return registry.value.regions.map((lr, i) => ({
    id: REGION_UUID[lr.configId] ?? fixedId(`d${i}`),
    name: lr.region.name,
    scope: lr.region.scope,
    bbox: lr.region.bbox,
    enabledAdapters: [...lr.region.enabledAdapters],
    sourceModeOverrides: lr.sourceModeOverrides,
  }));
}

/**
 * Shelter rows from `config/shelters.json` — the agency list is editable DATA (FR-8, plan §0 user
 * directive: shelters editable via config or DB, no UI required). They used to be three literals in this
 * file, which meant "open another shelter" was a code change and a rebuild. The registry loader re-runs the
 * DOMAIN factory on every entry, so an impossible shelter fails the seed instead of reaching a row.
 */
function buildShelterRows(): ShelterRow[] {
  const registry = loadShelterRegistry();
  if (!registry.ok) throw registry.error;
  return allShelters(registry.value).map((s) => ({ id: s.id, ...shelterMapper.toRow(s) }));
}

/** Assemble the deterministic seed dataset (pure — no DB, no clock). Used by the seed test + runner. */
export function buildSeed(): SeedData {
  return {
    regions: buildRegionRows(),
    sourceRecords: [
      { id: fixedId('f01'), source: 'NASA FIRMS', adapter: 'firms-adapter', license: 'NASA open', mode: 'LIVE', fetchedAt: FIXED_FETCHED_AT },
      { id: fixedId('f02'), source: 'Copernicus GloFAS', adapter: 'glofas-adapter', license: 'Copernicus', mode: 'CACHED', fetchedAt: FIXED_FETCHED_AT },
      { id: fixedId('f03'), source: 'Copernicus EFFIS', adapter: 'effis-adapter', license: 'Copernicus', mode: 'CACHED', fetchedAt: FIXED_FETCHED_AT },
      { id: fixedId('f04'), source: 'MeteoAlarm (Romania)', adapter: 'meteoalarm-ro-adapter', license: 'EUMETNET MeteoAlarm', mode: 'CACHED', fetchedAt: FIXED_FETCHED_AT },
    ],
    appUsers: [
      { id: fixedId('a01'), role: 'PUBLIC' },
      { id: fixedId('a02'), role: 'RESPONDER', org: 'CAL FIRE' },
      { id: fixedId('a03'), role: 'VERIFIER', org: 'Cal OES' },
      { id: fixedId('a04'), role: 'EM', org: 'Cal OES EOC' },
    ],
    shelters: buildShelterRows(),
  };
}

/** Insert the seed dataset idempotently (ON CONFLICT DO NOTHING keyed by the fixed demo UUIDs). */
export async function seed(db: Db): Promise<SeedData> {
  const data = buildSeed();
  await db.insert(region).values([...data.regions]).onConflictDoNothing();
  await db.insert(sourceRecord).values([...data.sourceRecords]).onConflictDoNothing();
  await db.insert(appUser).values([...data.appUsers]).onConflictDoNothing();
  await db.insert(shelter).values([...data.shelters]).onConflictDoNothing();
  return data;
}

// Run when invoked directly via `npm run db:seed` (tsx). No-op on import (tests import buildSeed only).
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  seed(getDb())
    .then((d) => {
      process.stdout.write(
        `seeded ${d.regions.length} regions, ${d.sourceRecords.length} sources, ` +
          `${d.appUsers.length} users, ${d.shelters.length} shelters\n`,
      );
      process.exit(0);
    })
    .catch((e: unknown) => {
      process.stderr.write(`seed failed: ${String(e)}\n`);
      process.exit(1);
    });
}
