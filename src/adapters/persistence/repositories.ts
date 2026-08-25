// BEACON — concrete Drizzle repositories (E3·T-116…T-121). Each aggregate gets a RepositoryPort
// built from typed persistence closures; provenance/geometry round-trip through the ACL mappers.
// Failure never throws upstream — makeRepository wraps every op in a typed Result (repository.ts).
import { and, eq } from 'drizzle-orm';
import type { RepositoryPort } from '@/ports/infra.js';
import type { Result } from '@/domain/shared/result.js';
import type {
  Alert,
  AlertId,
  Citation,
  CitationId,
  Exposure,
  HazardGeometry,
  HazardGeometryId,
  Incident,
  IncidentId,
  Region,
  RegionId,
  SourceId,
  SourceRecord,
  ThresholdRule,
  ThresholdRuleId,
} from '@/domain/index.js';
import type { DomainError } from '@/domain/errors.js';
import { DomainError as DomainErrorClass } from '@/domain/errors.js';
import type { Db } from './client';
import { makeRepository, tryResult } from './repository';
import {
  alertMapper,
  citationMapper,
  exposureMapper,
  hazardGeometryMapper,
  incidentMapper,
  regionMapper,
  sourceRecordMapper,
  thresholdRuleMapper,
} from './mappers';
import {
  alert,
  citation,
  exposure,
  hazardGeometry,
  incident,
  region,
  sourceRecord,
  thresholdRule,
} from './schema';

/** `.returning()` yields ≥1 row on an upsert; guard so the mapper never receives undefined. */
function firstRow<R>(rows: R[], what: string): R {
  const row = rows[0];
  if (row === undefined) throw new DomainErrorClass('PARSE_ERROR', `${what} returned no row`);
  return row;
}

// ---- INCIDENT (T-116) --------------------------------------------------------------------------
export const makeIncidentRepository = (db: Db): RepositoryPort<Incident, IncidentId> =>
  makeRepository<Incident, IncidentId>({
    getById: async (id) => {
      const [row] = await db.select().from(incident).where(eq(incident.id, id)).limit(1);
      return row ? incidentMapper.fromRow(row) : null;
    },
    upsert: async (e) => {
      const values = incidentMapper.toRow(e);
      const rows = await db
        .insert(incident)
        .values(values)
        .onConflictDoUpdate({ target: incident.id, set: values })
        .returning();
      return incidentMapper.fromRow(firstRow(rows, 'incident.upsert'));
    },
    remove: async (id) => {
      await db.delete(incident).where(eq(incident.id, id));
    },
    list: async () => (await db.select().from(incident)).map(incidentMapper.fromRow),
  });

// ---- HAZARD_GEOMETRY (T-117) — save + findByIncident round-trips GeoJSON ------------------------
export interface HazardGeometryRepository extends RepositoryPort<HazardGeometry, HazardGeometryId> {
  findByIncident(incidentId: IncidentId): Promise<Result<readonly HazardGeometry[], DomainError>>;
}

export function makeHazardGeometryRepository(db: Db): HazardGeometryRepository {
  const base = makeRepository<HazardGeometry, HazardGeometryId>({
    getById: async (id) => {
      const [row] = await db.select().from(hazardGeometry).where(eq(hazardGeometry.id, id)).limit(1);
      return row ? hazardGeometryMapper.fromRow(row) : null;
    },
    upsert: async (e) => {
      const values = hazardGeometryMapper.toRow(e);
      const rows = await db
        .insert(hazardGeometry)
        .values(values)
        .onConflictDoUpdate({ target: hazardGeometry.id, set: values })
        .returning();
      return hazardGeometryMapper.fromRow(firstRow(rows, 'hazard_geometry.upsert'));
    },
    remove: async (id) => {
      await db.delete(hazardGeometry).where(eq(hazardGeometry.id, id));
    },
    list: async () => (await db.select().from(hazardGeometry)).map(hazardGeometryMapper.fromRow),
  });
  return {
    ...base,
    findByIncident: (incidentId) =>
      tryResult(async () =>
        (
          await db.select().from(hazardGeometry).where(eq(hazardGeometry.incidentId, incidentId))
        ).map(hazardGeometryMapper.fromRow),
      ),
  };
}

// ---- SOURCE_RECORD (T-118) — provenance anchor -------------------------------------------------
export const makeSourceRecordRepository = (db: Db): RepositoryPort<SourceRecord, SourceId> =>
  makeRepository<SourceRecord, SourceId>({
    getById: async (id) => {
      const [row] = await db.select().from(sourceRecord).where(eq(sourceRecord.id, id)).limit(1);
      return row ? sourceRecordMapper.fromRow(row) : null;
    },
    upsert: async (e) => {
      const values = sourceRecordMapper.toRow(e);
      const rows = await db
        .insert(sourceRecord)
        .values(values)
        .onConflictDoUpdate({ target: sourceRecord.id, set: values })
        .returning();
      return sourceRecordMapper.fromRow(firstRow(rows, 'source_record.upsert'));
    },
    remove: async (id) => {
      await db.delete(sourceRecord).where(eq(sourceRecord.id, id));
    },
    list: async () => (await db.select().from(sourceRecord)).map(sourceRecordMapper.fromRow),
  });

// ---- CITATION (T-118) — FK to source_record is RESTRICT-enforced at the DB ----------------------
export const makeCitationRepository = (db: Db): RepositoryPort<Citation, CitationId> =>
  makeRepository<Citation, CitationId>({
    getById: async (id) => {
      const [row] = await db.select().from(citation).where(eq(citation.id, id)).limit(1);
      return row ? citationMapper.fromRow(row) : null;
    },
    upsert: async (e) => {
      const values = citationMapper.toRow(e);
      const rows = await db
        .insert(citation)
        .values(values)
        .onConflictDoUpdate({ target: citation.id, set: values })
        .returning();
      return citationMapper.fromRow(firstRow(rows, 'citation.upsert'));
    },
    remove: async (id) => {
      await db.delete(citation).where(eq(citation.id, id));
    },
    list: async () => (await db.select().from(citation)).map(citationMapper.fromRow),
  });

// ---- ALERT (T-120) — DB rejects an ACTUAL alert without approved_by ----------------------------
export const makeAlertRepository = (db: Db): RepositoryPort<Alert, AlertId> =>
  makeRepository<Alert, AlertId>({
    getById: async (id) => {
      const [row] = await db.select().from(alert).where(eq(alert.id, id)).limit(1);
      return row ? alertMapper.fromRow(row) : null;
    },
    upsert: async (e) => {
      const values = alertMapper.toRow(e);
      const rows = await db
        .insert(alert)
        .values(values)
        .onConflictDoUpdate({ target: alert.id, set: values })
        .returning();
      return alertMapper.fromRow(firstRow(rows, 'alert.upsert'));
    },
    remove: async (id) => {
      await db.delete(alert).where(eq(alert.id, id));
    },
    list: async () => (await db.select().from(alert)).map(alertMapper.fromRow),
  });

// ---- REGION (T-121) --------------------------------------------------------------------------
export const makeRegionRepository = (db: Db): RepositoryPort<Region, RegionId> =>
  makeRepository<Region, RegionId>({
    getById: async (id) => {
      const [row] = await db.select().from(region).where(eq(region.id, id)).limit(1);
      return row ? regionMapper.fromRow(row) : null;
    },
    upsert: async (e) => {
      const values = regionMapper.toRow(e);
      const rows = await db
        .insert(region)
        .values(values)
        .onConflictDoUpdate({ target: region.id, set: values })
        .returning();
      return regionMapper.fromRow(firstRow(rows, 'region.upsert'));
    },
    remove: async (id) => {
      await db.delete(region).where(eq(region.id, id));
    },
    list: async () => (await db.select().from(region)).map(regionMapper.fromRow),
  });

// ---- THRESHOLD_RULE (T-121) — includes a rules-by-scope query ----------------------------------
export interface ThresholdRuleFilter {
  readonly scope?: RegionId;
}

export function makeThresholdRuleRepository(
  db: Db,
): RepositoryPort<ThresholdRule, ThresholdRuleId> {
  return makeRepository<ThresholdRule, ThresholdRuleId>({
    getById: async (id) => {
      const [row] = await db.select().from(thresholdRule).where(eq(thresholdRule.id, id)).limit(1);
      return row ? thresholdRuleMapper.fromRow(row) : null;
    },
    upsert: async (e) => {
      const values = thresholdRuleMapper.toRow(e);
      const rows = await db
        .insert(thresholdRule)
        .values(values)
        .onConflictDoUpdate({ target: thresholdRule.id, set: values })
        .returning();
      return thresholdRuleMapper.fromRow(firstRow(rows, 'threshold_rule.upsert'));
    },
    remove: async (id) => {
      await db.delete(thresholdRule).where(eq(thresholdRule.id, id));
    },
    list: async (filter) => {
      const scope = (filter as ThresholdRuleFilter | undefined)?.scope;
      const query = db.select().from(thresholdRule);
      const rows = scope ? await query.where(eq(thresholdRule.scope, scope)) : await query;
      return rows.map(thresholdRuleMapper.fromRow);
    },
  });
}

// ---- EXPOSURE (T-119) — specialized: identity is (incident,node); recompute UPSERTS (EV2) -------
export interface ExposureRepository {
  upsert(entity: Exposure): Promise<Result<Exposure, DomainError>>;
  listByIncident(incidentId: IncidentId): Promise<Result<readonly Exposure[], DomainError>>;
}

export function makeExposureRepository(db: Db): ExposureRepository {
  return {
    upsert: (entity) =>
      tryResult(async () => {
        const values = exposureMapper.toRow(entity);
        const rows = await db
          .insert(exposure)
          .values(values)
          .onConflictDoUpdate({
            target: [exposure.incidentId, exposure.nodeId],
            set: values,
          })
          .returning();
        return exposureMapper.fromRow(firstRow(rows, 'exposure.upsert'));
      }),
    listByIncident: (incidentId) =>
      tryResult(async () =>
        (await db.select().from(exposure).where(eq(exposure.incidentId, incidentId))).map(
          exposureMapper.fromRow,
        ),
      ),
  };
}

// Re-export the composite-key helper for callers needing an exact (incident,node) lookup.
export const exposureKey = (incidentId: IncidentId, nodeId: string) =>
  and(eq(exposure.incidentId, incidentId), eq(exposure.nodeId, nodeId));
