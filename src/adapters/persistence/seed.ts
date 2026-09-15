// BEACON — deterministic reference seed (E3·T-129; MIGRATION_PLAN §5). California (LIVE) + Romania
// (CACHED) regions, one SOURCE_RECORD per mode, one APP_USER per RBAC role, agency-seeded shelters.
// Fully deterministic (fixed demo UUIDs + a fixed fetched_at — no Date.now/randomness). Idempotent
// (ON CONFLICT DO NOTHING keyed by the demo UUIDs). Wired to `npm run db:seed`. Respects every DB
// invariant: shelter occupancy<=capacity; no ACTUAL alert seeded; source records carry provenance.
import { createHash } from 'node:crypto';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { fileURLToPath } from 'node:url';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from './client';
import { getDb } from './client';
import { loadRegionRegistry } from './region-registry';
import { allShelters, loadShelterRegistry } from './shelter-registry';
import { shelterMapper } from './mappers';
import { loadReferenceRegistry } from './reference-registry';
import type { ReferenceRegistry } from './reference-registry';
import {
  appUser,
  citation,
  damageAssessmentEntry,
  emsOverlayProduct,
  gauge,
  hazardGeometry,
  incident,
  infrastructureNode,
  prediction,
  publicReport,
  region,
  resource,
  resourceTask,
  shelter,
  sourceRecord,
  supplyLot,
  thresholdRule,
  volunteerTeam,
} from './schema';

// Fixed, valid v4-shaped demo UUIDs (hex-only — the illustrative ids in MIGRATION_PLAN used non-hex
// placeholders like 's001'/'usr01'; here they are corrected to valid uuid text the DB will accept).
const fixedId = (suffix: string): string => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const FIXED_FETCHED_AT = new Date('2024-09-01T00:00:00.000Z'); // demo fixture: EMSR758 window (D-25)

const REGION_UUID: Record<string, string> = {
  'us-ca': fixedId('ca'),
  ro: fixedId('e0'),
  es: fixedId('d2'),
  gr: fixedId('d3'),
  ph: fixedId('d4'),
};

type RegionRow = typeof region.$inferInsert;
type SourceRow = typeof sourceRecord.$inferInsert;
type UserRow = typeof appUser.$inferInsert;
type ShelterRow = typeof shelter.$inferInsert;
type SupplyLotRow = typeof supplyLot.$inferInsert;
type VolunteerTeamRow = typeof volunteerTeam.$inferInsert;
type DamageEntryRow = typeof damageAssessmentEntry.$inferInsert;
type EmsProductRow = typeof emsOverlayProduct.$inferInsert;
type IncidentRow = typeof incident.$inferInsert;
type ResourceRow = typeof resource.$inferInsert;
type ResourceTaskRow = typeof resourceTask.$inferInsert;
type PublicReportRow = typeof publicReport.$inferInsert;
type ThresholdRuleRow = typeof thresholdRule.$inferInsert;

export interface SeedData {
  readonly regions: readonly RegionRow[];
  readonly sourceRecords: readonly SourceRow[];
  readonly appUsers: readonly UserRow[];
  readonly shelters: readonly ShelterRow[];
  readonly supplyLots: readonly SupplyLotRow[];
  readonly volunteerTeams: readonly VolunteerTeamRow[];
  readonly damageEntries: readonly DamageEntryRow[];
  readonly emsProducts: readonly EmsProductRow[];
  readonly incidents: readonly IncidentRow[];
  readonly resources: readonly ResourceRow[];
  readonly resourceTasks: readonly ResourceTaskRow[];
  readonly publicReports: readonly PublicReportRow[];
  readonly thresholdRules: readonly ThresholdRuleRow[];
}

/**
 * The surrogate uuid for a domain id, derived rather than allocated.
 *
 * These five tables have uuid primary keys and (except `incident`) no natural-key column to conflict on,
 * so a re-run needs the SAME uuid for the same row or the seed would duplicate everything it wrote last
 * time. A UUIDv5-shaped digest of `namespace:domain_id` gives exactly that: stable across runs, across
 * machines and across databases, with no allocation table to keep and nothing to drift.
 *
 * `incident` gets its uuid the same way, which has a second benefit — the id a foreign key stores is
 * reproducible from the domain id alone, so a task written by this seed and a task written by the running
 * product point at the same incident row.
 */
function stableUuid(namespace: string, domainId: string): string {
  const hex = createHash('sha1').update(`beacon:${namespace}:${domainId}`).digest('hex');
  const v4ish = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return v4ish;
}

/**
 * The stable uuid for a config region id. One lookup, shared by the region rows and every region-scoped
 * panel row, so a supply lot can never be attached to a region the seed did not also create.
 */
function regionUuid(configId: string, what: string): string {
  const id = REGION_UUID[configId];
  if (id === undefined) {
    throw new Error(
      `seed.ts: ${what} names region '${configId}', which has no stable REGION_UUID mapping`,
    );
  }
  return id;
}

/** The region rows, with a stable UUID pinned for every shipped region id in config/regions.json. */
function buildRegionRows(): RegionRow[] {
  const registry = loadRegionRegistry();
  if (!registry.ok) throw registry.error;
  return registry.value.regions.map((lr) => {
    const id = regionUuid(lr.configId, 'config/regions.json');
    return {
      id,
      // The CONFIG id (`us-ca`) travels with the row (migration 0009). The uuid above stays the surrogate the
      // FKs use, but it is no longer the only handle: resolution now goes through this column, so adding a
      // region to config/regions.json can never again shuffle which uuid a later region owns.
      domainId: lr.configId,
      name: lr.region.name,
      scope: lr.region.scope,
      bbox: lr.region.bbox,
      enabledAdapters: [...lr.region.enabledAdapters],
      sourceModeOverrides: lr.sourceModeOverrides,
    };
  });
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

/**
 * The four DOCK-PANEL tables (ADR-041), from `config/reference-data.json`.
 *
 * `panels.ts` reads these for its `DB` rung and falls back to a built-in fixture whenever a table is empty.
 * Nothing in the codebase had ever written them, so every deployment served the identical fixture in every
 * region — the "Logistics and SitRep are always the same" report. This gives the store a starting state an
 * emergency manager then edits in Directus.
 *
 * REGION SCOPE IS RESOLVED, NEVER GUESSED: a row naming a region the seed does not create fails the run,
 * rather than landing with a NULL scope that an operator would read as a fact about their own region.
 */
function buildPanelRows(
  registry: ReferenceRegistry,
): Pick<SeedData, 'supplyLots' | 'volunteerTeams' | 'damageEntries' | 'emsProducts'> {
  return {
    supplyLots: registry.supplyLots.map((r) => ({
      domainId: r.domainId,
      regionId: regionUuid(r.regionConfigId, `supply_lots[${r.domainId}]`),
      quantity: r.quantity,
      unit: r.unit,
      ...(r.expiresAt === undefined ? {} : { expiresAt: r.expiresAt }),
    })),
    volunteerTeams: registry.volunteerTeams.map((r) => ({
      domainId: r.domainId,
      regionId: regionUuid(r.regionConfigId, `volunteer_teams[${r.domainId}]`),
      callsign: r.callsign,
      headcount: r.headcount,
      skills: [...r.skills],
      availability: r.availability,
    })),
    // No region scope: `damage_assessment_entry` is keyed to an INCIDENT by domain id (deliberately not a
    // uuid FK — a live incident often has no `incident` row), and the incident already carries the region.
    damageEntries: registry.damageEntries.map((r) => ({
      domainId: r.domainId,
      incidentDomainId: r.incidentDomainId,
      reportStatus: r.reportStatus,
      category: r.category,
      ...(r.severity === undefined ? {} : { severity: r.severity }),
      ...(r.needKind === undefined ? {} : { needKind: r.needKind }),
      ...(r.siteCount === undefined ? {} : { siteCount: r.siteCount }),
    })),
    emsProducts: registry.emsProducts.map((r) => ({
      domainId: r.domainId,
      regionId: regionUuid(r.regionConfigId, `ems_overlay_products[${r.domainId}]`),
      activationCode: r.activationCode,
      productType: r.productType,
      areaOfInterest: r.areaOfInterest,
      producedAt: r.producedAt,
      provider: r.provider,
      licence: r.licence,
      viewUrl: r.viewUrl,
    })),
  };
}

/**
 * The five tables nothing had ever written (2026-09-12), from `config/reference-data.json`.
 *
 * `incident` is the one that was not merely empty but LOAD-BEARING while empty: `resolveIncidentRowId`
 * translates a domain id to the surrogate uuid every FK uses, and with no row it returns null — so
 * `evac-route-store` and every other incident-keyed store discarded what it was asked to persist, silently.
 * The other four back the Logistics tab, the verification queue and the threshold engine, each of which
 * was demonstrating a built-in fixture because the store it reads had nothing in it.
 */
function buildOperationalRows(
  registry: ReferenceRegistry,
): Pick<
  SeedData,
  'incidents' | 'resources' | 'resourceTasks' | 'publicReports' | 'thresholdRules'
> {
  return {
    incidents: registry.incidents.map((r) => ({
      id: stableUuid('incident', r.domainId),
      domainId: r.domainId,
      regionId: regionUuid(r.regionConfigId, `incidents[${r.domainId}]`),
      type: r.type,
      status: r.status,
    })),
    resources: registry.resources.map((r) => ({
      id: stableUuid('resource', r.domainId),
      kind: r.kind,
      status: r.status,
      ...(r.org === undefined ? {} : { org: r.org }),
      ...(r.lon === undefined || r.lat === undefined
        ? {}
        : { geom: { type: 'Point' as const, coordinates: [r.lon, r.lat] as [number, number] } }),
    })),
    resourceTasks: registry.resourceTasks.map((r) => ({
      id: stableUuid('resource_task', r.domainId),
      resourceId: stableUuid('resource', r.resourceDomainId),
      incidentId: stableUuid('incident', r.incidentDomainId),
      status: r.status,
    })),
    publicReports: registry.publicReports.map((r) => ({
      id: stableUuid('public_report', r.domainId),
      incidentId: stableUuid('incident', r.incidentDomainId),
      source: r.source,
      category: r.category,
      status: r.status,
      reportText: r.text,
      // Consent is TRUE on every seeded row and the table's own CHECK constraint requires it. These are
      // reports this project authored to demonstrate the queue, not a stranger's words stored on their
      // behalf — the distinction is the whole of RESPONSIBLE_DATA.md and it is stated in the config's
      // `_provenance` block too.
      consent: true,
      purgeAfter: r.purgeAfter,
      ...(r.confidence === undefined ? {} : { confidence: r.confidence }),
      ...(r.receivedAt === undefined ? {} : { receivedAt: r.receivedAt.toISOString() }),
      // GENERALIZED ONLY. `geom_precise` is deliberately never seeded: it is the responder-only column
      // (Art. XIV), and a demonstration report has no precise location to protect because it has no real
      // person behind it.
      ...(r.lon === undefined || r.lat === undefined
        ? {}
        : {
            geomGeneralized: {
              type: 'Point' as const,
              coordinates: [r.lon, r.lat] as [number, number],
            },
          }),
    })),
    thresholdRules: registry.thresholdRules.map((r) => ({
      id: stableUuid('threshold_rule', r.domainId),
      target: r.target,
      operator: r.operator,
      value: r.value,
      scope: regionUuid(r.regionConfigId, `threshold_rules[${r.domainId}]`),
      ...(r.hysteresis === undefined ? {} : { hysteresis: String(r.hysteresis) }),
      ...(r.cooldown === undefined ? {} : { cooldown: String(r.cooldown) }),
    })),
  };
}

/**
 * The display names the four demo `source_record` rows carried before 2026-09-13, by the adapter id
 * that now keys them. A fresh database never sees these; an existing one still holds them under the
 * same fixed uuids, and `INSERT … ON CONFLICT DO NOTHING` would leave them exactly as they are — beside
 * the runtime rows the provenance mirror mints — for ever (review, PR #29).
 */
export const LEGACY_SOURCE_NAMES: Readonly<Record<string, string>> = {
  firms: 'NASA FIRMS',
  glofas: 'Copernicus GloFAS',
  effis: 'Copernicus EFFIS',
  'meteoalarm-ro': 'MeteoAlarm (Romania)',
};

export type LegacySourceStep =
  | {
      readonly kind: 'rename';
      readonly id: string;
      readonly from: string;
      readonly to: string;
      readonly adapter: string;
    }
  | { readonly kind: 'delete'; readonly id: string; readonly from: string; readonly to: string };

/**
 * Plan the upgrade of legacy rows (pure). For each seed row whose adapter id replaced a display name:
 * if the mirror has ALREADY minted a row under the adapter id, the legacy row is redundant and goes;
 * otherwise it is renamed in place so every citation that points at its uuid keeps resolving.
 * `existingSources` is the set of `source` values currently in the table.
 */
export function planLegacySourceUpgrade(
  rows: readonly SourceRow[],
  existingSources: ReadonlySet<string>,
): readonly LegacySourceStep[] {
  const steps: LegacySourceStep[] = [];
  for (const row of rows) {
    const from = LEGACY_SOURCE_NAMES[row.source];
    const id = row.id;
    if (from === undefined || id === undefined || !existingSources.has(from)) continue; // nothing legacy here
    if (existingSources.has(row.source)) steps.push({ kind: 'delete', id, from, to: row.source });
    else steps.push({ kind: 'rename', id, from, to: row.source, adapter: row.adapter });
  }
  return steps;
}

/** Postgres `unique_violation` — the live provenance sink minted the adapter-keyed row between our steps. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { readonly code?: unknown }).code === '23505';
}

/**
 * Apply a legacy-row plan. The plan says WHICH rows are legacy; the ACTION is decided again inside a
 * transaction, against the row set as it is at that moment, because the live provenance sink can mint the
 * adapter-keyed row between planning and applying (review, PR #29). A delete first REPOINTS every row
 * that references the legacy uuid — `citation.source_id` is ON DELETE RESTRICT, the five others are
 * SET NULL, and either outcome would be wrong: a citation is what makes a SitRep field auditable, and a
 * hazard row's provenance is not something a seed may quietly null out — then deletes. All in one
 * transaction so a failure leaves the database exactly as it was. Should the sink still win the race
 * between our existence check and the rename's commit, the unique violation is caught once and the step
 * is re-run — which now takes the repoint-and-delete path.
 */
async function upgradeLegacySourceRows(db: Db, rows: readonly SourceRow[]): Promise<void> {
  const existing = await db.select({ source: sourceRecord.source }).from(sourceRecord);
  for (const step of planLegacySourceUpgrade(rows, new Set(existing.map((r) => r.source)))) {
    try {
      await applyLegacyStep(db, step);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      await applyLegacyStep(db, step); // the target appeared concurrently: this pass repoints and deletes
    }
  }
}

async function applyLegacyStep(db: Db, step: LegacySourceStep): Promise<void> {
  const to = step.kind === 'rename' ? step.to : step.to;
  await db.transaction(async (tx) => {
    const legacyRow = and(eq(sourceRecord.id, step.id), eq(sourceRecord.source, step.from));
    const [target] = await tx
      .select({ id: sourceRecord.id })
      .from(sourceRecord)
      .where(eq(sourceRecord.source, to))
      .limit(1);
    if (target === undefined) {
      const adapter = step.kind === 'rename' ? step.adapter : `${to}-adapter`;
      await tx.update(sourceRecord).set({ source: to, adapter }).where(legacyRow);
      return;
    }
    const sourceId = target.id;
    await tx.update(citation).set({ sourceId }).where(eq(citation.sourceId, step.id));
    await tx.update(publicReport).set({ sourceId }).where(eq(publicReport.sourceId, step.id));
    await tx.update(hazardGeometry).set({ sourceId }).where(eq(hazardGeometry.sourceId, step.id));
    await tx.update(gauge).set({ sourceId }).where(eq(gauge.sourceId, step.id));
    await tx
      .update(infrastructureNode)
      .set({ sourceId })
      .where(eq(infrastructureNode.sourceId, step.id));
    await tx.update(prediction).set({ sourceId }).where(eq(prediction.sourceId, step.id));
    await tx.delete(sourceRecord).where(legacyRow);
  });
}

/**
 * Point region-keyed rows at the uuid a region ACTUALLY has (pure). `remap` is pinned-uuid → actual uuid
 * and is empty on a fresh database, in which case every row comes back untouched — the same object.
 */
export function remapRegionIds<T extends { readonly regionId?: string | null | undefined }>(
  rows: readonly T[],
  remap: ReadonlyMap<string, string>,
): T[] {
  return rows.map((row) => {
    const actual = typeof row.regionId === 'string' ? remap.get(row.regionId) : undefined;
    return actual === undefined ? row : { ...row, regionId: actual };
  });
}

/** Assemble the deterministic seed dataset (pure — no DB, no clock). Used by the seed test + runner. */
export function buildSeed(): SeedData {
  const regions = buildRegionRows();
  const loaded = loadReferenceRegistry();
  // FATAL, not fail-open. A seed is the one place where "carry on with less" produces a database that
  // looks populated and is quietly wrong.
  if (!loaded.ok) throw loaded.error;
  const reference = loaded.value;
  return {
    regions,
    // `source` is the table's NATURAL KEY and the live provenance mirror (ADR-039) upserts on it by ADAPTER
    // id. Until 2026-09-13 these rows were keyed by display name ('Copernicus GloFAS'), so the mirror could
    // never replace them: the live deployment listed a 2024 "CACHED" GloFAS beside the real one for ever.
    sourceRecords: [
      {
        id: fixedId('f01'),
        source: 'firms',
        adapter: 'firms-adapter',
        license: 'NASA open',
        mode: 'LIVE',
        fetchedAt: FIXED_FETCHED_AT,
      },
      {
        id: fixedId('f02'),
        source: 'glofas',
        adapter: 'glofas-adapter',
        license: 'Copernicus',
        mode: 'CACHED',
        fetchedAt: FIXED_FETCHED_AT,
      },
      {
        id: fixedId('f03'),
        source: 'effis',
        adapter: 'effis-adapter',
        license: 'Copernicus',
        mode: 'CACHED',
        fetchedAt: FIXED_FETCHED_AT,
      },
      {
        id: fixedId('f04'),
        source: 'meteoalarm-ro',
        adapter: 'meteoalarm-ro-adapter',
        license: 'EUMETNET MeteoAlarm',
        mode: 'CACHED',
        fetchedAt: FIXED_FETCHED_AT,
      },
    ],
    appUsers: [
      { id: fixedId('a01'), role: 'PUBLIC' },
      { id: fixedId('a02'), role: 'RESPONDER', org: 'CAL FIRE' },
      { id: fixedId('a03'), role: 'VERIFIER', org: 'Cal OES' },
      { id: fixedId('a04'), role: 'EM', org: 'Cal OES EOC' },
    ],
    shelters: buildShelterRows(),
    ...buildPanelRows(reference),
    ...buildOperationalRows(reference),
  };
}

/** Insert the seed dataset idempotently (ON CONFLICT DO NOTHING keyed by the fixed demo UUIDs). */
/**
 * Insert with do-nothing-on-conflict, SKIPPING an empty list. Drizzle throws `values() must be called with
 * at least one value` on an empty array, and one empty reference list (the EMS overlay products, none
 * shipped today) aborted the whole seed after the region rows on every run — the live database stayed
 * without its roster, shelters, rules and accounts through three redeploys with the pre-deploy command
 * set, and the only trace was that one line in the deploy log (2026-09-14).
 */
export async function insertRows<T extends PgTable>(
  db: Db,
  table: T,
  rows: readonly T['$inferInsert'][],
  target?: { readonly target: PgColumn },
): Promise<void> {
  if (rows.length === 0) return;
  const q = db.insert(table).values([...rows] as T['$inferInsert'][]);
  await (target === undefined ? q.onConflictDoNothing() : q.onConflictDoNothing(target));
}

export async function seed(db: Db): Promise<SeedData> {
  const data = buildSeed();
  // REGION IS AN UPSERT, NOT DO-NOTHING (Copilot review, PR #10, 2026-09-11).
  //
  // Migration 0009 adds `region.domain_id` as a NULLABLE column and its comment says the seed backfills it.
  // It did not. On a database that already had region rows — which is every deployment that existed before
  // 0009, including the live one — the insert conflicted on the fixed UUID and did nothing, so `domain_id`
  // stayed NULL forever. `resolveRegionRowId('us-ca')` then returns null and the incident and SitRep
  // mirrors SKIP EVERY ROW, silently: no error, no log, just a database that quietly stops being filled.
  //
  // It passed unnoticed because a fresh database inserts the column with the rest of the row, so every
  // test, every CI run and every clean docker-compose is correct. Only an UPGRADE is broken, which is the
  // one path no automated test here exercises.
  //
  // Only `domain_id` is written on conflict. The rest of a region row is operator-editable through the
  // admin UI (ADR-041), and a seed run must not revert a duty officer's edits to re-assert defaults.
  // TWO STEPS, BECAUSE `region` HAS TWO UNIQUE KEYS (live failure, 2026-09-12).
  //
  // `ON CONFLICT (id) DO UPDATE` cannot absorb a conflict on `uq_region_domain_id`, and on any database
  // that predates the pinned REGION_UUID table above, Spain/Greece/Philippines already exist under
  // DIFFERENT uuids — the positional assignment this file used to do reshuffled them whenever
  // config/regions.json grew. The insert then violated the domain_id unique constraint and the whole seed
  // aborted before it wrote anything at all.
  //
  // Step 1 backfills the natural key on a pre-0009 row that matches by surrogate id. Step 2 inserts with
  // NO conflict target, which covers EVERY unique constraint — the primary key and the natural key both —
  // so a region that already exists under any identity is left exactly as it is. That is the right
  // outcome: every FK in the database (incident, supply_lot, ems_overlay_product) points at the id the
  // row already has, and re-pointing them to satisfy a seed would be far worse than an unchanged row.
  for (const r of data.regions) {
    await db
      .update(region)
      .set({ domainId: r.domainId })
      .where(and(eq(region.id, r.id!), isNull(region.domainId)));
    // STEP 1b — A PRE-0009 ROW UNDER A DIFFERENT UUID (review, PR #29). On a database older than the pinned
    // REGION_UUID table, Spain/Greece/Philippines exist under the uuids the old positional assignment gave
    // them, with `domain_id` NULL. Step 1 cannot see them (the surrogate differs) and step 2 would then
    // INSERT the pinned row beside them — two Spains, with the old one holding every FK written so far and
    // the new one receiving everything resolved through `domain_id` from now on: a split database. So a
    // row that carries the config's NAME and no domain id yet is claimed by name — the oldest such row,
    // exactly one — and keeps its uuid; the remap below then points every seeded FK at it.
    await db
      .update(region)
      .set({ domainId: r.domainId })
      .where(
        and(
          isNull(region.domainId),
          sql`not exists (select 1 from region where domain_id = ${r.domainId})`,
          eq(
            region.id,
            sql`(select id from region where name = ${r.name} and domain_id is null order by created_at asc limit 1)`,
          ),
        ),
      );
  }
  await insertRows(db, region, [...data.regions]);
  // THE UUID A REGION ACTUALLY HAS, not the one the seed pinned. Identical on a fresh database; different
  // exactly when step 1b just claimed a legacy row. Every region-keyed row below is pointed at the real one.
  const actualRegions = await db.select({ id: region.id, domainId: region.domainId }).from(region);
  const byDomain = new Map(
    actualRegions.flatMap((r) => (r.domainId === null ? [] : [[r.domainId, r.id] as const])),
  );
  const regionRemap = new Map(
    data.regions.flatMap((r) => {
      const actual = byDomain.get(r.domainId!);
      return actual === undefined || actual === r.id ? [] : [[r.id!, actual] as const];
    }),
  );
  const supplyLots = remapRegionIds(data.supplyLots, regionRemap);
  const volunteerTeams = remapRegionIds(data.volunteerTeams, regionRemap);
  const emsProducts = remapRegionIds(data.emsProducts, regionRemap);
  const incidents = remapRegionIds(data.incidents, regionRemap);
  await upgradeLegacySourceRows(db, data.sourceRecords);
  await insertRows(db, sourceRecord, [...data.sourceRecords]);
  await insertRows(db, appUser, [...data.appUsers]);
  await insertRows(db, shelter, [...data.shelters]);
  // The four dock-panel tables (ADR-041). Conflict target is the NATURAL key each carries, not the
  // surrogate uuid: these rows are inserted with a generated id, so `domain_id` is the only thing that
  // makes a re-run a no-op — and it is also what protects an EM's in-place edits from a later seed.
  await insertRows(db, supplyLot, supplyLots, { target: supplyLot.domainId });
  await insertRows(db, volunteerTeam, volunteerTeams, { target: volunteerTeam.domainId });
  await insertRows(db, damageAssessmentEntry, [...data.damageEntries], {
    target: damageAssessmentEntry.domainId,
  });
  await insertRows(db, emsOverlayProduct, emsProducts, { target: emsOverlayProduct.domainId });
  // The operational tables, in FOREIGN-KEY ORDER: an incident before the tasks and reports that name it,
  // a resource before the task that dispatches it. Every id is derived from its domain id (`stableUuid`),
  // so a re-run conflicts on the primary key and changes nothing — including nothing an operator has
  // edited since. `incident` additionally carries the natural key the rest of the product resolves by.
  await insertRows(db, incident, incidents);
  await insertRows(db, resource, [...data.resources]);
  await insertRows(db, resourceTask, [...data.resourceTasks]);
  await insertRows(db, publicReport, [...data.publicReports]);
  await insertRows(db, thresholdRule, [...data.thresholdRules]);
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
          `${d.appUsers.length} users, ${d.shelters.length} shelters, ` +
          `${d.supplyLots.length} supply lots, ${d.volunteerTeams.length} volunteer teams, ` +
          `${d.damageEntries.length} damage entries, ${d.emsProducts.length} EMS products, ` +
          `${d.incidents.length} incidents, ${d.resources.length} resources, ` +
          `${d.resourceTasks.length} tasks, ${d.publicReports.length} reports, ` +
          `${d.thresholdRules.length} threshold rules\n`,
      );
      process.exit(0);
    })
    .catch((e: unknown) => {
      // `String(e)` prints the driver's "Failed query: …" wrapper and DROPS the Postgres error underneath
      // it — the constraint name, the SQLSTATE and the detail line, which are the only parts that say what
      // actually went wrong. A seed that fails without naming the constraint costs an hour of guessing.
      const cause: unknown = e instanceof Error ? e.cause : undefined;
      const pg = cause as
        { code?: string; constraint?: string; detail?: string; message?: string } | undefined;
      const extra =
        pg === undefined
          ? ''
          : `\n  cause: ${pg.message ?? ''}` +
            `${pg.code === undefined ? '' : `\n  sqlstate: ${pg.code}`}` +
            `${pg.constraint === undefined ? '' : `\n  constraint: ${pg.constraint}`}` +
            `${pg.detail === undefined ? '' : `\n  detail: ${pg.detail}`}`;
      process.stderr.write(`seed failed: ${String(e)}${extra}\n`);
      process.exit(1);
    });
}
