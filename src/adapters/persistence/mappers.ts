// BEACON — row↔domain anti-corruption mappers (E3·T-116…T-121; Art. II). No raw DB row ever leaks
// above this layer; every fromRow re-runs the domain factory so persisted data is re-validated on read,
// and provenance/freshness fields (sourceId, fetchedAt, observedAt, computedAt) are preserved both ways.
import {
  asId,
  makeAlert,
  makeCitation,
  makeEvacRoute,
  makeExposure,
  makeHazardGeometry,
  makeIncident,
  makeRegion,
  makeResource,
  makeResourceTask,
  makeShelter,
  makeSourceRecord,
  makeThresholdRule,
} from '@/domain/index.js';
import type {
  Alert,
  AlertCategory,
  AlertSeverity,
  BBox,
  CapStatus,
  Citation,
  EdxlKind,
  EvacRoute,
  Exposure,
  ExposureReason,
  Geometry,
  HazardGeometry,
  HazardKind,
  Incident,
  IncidentStatus,
  IncidentType,
  PointGeometry,
  Region,
  RegionScope,
  Resource,
  ResourceKind,
  ResourceStatus,
  ResourceTask,
  ResourceTaskStatus,
  Shelter,
  ShelterStatus,
  SourceMode,
  SourceRecord,
  ThresholdRule,
  ThresholdOperator,
  ThresholdTarget,
} from '@/domain/index.js';
import type {
  alert,
  citation,
  evacRoute,
  exposure,
  hazardGeometry,
  incident,
  region,
  resource,
  resourceTask,
  shelter,
  sourceRecord,
  thresholdRule,
} from './schema';

const iso = (d: Date): string => d.toISOString();

// ---- INCIDENT (T-116) --------------------------------------------------------------------------
export const incidentMapper = {
  toRow(e: Incident): typeof incident.$inferInsert {
    return { id: e.id, regionId: e.regionId, type: e.type, status: e.status };
  },
  fromRow(r: typeof incident.$inferSelect): Incident {
    return makeIncident({
      id: asId(r.id),
      regionId: asId(r.regionId),
      type: r.type as IncidentType,
      status: r.status as IncidentStatus,
    });
  },
};

// ---- HAZARD_GEOMETRY (T-117) — round-trips GeoJSON + provenance -------------------------------
export const hazardGeometryMapper = {
  toRow(e: HazardGeometry): typeof hazardGeometry.$inferInsert {
    return {
      id: e.id,
      incidentId: e.incidentId,
      sourceId: e.sourceId,
      kind: e.kind,
      geom: e.geometry,
      observedAt: new Date(e.observedAt),
      ...(e.intensity !== undefined ? { intensity: e.intensity } : {}),
    };
  },
  fromRow(r: typeof hazardGeometry.$inferSelect): HazardGeometry {
    return makeHazardGeometry({
      id: asId(r.id),
      incidentId: asId(r.incidentId),
      sourceId: asId(r.sourceId ?? ''),
      kind: r.kind as HazardKind,
      geometry: r.geom as Geometry,
      observedAt: iso(r.observedAt),
      ...(r.intensity !== null ? { intensity: r.intensity } : {}),
    });
  },
};

// ---- SOURCE_RECORD (T-118) — the provenance anchor; freshness must survive the round-trip ------
export const sourceRecordMapper = {
  toRow(e: SourceRecord): typeof sourceRecord.$inferInsert {
    return {
      id: e.id,
      source: e.source,
      adapter: e.adapter,
      fetchedAt: new Date(e.fetchedAt),
      license: e.license,
      mode: e.mode,
    };
  },
  fromRow(r: typeof sourceRecord.$inferSelect): SourceRecord {
    return makeSourceRecord({
      id: asId(r.id),
      source: r.source,
      adapter: r.adapter,
      fetchedAt: iso(r.fetchedAt),
      license: r.license ?? '',
      mode: r.mode as SourceMode,
    });
  },
};

// ---- CITATION (T-118) --------------------------------------------------------------------------
export const citationMapper = {
  toRow(e: Citation): typeof citation.$inferInsert {
    return { id: e.id, sitrepId: e.sitrepId, sourceId: e.sourceId, field: e.field, claim: e.claim };
  },
  fromRow(r: typeof citation.$inferSelect): Citation {
    return makeCitation({
      id: asId(r.id),
      sitrepId: asId(r.sitrepId),
      sourceId: asId(r.sourceId),
      field: r.field,
      claim: r.claim,
    });
  },
};

// ---- EXPOSURE (T-119) — identity is (incident,node); upsert on the unique key ------------------
export const exposureMapper = {
  toRow(e: Exposure): typeof exposure.$inferInsert {
    return {
      incidentId: e.incidentId,
      nodeId: e.nodeId,
      reason: e.reason,
      insideHazard: e.insideHazard,
      computedAt: new Date(e.computedAt),
      ...(e.distanceM !== undefined ? { distanceM: e.distanceM } : {}),
    };
  },
  fromRow(r: typeof exposure.$inferSelect): Exposure {
    return makeExposure({
      incidentId: asId(r.incidentId),
      nodeId: asId(r.nodeId),
      reason: r.reason as ExposureReason,
      insideHazard: r.insideHazard,
      computedAt: iso(r.computedAt),
      ...(r.distanceM !== null ? { distanceM: r.distanceM } : {}),
    });
  },
};

// ---- ALERT (T-120) — approval invariant enforced at the DB (chk_alert_actual_approved) ---------
export const alertMapper = {
  toRow(e: Alert): typeof alert.$inferInsert {
    return {
      id: e.id,
      incidentId: e.incidentId,
      capStatus: e.capStatus,
      category: e.category,
      severity: e.severity,
      edxlKind: e.edxlKind,
      ...(e.thresholdRuleId !== undefined ? { thresholdRuleId: e.thresholdRuleId } : {}),
      ...(e.area !== undefined ? { area: e.area } : {}),
      ...(e.sentAt !== undefined ? { sentAt: new Date(e.sentAt) } : {}),
      ...(e.approvedBy !== undefined ? { approvedBy: e.approvedBy } : {}),
    };
  },
  fromRow(r: typeof alert.$inferSelect): Alert {
    return makeAlert({
      id: asId(r.id),
      incidentId: asId(r.incidentId),
      capStatus: r.capStatus as CapStatus,
      category: r.category as AlertCategory,
      severity: r.severity as AlertSeverity,
      edxlKind: r.edxlKind as EdxlKind,
      ...(r.thresholdRuleId !== null ? { thresholdRuleId: asId(r.thresholdRuleId) } : {}),
      ...(r.area !== null ? { area: r.area as Geometry } : {}),
      ...(r.sentAt !== null ? { sentAt: iso(r.sentAt) } : {}),
      ...(r.approvedBy !== null ? { approvedBy: asId(r.approvedBy) } : {}),
    });
  },
};

// ---- REGION (T-121) — bbox persisted as the [minLon,minLat,maxLon,maxLat] tuple in jsonb --------
export const regionMapper = {
  toRow(e: Region): typeof region.$inferInsert {
    return {
      id: e.id,
      name: e.name,
      scope: e.scope,
      bbox: e.bbox,
      enabledAdapters: [...e.enabledAdapters],
    };
  },
  fromRow(r: typeof region.$inferSelect): Region {
    return makeRegion({
      id: asId(r.id),
      name: r.name,
      scope: r.scope as RegionScope,
      bbox: r.bbox as BBox,
      enabledAdapters: r.enabledAdapters ?? [],
    });
  },
};

// ---- LOGISTICS CLUSTER (resource / shelter / resource_task / evac_route) ------------------------
//
// DB-MINTED IDENTITY, stated once for the whole cluster: every `toRow` below OMITS `id`. These four PKs are
// `uuid` columns and BEACON's runtime ids are not uuids (`task-<boot>-<n>`, `evac-heuristic-<incident>`), so
// sending one is not a drift risk but a rejected literal. The DB assigns the surrogate key and the caller
// gets the STORED entity back from `.returning()` — the same decision `read-models.ts` already made for
// `public_report`, and the reason a Postgres logistics store can accept the ids the HTTP layer mints today.

// ---- RESOURCE (T-122) — responder asset registry ----------------------------------------------
export const resourceMapper = {
  toRow(e: Resource): Omit<typeof resource.$inferInsert, 'id'> {
    return {
      kind: e.kind,
      status: e.status,
      ...(e.orgId !== undefined ? { org: e.orgId } : {}),
      ...(e.geom !== undefined ? { geom: e.geom } : {}),
    };
  },
  fromRow(r: typeof resource.$inferSelect): Resource {
    return makeResource({
      id: asId(r.id),
      kind: r.kind as ResourceKind,
      status: r.status as ResourceStatus,
      ...(r.org !== null ? { orgId: asId(r.org) } : {}),
      ...(r.geom !== null ? { geom: r.geom as PointGeometry } : {}),
    });
  },
};

// ---- SHELTER (T-123) — capacity vs occupancy ---------------------------------------------------
export const shelterMapper = {
  toRow(e: Shelter): Omit<typeof shelter.$inferInsert, 'id'> {
    return {
      geom: e.geom,
      capacity: e.capacity,
      occupancy: e.occupancy,
      status: e.status,
      ...(e.orgId !== undefined ? { org: e.orgId } : {}),
    };
  },
  // `capacity` is NULLABLE in the DDL while the domain requires a number. NULL means "nobody has counted
  // this building", and it hydrates to 0 — which makes the shelter INELIGIBLE for matching rather than a
  // destination with an invented headroom (Art. XVI: degrade honestly, never fabricate a figure).
  fromRow(r: typeof shelter.$inferSelect): Shelter {
    return makeShelter({
      id: asId(r.id),
      geom: r.geom as PointGeometry,
      capacity: r.capacity ?? 0,
      occupancy: r.occupancy,
      status: r.status as ShelterStatus,
      ...(r.org !== null ? { orgId: asId(r.org) } : {}),
    });
  },
};

// ---- RESOURCE_TASK (T-124) — forward-only tasking lifecycle (EV9) ------------------------------
export const resourceTaskMapper = {
  toRow(e: ResourceTask): Omit<typeof resourceTask.$inferInsert, 'id'> {
    return {
      resourceId: e.resourceId,
      incidentId: e.incidentId,
      status: e.status,
      ...(e.shelterId !== undefined ? { shelterId: e.shelterId } : {}),
      ...(e.target !== undefined ? { target: e.target } : {}),
      ...(e.edxlRmRef !== undefined ? { edxlRmRef: e.edxlRmRef } : {}),
    };
  },
  fromRow(r: typeof resourceTask.$inferSelect): ResourceTask {
    return makeResourceTask({
      id: asId(r.id),
      resourceId: asId(r.resourceId),
      incidentId: asId(r.incidentId),
      status: r.status as ResourceTaskStatus,
      ...(r.shelterId !== null ? { shelterId: asId(r.shelterId) } : {}),
      ...(r.target !== null ? { target: r.target } : {}),
      ...(r.edxlRmRef !== null ? { edxlRmRef: r.edxlRmRef } : {}),
    });
  },
};

// ---- EVAC_ROUTE (T-125) — the ACCEPTED hazard-avoiding route plan (EV7) ------------------------
export const evacRouteMapper = {
  toRow(e: EvacRoute): Omit<typeof evacRoute.$inferInsert, 'id'> {
    return {
      incidentId: e.incidentId,
      geom: e.geom,
      avoidsHazard: e.avoidsHazard,
      ...(e.suggestedStart !== undefined ? { suggestedStart: new Date(e.suggestedStart) } : {}),
    };
  },
  fromRow(r: typeof evacRoute.$inferSelect): EvacRoute {
    return makeEvacRoute({
      id: asId(r.id),
      incidentId: asId(r.incidentId),
      geom: r.geom as Geometry,
      avoidsHazard: r.avoidsHazard,
      ...(r.suggestedStart !== null ? { suggestedStart: iso(r.suggestedStart) } : {}),
    });
  },
};

// ---- THRESHOLD_RULE (T-121) — hysteresis/cooldown are numeric in the domain, text in the DDL ----
export const thresholdRuleMapper = {
  toRow(e: ThresholdRule): typeof thresholdRule.$inferInsert {
    return {
      id: e.id,
      target: e.target,
      operator: e.operator,
      value: e.value,
      ...(e.scope !== undefined ? { scope: e.scope } : {}),
      ...(e.hysteresis !== undefined ? { hysteresis: String(e.hysteresis) } : {}),
      ...(e.cooldown !== undefined ? { cooldown: String(e.cooldown) } : {}),
    };
  },
  fromRow(r: typeof thresholdRule.$inferSelect): ThresholdRule {
    return makeThresholdRule({
      id: asId(r.id),
      target: r.target as ThresholdTarget,
      operator: r.operator as ThresholdOperator,
      value: r.value,
      ...(r.scope !== null ? { scope: asId(r.scope) } : {}),
      ...(r.hysteresis !== null ? { hysteresis: Number(r.hysteresis) } : {}),
      ...(r.cooldown !== null ? { cooldown: Number(r.cooldown) } : {}),
    });
  },
};
