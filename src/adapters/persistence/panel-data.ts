// BEACON — Postgres adapter for the five OPERATOR-MAINTAINED dock-panel datasets (P16; ADR-041, V2·A12).
// Adapter layer (Art. II): satisfies `PanelDataPort` so `FEATURE_STORE=postgres` is a drop-in swap for the
// fixture readers in `routes/panels.ts` — NOT a rewrite of the panels (the ADR-039 posture, one tier up).
//
// DELIBERATELY THE DUMBEST ADAPTER IN THIS DIRECTORY. Five plain `SELECT *`s, five row mappers, one
// `lastEditedAt` reduction in TypeScript. No `where`, no `order by`, no join, no aggregate, no write and no
// `ON CONFLICT` — because the A2 all-lens review (2026-09-10) found three blocking defects that every unit
// test had missed, all of them in SQL that a chainable fake had only ever asserted the SHAPE of. The less
// this file asks the database to do, the less of it is unprovable outside the integration lane.
//
// THE ROWS ARE NOT TRUSTED HERE. Nothing below narrows a `text` column to a domain union: the closed
// vocabularies stay `string` all the way to `routes/panels.ts`, where the REAL domain factory — the same
// one the fixture rows go through — is the single place that decides whether an operator's value is legal.
// Mapping is therefore total and boring: rename, un-NULL, and turn `Date` into ISO-8601.
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { PointGeometry } from '@/domain/value-objects/geo.js';
import type {
  PanelDataPort,
  PanelDataset,
  PanelDamageEntryRow,
  PanelEmsProductRow,
  PanelShelterRow,
  PanelSupplyRow,
  PanelVolunteerTeamRow,
} from '@/ports/panels.js';
import type { Db } from './client';
import { tryResult } from './repository';
import {
  damageAssessmentEntry,
  emsOverlayProduct,
  shelter,
  supplyLot,
  volunteerTeam,
} from './schema';

const iso = (d: Date): string => d.toISOString();

/** `{ k: v }` when `v` is present, `{}` when the column is NULL — never `{ k: null }` (exactOptional…). */
function opt<K extends string, V>(key: K, value: V | null | undefined): Partial<Record<K, V>> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * Map rows and date the dataset by the NEWEST `updated_at` in it.
 *
 * That instant IS the `fetchedAt` of the `DB` provenance ref the panel will mint (ADR-041 §3): a row an EM
 * edited an hour ago is an hour old, and nothing here may substitute a clock read for that — which is also
 * why an empty table yields NO `lastEditedAt` at all rather than "now" (there is nothing to date).
 * The reduction is a plain string max over ISO-8601, which sorts lexicographically because every value is
 * UTC with the same `toISOString` shape; no SQL `max()`, so it is provable without a database.
 */
function datasetOf<Row extends { readonly updatedAt: Date }, R>(
  rows: readonly Row[],
  map: (row: Row) => R,
): PanelDataset<R> {
  const lastEditedAt = rows
    .map((r) => iso(r.updatedAt))
    .sort()
    .at(-1);
  return { rows: rows.map(map), ...opt('lastEditedAt', lastEditedAt) };
}

function supplyRow(r: typeof supplyLot.$inferSelect): PanelSupplyRow {
  return {
    id: r.domainId,
    ...opt('quantity', r.quantity),
    ...opt('unit', r.unit),
    ...opt('expiresAt', r.expiresAt === null ? null : iso(r.expiresAt)),
  };
}

function volunteerTeamRow(r: typeof volunteerTeam.$inferSelect): PanelVolunteerTeamRow {
  return {
    id: r.domainId,
    ...opt('callsign', r.callsign),
    ...opt('headcount', r.headcount),
    // `skills` is NOT NULL DEFAULT '[]' — the row genuinely has a value, so it is always passed on.
    skills: r.skills,
    ...opt('availability', r.availability),
  };
}

function shelterRow(r: typeof shelter.$inferSelect): PanelShelterRow {
  return {
    // The natural key when the row has one (migration 0010); the surrogate otherwise, because `shelter` is
    // the ONE panel table that predates 0010 and still holds rows seeded without a readable id.
    id: r.domainId ?? r.id,
    geom: r.geom as PointGeometry,
    // `capacity` is NULLABLE in the DDL while the domain requires a number. NULL means "nobody has counted
    // this building", and it hydrates to 0 — which makes the shelter INELIGIBLE for matching rather than a
    // destination with an invented headroom (the `shelterMapper.fromRow` rationale, Art. XVI).
    capacity: r.capacity ?? 0,
    occupancy: r.occupancy,
    ...opt('status', r.status),
    ...opt('orgId', r.org),
  };
}

function damageEntryRow(r: typeof damageAssessmentEntry.$inferSelect): PanelDamageEntryRow {
  return {
    id: r.domainId,
    incidentId: r.incidentDomainId,
    reportStatus: r.reportStatus,
    category: r.category,
    ...opt('severity', r.severity),
    ...opt('needKind', r.needKind),
    ...opt('siteCount', r.siteCount),
  };
}

function emsProductRow(r: typeof emsOverlayProduct.$inferSelect): PanelEmsProductRow {
  return {
    productId: r.domainId,
    activationCode: r.activationCode,
    productType: r.productType,
    areaOfInterest: r.areaOfInterest,
    producedAt: iso(r.producedAt),
    provider: r.provider,
    licence: r.licence,
    viewUrl: r.viewUrl,
  };
}

/**
 * The Postgres panel-data port. Every read is wrapped in `tryResult`, so a store that is configured but
 * unreachable hands the caller an `err` to label and degrade from instead of an exception that would empty
 * a shelter board (Art. XVI — an empty board and a board with no shelters mean opposite things).
 */
export function makePgPanelDataPort(db: Db): PanelDataPort {
  return {
    supplies: (): Promise<Result<PanelDataset<PanelSupplyRow>, DomainError>> =>
      tryResult(async () => datasetOf(await db.select().from(supplyLot), supplyRow)),
    volunteerTeams: (): Promise<Result<PanelDataset<PanelVolunteerTeamRow>, DomainError>> =>
      tryResult(async () => datasetOf(await db.select().from(volunteerTeam), volunteerTeamRow)),
    shelters: (): Promise<Result<PanelDataset<PanelShelterRow>, DomainError>> =>
      tryResult(async () => datasetOf(await db.select().from(shelter), shelterRow)),
    damageEntries: (): Promise<Result<PanelDataset<PanelDamageEntryRow>, DomainError>> =>
      tryResult(async () =>
        datasetOf(await db.select().from(damageAssessmentEntry), damageEntryRow),
      ),
    emsProducts: (): Promise<Result<PanelDataset<PanelEmsProductRow>, DomainError>> =>
      tryResult(async () => datasetOf(await db.select().from(emsOverlayProduct), emsProductRow)),
  };
}
