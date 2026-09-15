// BEACON — Drizzle tables: provenance, scope, hazard & environment cluster (E3·T-092…T-097).
// Byte-faithful mirror of schemas/schema.sql tables 1-8 + 11 (app_user). Adapter layer (Art. II).
import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { BBox, Geometry } from '@/domain/value-objects/geo.js';
// NB: intra-schema relative imports are extensionless (not `.js`) so drizzle-kit's esbuild
// bundler resolves the TS source directly; tsc (bundler resolution), vitest, and tsx all accept it.
// DERIVED, NEVER RETYPED (the F-171 discipline logistics-tables.ts applies to RESOURCE_KINDS): the
// `source_record.mode` CHECK is handed the DOMAIN constant, so widening the served vocabulary regenerates
// the constraint by construction. It takes SERVED_MODES, not SOURCE_MODES: this column records what
// ACTUALLY served a source (ADR-041 §3), and `ProvenanceEntry.mode` — the only shape written into it — is
// the served vocabulary. The three-rung LADDER vocabulary lives in the adapter config, not here.
import { SERVED_MODES } from '@/domain/source-record.js';
import { checkEnum, createdAtColumn, idColumn, instant, updatedAtColumn } from './columns';

// 1. SOURCE_RECORD — provenance anchor (Art. XI). Created early: many FKs target it.
export const sourceRecord = pgTable(
  'source_record',
  {
    id: idColumn(),
    source: text('source').notNull(),
    adapter: text('adapter').notNull(),
    fetchedAt: instant('fetched_at').notNull().defaultNow(),
    license: text('license'),
    mode: text('mode').notNull().default('LIVE'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    checkEnum('chk_source_record_mode', t.mode, SERVED_MODES),
    // ONE current row per source (migration 0007, ADR-039). This is what makes the runtime provenance
    // write an UPSERT instead of an append: bounded growth, and a STABLE uuid per source — which is the
    // id `citation.source_id` references, so the natural key here is what closes that FK defect.
    unique('uq_source_record_source').on(t.source),
    index('idx_source_record_fetched_at').on(t.fetchedAt.desc()),
    index('idx_source_record_adapter').on(t.adapter),
    index('idx_source_record_mode').on(t.mode),
  ],
);

// 2. REGION — operating scope (community / state / country). bbox: GeoJSON or BBox tuple (jsonb, Turf default).
export const region = pgTable(
  'region',
  {
    id: idColumn(),
    name: text('name').notNull(),
    // NATURAL KEY (migration 0009): the config id the COP uses (`us-ca`). See incident.domainId — same
    // gap, same fix; it also retires the seed's positional uuid assignment, which silently reshuffled
    // region ids whenever config/regions.json grew.
    domainId: text('domain_id'),
    scope: text('scope').notNull(),
    bbox: jsonb('bbox').$type<BBox | Geometry>(),
    enabledAdapters: jsonb('enabled_adapters').$type<string[]>().notNull().default([]),
    sourceModeOverrides: jsonb('source_mode_overrides')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_region_scope', t.scope, ['COMMUNITY', 'STATE', 'COUNTRY']),
    index('idx_region_scope').on(t.scope),
    unique('uq_region_domain_id').on(t.domainId),
  ],
);

// 11. APP_USER — RBAC principal (defined before tables that FK to it). PRD §11.
export const appUser = pgTable(
  'app_user',
  {
    id: idColumn(),
    role: text('role').notNull().default('PUBLIC'),
    org: text('org'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_app_user_role', t.role, ['PUBLIC', 'RESPONDER', 'VERIFIER', 'EM']),
    index('idx_app_user_role').on(t.role),
  ],
);

// 3. INCIDENT — wildfire / flood event, scoped to a region.
export const incident = pgTable(
  'incident',
  {
    id: idColumn(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => region.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    // NATURAL KEY (migration 0008, ADR-039 §2a). BEACON addresses incidents by domain id
    // (`us-ca-wildfire-demo`) while the FKs address them by surrogate uuid; this column is the translation,
    // and it is what lets a SitRep be persisted against an incident at all. Nullable: DB-minted-only rows
    // are legal, and Postgres treats NULLs as distinct so the unique index tolerates many of them.
    domainId: text('domain_id'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // Mirrors src/domain/incident.ts INCIDENT_TYPES (STORM added by ADR-032 — migration 0003).
    checkEnum('chk_incident_type', t.type, ['WILDFIRE', 'FLOOD', 'STORM']),
    unique('uq_incident_domain_id').on(t.domainId),
    checkEnum('chk_incident_status', t.status, ['ACTIVE', 'CONTAINED', 'CLOSED']),
    index('idx_incident_region_id').on(t.regionId),
    index('idx_incident_status').on(t.status),
    index('idx_incident_updated').on(t.updatedAt.desc()),
  ],
);

// 4. HAZARD_GEOMETRY — observed hazard footprint (provenance-anchored).
export const hazardGeometry = pgTable(
  'hazard_geometry',
  {
    id: idColumn(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    geom: jsonb('geom').$type<Geometry>().notNull(),
    bbox: jsonb('bbox').$type<BBox | Geometry>(),
    intensity: doublePrecision('intensity'),
    observedAt: instant('observed_at').notNull().defaultNow(),
    sourceId: uuid('source_id').references(() => sourceRecord.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    // Mirrors src/domain/hazard-geometry.ts HAZARD_KINDS (storm family added by ADR-032 — migration 0003).
    checkEnum('chk_hazard_geometry_kind', t.kind, [
      'HOTSPOT',
      'PERIMETER',
      'FLOOD_REACH',
      'SPREAD_CONE',
      'TRACK',
      'CONE',
      'STORM_SURGE',
    ]),
    index('idx_hazgeom_incident').on(t.incidentId),
    index('idx_hazgeom_kind').on(t.kind),
    index('idx_hazgeom_observed').on(t.observedAt.desc()),
    index('idx_hazgeom_source').on(t.sourceId),
    // bbox spatial pre-filter (Turf/default path): GIN over the GeoJSON bbox (jsonb_path_ops).
    index('idx_hazgeom_bbox_gin').using('gin', t.bbox.op('jsonb_path_ops')),
  ],
);

// 5. GAUGE — flood gauge reading + crest forecast.
export const gauge = pgTable(
  'gauge',
  {
    id: idColumn(),
    geom: jsonb('geom').$type<Geometry>().notNull(),
    stage: doublePrecision('stage'),
    floodCategory: text('flood_category').notNull().default('NONE'),
    crestForecast: doublePrecision('crest_forecast'),
    crestTime: instant('crest_time'),
    sourceId: uuid('source_id').references(() => sourceRecord.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_gauge_flood_category', t.floodCategory, [
      'NONE',
      'ACTION',
      'MINOR',
      'MODERATE',
      'MAJOR',
    ]),
    index('idx_gauge_category').on(t.floodCategory),
    index('idx_gauge_source').on(t.sourceId),
  ],
);

// 6. INFRASTRUCTURE_NODE — lifeline asset + hazard relationship status (state machine §4).
export const infrastructureNode = pgTable(
  'infrastructure_node',
  {
    id: idColumn(),
    type: text('type').notNull(),
    geom: jsonb('geom').$type<Geometry>().notNull(),
    status: text('status').notNull().default('ONLINE'),
    sourceId: uuid('source_id').references(() => sourceRecord.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_infrastructure_node_type', t.type, [
      'HOSPITAL',
      'NURSING_HOME',
      'POWER',
      'CELL',
      'ROAD',
      'RAIL',
      'SHELTER',
    ]),
    checkEnum('chk_infrastructure_node_status', t.status, ['ONLINE', 'AT_RISK', 'OFFLINE']),
    index('idx_infranode_type').on(t.type),
    index('idx_infranode_status').on(t.status),
    index('idx_infranode_source').on(t.sourceId),
  ],
);

// 7. EXPOSURE — deterministic incident<->node intersection result (Art. XII). One row per pair (EV2).
export const exposure = pgTable(
  'exposure',
  {
    id: idColumn(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => infrastructureNode.id, { onDelete: 'cascade' }),
    insideHazard: boolean('inside_hazard').notNull().default(false),
    distanceM: doublePrecision('distance_m'),
    reason: text('reason').notNull(),
    computedAt: instant('computed_at').notNull().defaultNow(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    checkEnum('chk_exposure_reason', t.reason, ['IN_POLYGON', 'IN_BUFFER', 'OUTAGE']),
    unique('uq_exposure_incident_node').on(t.incidentId, t.nodeId),
    index('idx_exposure_incident').on(t.incidentId),
    index('idx_exposure_node').on(t.nodeId),
    index('idx_exposure_inside').on(t.incidentId, t.insideHazard),
  ],
);

// 8. PREDICTION — labeled first-order projection (method/inputs/uncertainty).
export const prediction = pgTable(
  'prediction',
  {
    id: idColumn(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    geom: jsonb('geom').$type<Geometry>(),
    method: text('method').notNull(),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
    uncertainty: doublePrecision('uncertainty'),
    horizon: instant('horizon'),
    sourceId: uuid('source_id').references(() => sourceRecord.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    checkEnum('chk_prediction_kind', t.kind, [
      'FIRE_CONE',
      'FLOOD_INUNDATION',
      'IMPACT_OVER_TIME',
      'ESCALATION',
    ]),
    index('idx_prediction_incident').on(t.incidentId),
    index('idx_prediction_kind').on(t.kind),
    index('idx_prediction_horizon').on(t.horizon),
  ],
);
