// BEACON — Drizzle schema barrel (E3·T-105). Single import surface for drizzle-kit + the repository
// adapter; re-exports all 23 tables. drizzle.config.ts points here. Source of truth: schemas/schema.sql
// (byte-faithful mirror) → docs/architecture/DOMAIN_MODEL.md. Adapter layer only (Art. II).
export { checkEnum, createdAtColumn, idColumn, instant, updatedAtColumn } from './schema/columns';

// Cluster 1 — provenance, scope, hazard & environment (tables 1-8, 11).
export {
  appUser,
  exposure,
  gauge,
  hazardGeometry,
  incident,
  infrastructureNode,
  prediction,
  region,
  sourceRecord,
} from './schema/core-tables';

// Cluster 2 — intel, sources & alerting (tables 9,10,12,13,14).
export { alert, citation, publicReport, sitrep, thresholdRule } from './schema/intel-tables';

// Cluster 3 — logistics, identity & audit (tables 15-19).
export { auditEvent, evacRoute, resource, resourceTask, shelter } from './schema/logistics-tables';

// Cluster 4 — the operator-maintained dock-panel datasets (tables 20-23; ADR-041, migration 0010).
// `shelter` above is the fifth panel dataset, reused rather than duplicated.
export {
  damageAssessmentEntry,
  emsOverlayProduct,
  supplyLot,
  volunteerTeam,
} from './schema/panel-tables';
