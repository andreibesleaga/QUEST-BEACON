-- =============================================================================
-- BEACON — Canonical PostgreSQL DDL (S03)
-- =============================================================================
-- Source of truth: docs/architecture/DOMAIN_MODEL.md (S02 canonical ER).
-- ORM: Drizzle / drizzle-kit (ADR-013) — this file is the human-authored
--      reference DDL; the Drizzle schema (src/adapters/persistence/schema.ts)
--      generates equivalent migrations (see MIGRATION_PLAN.md).
-- Persistence + geo (ADR-005): Postgres canonical store. Geometry is stored as
--      GeoJSON in `jsonb` BY DEFAULT (Turf.js geo-compute, no extension needed,
--      air-gapped / ~$0). A PostGIS variant (geometry(Geometry,4326) + GIST) is
--      provided COMMENTED behind the SpatialPort flag (FEATURE_SPATIAL=postgis).
--
-- Conventions:
--   * uuid PKs, DEFAULT gen_random_uuid()  (pgcrypto/pg13+ built-in)
--   * timestamptz for all instants
--   * enums via CHECK constraints (match the enums in DOMAIN_MODEL exactly)
--   * jsonb for structured payloads + GeoJSON geometry (default)
--   * provenance: ingested entities carry source_id FK -> SOURCE_RECORD
--   * every table carries created_at/updated_at where useful (audit-friendliness)
--
-- 19 entities (DOMAIN_MODEL order):
--   REGION, INCIDENT, HAZARD_GEOMETRY, GAUGE, INFRASTRUCTURE_NODE, EXPOSURE,
--   PREDICTION, PUBLIC_REPORT, SITREP, CITATION, SOURCE_RECORD, ALERT,
--   THRESHOLD_RULE, RESOURCE, RESOURCE_TASK, SHELTER, EVAC_ROUTE, APP_USER,
--   AUDIT_EVENT
-- =============================================================================

-- gen_random_uuid() is built-in on PostgreSQL >= 13. On older servers enable:
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- PostGIS variant (OPTIONAL — ADR-005, FEATURE_SPATIAL=postgis).
-- When the PostGIS SpatialPort adapter is active, run this FIRST, then use the
-- `geometry(...)` column definitions marked  -- [POSTGIS]  in each table instead
-- of the default `jsonb` GeoJSON columns, and create the GIST indexes at the
-- bottom of this file. By DEFAULT (Turf.js) leave all of this commented out.
-- -----------------------------------------------------------------------------
-- CREATE EXTENSION IF NOT EXISTS postgis;
-- =============================================================================


-- =============================================================================
-- 1. SOURCE_RECORD  — provenance anchor (Art. XI). Created early: many FKs target it.
-- =============================================================================
CREATE TABLE source_record (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source      text        NOT NULL,                 -- logical source name (e.g. "NASA FIRMS")
    adapter     text        NOT NULL,                 -- adapter id (e.g. "firms-adapter")
    fetched_at  timestamptz NOT NULL DEFAULT now(),   -- freshness anchor (U1)
    license     text,                                 -- license string (NOTICE tracking)
    -- SERVED provenance, not the adapter ladder rung (ADR-041 §3, migration 0010): 'DB' names a record an
    -- operator maintains in BEACON's own store. SOURCE_<NAME>_MODE keeps exactly LIVE|CACHED|MOCK.
    mode        text        NOT NULL DEFAULT 'LIVE'
                  CHECK (mode IN ('LIVE','CACHED','MOCK','DB')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- ONE current row per source (migration 0007, ADR-039): the runtime provenance write UPSERTS on this
    -- key rather than appending per fetch, which bounds growth AND keeps each source's uuid stable — the
    -- id citation.source_id points at.
    CONSTRAINT uq_source_record_source UNIQUE (source)
);
CREATE INDEX idx_source_record_fetched_at ON source_record (fetched_at DESC); -- freshness queries
CREATE INDEX idx_source_record_adapter    ON source_record (adapter);
CREATE INDEX idx_source_record_mode       ON source_record (mode);


-- =============================================================================
-- 2. REGION  — operating scope (community / state / country)
-- =============================================================================
CREATE TABLE region (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  text NOT NULL,
    scope                 text NOT NULL
                            CHECK (scope IN ('COMMUNITY','STATE','COUNTRY')),
    -- bbox: GeoJSON Polygon/MultiPolygon (region bounding box) — DEFAULT (Turf)
    bbox                  jsonb,
    -- bbox  geometry(Geometry,4326),                  -- [POSTGIS]
    enabled_adapters      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- adapter ids active here
    source_mode_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,  -- per-source LIVE|CACHED|MOCK
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_region_scope ON region (scope);


-- =============================================================================
-- 3. INCIDENT  — wildfire / flood event, scoped to a region
-- =============================================================================
CREATE TABLE incident (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id   uuid NOT NULL REFERENCES region (id) ON DELETE CASCADE,
    -- STORM (tropical cyclone/typhoon) is first-class since ADR-032 (migration 0003).
    type        text NOT NULL CHECK (type IN ('WILDFIRE','FLOOD','STORM')),
    status      text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','CONTAINED','CLOSED')),
    domain_id   text        UNIQUE,                   -- natural key (migration 0008, ADR-039): the id BEACON
                                                          -- uses (`us-ca-wildfire-demo`); FKs still use the uuid
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incident_region_id ON incident (region_id);          -- by region
CREATE INDEX idx_incident_status    ON incident (status);             -- by status
CREATE INDEX idx_incident_updated   ON incident (updated_at DESC);


-- =============================================================================
-- 4. HAZARD_GEOMETRY  — observed hazard footprint (provenance-anchored)
-- =============================================================================
CREATE TABLE hazard_geometry (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
    kind        text NOT NULL
                  -- TRACK/CONE/STORM_SURGE: the storm family (ADR-032, migration 0003). CONE is the
                  -- agency cyclone forecast cone; SPREAD_CONE remains the wildfire spread projection.
                  CHECK (kind IN ('HOTSPOT','PERIMETER','FLOOD_REACH','SPREAD_CONE',
                                  'TRACK','CONE','STORM_SURGE')),
    -- geom: GeoJSON geometry — DEFAULT (Turf)
    geom        jsonb NOT NULL,
    -- geom     geometry(Geometry,4326) NOT NULL,      -- [POSTGIS]
    -- bbox (GeoJSON [minX,minY,maxX,maxY] or Polygon) cached for cheap pre-filtering
    bbox        jsonb,
    intensity   double precision,
    observed_at timestamptz NOT NULL DEFAULT now(),
    source_id   uuid REFERENCES source_record (id) ON DELETE SET NULL,  -- provenance (Art. XI)
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hazgeom_incident   ON hazard_geometry (incident_id);
CREATE INDEX idx_hazgeom_kind       ON hazard_geometry (kind);
CREATE INDEX idx_hazgeom_observed   ON hazard_geometry (observed_at DESC);
CREATE INDEX idx_hazgeom_source     ON hazard_geometry (source_id);
-- bbox-ish spatial pre-filter (default/Turf path): GIN over the GeoJSON bbox
CREATE INDEX idx_hazgeom_bbox_gin   ON hazard_geometry USING gin (bbox jsonb_path_ops);


-- =============================================================================
-- 5. GAUGE  — flood gauge reading + crest forecast
-- =============================================================================
CREATE TABLE gauge (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- geom: GeoJSON Point — DEFAULT (Turf)
    geom           jsonb NOT NULL,
    -- geom        geometry(Point,4326) NOT NULL,      -- [POSTGIS]
    stage          double precision,
    flood_category text NOT NULL DEFAULT 'NONE'
                     CHECK (flood_category IN ('NONE','ACTION','MINOR','MODERATE','MAJOR')),
    crest_forecast double precision,
    crest_time     timestamptz,
    source_id      uuid REFERENCES source_record (id) ON DELETE SET NULL,  -- provenance
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gauge_category ON gauge (flood_category);
CREATE INDEX idx_gauge_source   ON gauge (source_id);


-- =============================================================================
-- 6. INFRASTRUCTURE_NODE  — lifeline asset + hazard relationship status
-- =============================================================================
CREATE TABLE infrastructure_node (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type        text NOT NULL
                  CHECK (type IN ('HOSPITAL','NURSING_HOME','POWER','CELL','ROAD','RAIL','SHELTER')),
    -- geom: GeoJSON geometry — DEFAULT (Turf)
    geom        jsonb NOT NULL,
    -- geom     geometry(Geometry,4326) NOT NULL,      -- [POSTGIS]
    status      text NOT NULL DEFAULT 'ONLINE'
                  CHECK (status IN ('ONLINE','AT_RISK','OFFLINE')),  -- state machine §4
    source_id   uuid REFERENCES source_record (id) ON DELETE SET NULL,  -- provenance
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_infranode_type   ON infrastructure_node (type);
CREATE INDEX idx_infranode_status ON infrastructure_node (status);
CREATE INDEX idx_infranode_source ON infrastructure_node (source_id);


-- =============================================================================
-- 7. EXPOSURE  — deterministic incident<->node intersection result (Art. XII)
-- =============================================================================
CREATE TABLE exposure (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id   uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
    node_id       uuid NOT NULL REFERENCES infrastructure_node (id) ON DELETE CASCADE,
    inside_hazard boolean NOT NULL DEFAULT false,
    distance_m    double precision,
    reason        text NOT NULL CHECK (reason IN ('IN_POLYGON','IN_BUFFER','OUTAGE')),
    computed_at   timestamptz NOT NULL DEFAULT now(),  -- deterministic — Art. XII
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- one current exposure row per (incident,node); recompute upserts (EV2)
    CONSTRAINT uq_exposure_incident_node UNIQUE (incident_id, node_id)
);
CREATE INDEX idx_exposure_incident ON exposure (incident_id);
CREATE INDEX idx_exposure_node     ON exposure (node_id);
CREATE INDEX idx_exposure_inside   ON exposure (incident_id, inside_hazard);


-- =============================================================================
-- 8. PREDICTION  — labeled first-order projection (method/inputs/uncertainty)
-- =============================================================================
CREATE TABLE prediction (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
    kind        text NOT NULL
                  CHECK (kind IN ('FIRE_CONE','FLOOD_INUNDATION','IMPACT_OVER_TIME','ESCALATION')),
    -- geom: GeoJSON geometry — DEFAULT (Turf)
    geom        jsonb,
    -- geom     geometry(Geometry,4326),               -- [POSTGIS]
    method      text NOT NULL,                         -- labeled first-order; inputs + uncertainty
    inputs      jsonb NOT NULL DEFAULT '{}'::jsonb,
    uncertainty double precision,
    horizon     timestamptz,
    source_id   uuid REFERENCES source_record (id) ON DELETE SET NULL,  -- forecast provenance
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prediction_incident ON prediction (incident_id);
CREATE INDEX idx_prediction_kind     ON prediction (kind);
CREATE INDEX idx_prediction_horizon  ON prediction (horizon);


-- =============================================================================
-- 11. APP_USER  — RBAC principal (defined before tables that FK to it)
--     Roles: PUBLIC | RESPONDER | VERIFIER | EM  (PRD §11)
-- =============================================================================
CREATE TABLE app_user (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role        text NOT NULL DEFAULT 'PUBLIC'
                  CHECK (role IN ('PUBLIC','RESPONDER','VERIFIER','EM')),
    org         text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_app_user_role ON app_user (role);


-- =============================================================================
-- 9. PUBLIC_REPORT  — consented crowdsourced SOS (lifecycle §3)
--    geom_precise is responder-only (Art. XIV) — enforced at the APP LAYER
--    (RBAC, ST3): the column always stores precise loc, but the API must never
--    serialize it for a non-RESPONDER/EM/VERIFIER role. Not a DB constraint.
-- =============================================================================
CREATE TABLE public_report (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id          uuid REFERENCES incident (id) ON DELETE SET NULL,
    source               text NOT NULL CHECK (source IN ('WEB','SMS','SOCIAL')),
    -- FR-D4-4 (ADR-036 §7 / G14): `source` is the CHANNEL; `category` is the report's KIND. Nullable —
    -- a report filed before FR-D4-4 is uncategorised, which is NOT an assumed 'SOS'. (migration 0005)
    category             text CHECK (category IN ('SOS','DAMAGE','NEED')),
    -- report_text: the reporter's own words — THE CLAIM a verifier approves/rejects (Art. XIII). Required
    -- by PublicReportIntake since S03, but no column existed until migration 0006, so every channel
    -- validated it and dropped it. Art. XIV is met by lifecycle + audience (purged with the row at
    -- purge_after; GET /reports is VERIFIER+), not by discarding the evidence the human decision needs.
    -- Nullable: rows predating migration 0006 carry none. Length capped in the domain (2000).
    report_text          text,
    status               text NOT NULL DEFAULT 'UNVERIFIED'
                           CHECK (status IN ('UNVERIFIED','TRIAGED','VERIFIED','REJECTED')),
    -- FR-D6-5 aggregate casualty tally (ADR-035 §4). The COUNT and its observation instant are stored; the
    -- mandatory "unverified — not authoritative" caveat is deliberately NOT a column, so no row can carry
    -- the number without it — the domain factory stamps the caveat on every hydration. (migration 0005)
    casualty_count       integer CHECK (casualty_count IS NULL OR casualty_count >= 0),
    casualty_as_of       text,
    confidence           double precision
                           CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    confidence_components jsonb,  -- {geocode,authority,classifier,corroboration} (deterministic)
    -- geom_generalized: GeoJSON (public view) — DEFAULT (Turf)
    geom_generalized     jsonb,
    -- geom_generalized  geometry(Geometry,4326),       -- [POSTGIS]
    -- geom_precise: GeoJSON (responder-only, Art. XIV) — DEFAULT (Turf)
    geom_precise         jsonb,
    -- geom_precise      geometry(Geometry,4326),        -- [POSTGIS]
    consent              boolean NOT NULL DEFAULT false,   -- EV4 requires consent
    purge_after          timestamptz,                      -- no PII retention past incident (UW6)
    source_id            uuid REFERENCES source_record (id) ON DELETE SET NULL,  -- provenance
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    -- intake invariant (EV4): a report must be consented to exist
    CONSTRAINT chk_public_report_consent CHECK (consent = true)
);
CREATE INDEX idx_public_report_incident ON public_report (incident_id);
CREATE INDEX idx_public_report_status   ON public_report (status);
CREATE INDEX idx_public_report_purge    ON public_report (purge_after);
CREATE INDEX idx_public_report_source   ON public_report (source_id);


-- =============================================================================
-- 10. SITREP  — generated cited situational report
-- =============================================================================
CREATE TABLE sitrep (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id  uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
    generated_at timestamptz NOT NULL DEFAULT now(),
    summary      text,
    priorities   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ranked attention areas (deterministic)
    trend        text CHECK (trend IN ('ESCALATING','STEADY','DEESCALATING')),
    ai_mode      text NOT NULL DEFAULT 'deterministic-only'
                   CHECK (ai_mode IN ('cloud','local','deterministic-only')),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sitrep_incident  ON sitrep (incident_id);
CREATE INDEX idx_sitrep_generated ON sitrep (generated_at DESC);


-- =============================================================================
-- 12. CITATION  — grounds one SITREP field to a SOURCE_RECORD (Art. XI/XII, U2)
--     SITREP<->CITATION integrity: a citation cannot exist without its sitrep
--     (FK + CASCADE) and must reference a source (FK). Coverage (every SITREP
--     field has >=1 citation) is enforced at the app/contract-test layer.
-- =============================================================================
CREATE TABLE citation (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sitrep_id  uuid NOT NULL REFERENCES sitrep (id) ON DELETE CASCADE,
    source_id  uuid NOT NULL REFERENCES source_record (id) ON DELETE RESTRICT,
    field      text NOT NULL,   -- which SITREP field this grounds
    claim      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_citation_sitrep ON citation (sitrep_id);
CREATE INDEX idx_citation_source ON citation (source_id);
CREATE INDEX idx_citation_field  ON citation (sitrep_id, field);


-- =============================================================================
-- 13. THRESHOLD_RULE  — early-warning trigger config (defined before ALERT)
-- =============================================================================
CREATE TABLE threshold_rule (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target      text NOT NULL CHECK (target IN ('GAUGE_CATEGORY','HAZARD_BUFFER','FORECAST_GAUGE_CATEGORY')),
    operator    text NOT NULL CHECK (operator IN ('crosses','gte','enters')),
    value       text NOT NULL,
    scope       uuid REFERENCES region (id) ON DELETE CASCADE,  -- region_id scope
    hysteresis  text,
    cooldown    text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_threshold_rule_scope  ON threshold_rule (scope);
CREATE INDEX idx_threshold_rule_target ON threshold_rule (target);


-- =============================================================================
-- 14. ALERT  — CAP/EDXL alert (lifecycle §5). Art. XIII: no ACTUAL without approver.
-- =============================================================================
CREATE TABLE alert (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id      uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
    threshold_rule_id uuid REFERENCES threshold_rule (id) ON DELETE SET NULL,  -- rule that fired (EV6)
    cap_status       text NOT NULL DEFAULT 'DRAFT'
                       CHECK (cap_status IN ('DRAFT','ACTUAL')),
    category         text NOT NULL CHECK (category IN ('Fire','Met','Safety')),
    severity         text NOT NULL
                       CHECK (severity IN ('MINOR','MODERATE','SEVERE','EXTREME')),
    -- area: GeoJSON geometry — DEFAULT (Turf)
    area             jsonb,
    -- area          geometry(Geometry,4326),           -- [POSTGIS]
    edxl_kind        text NOT NULL DEFAULT 'CAP'
                       CHECK (edxl_kind IN ('CAP','EDXL_RM','EDXL_SITREP')),
    sent_at          timestamptz,
    approved_by      uuid REFERENCES app_user (id) ON DELETE RESTRICT,  -- Art. XIII
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    -- Art. XIII / ST1 / UW5: an ACTUAL alert MUST be human-approved. DRAFT may not be.
    CONSTRAINT chk_alert_actual_approved
        CHECK (cap_status <> 'ACTUAL' OR approved_by IS NOT NULL)
);
CREATE INDEX idx_alert_incident   ON alert (incident_id);
CREATE INDEX idx_alert_status      ON alert (cap_status);
CREATE INDEX idx_alert_severity    ON alert (severity);
CREATE INDEX idx_alert_sent        ON alert (sent_at DESC);
CREATE INDEX idx_alert_approved_by ON alert (approved_by);


-- =============================================================================
-- 15. RESOURCE  — responder asset registry (defined before RESOURCE_TASK)
-- =============================================================================
CREATE TABLE resource (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        text NOT NULL
                  -- 'TEAM' = FR-D6-1 volunteer team, registered/tasked as a UNIT (ADR-035 §4; migration 0005).
                  -- PINNED to RESOURCE_KINDS (src/domain/resource.ts) by
                  -- tests/architecture/domain-db-enum-pin.test.ts — this reference DDL is not importable
                  -- TypeScript, so it is the one copy that CAN drift and is therefore tested, not trusted.
                  CHECK (kind IN ('CREW','ENGINE','AIRCRAFT','MEDICAL','SUPPLY','TEAM')),
    status      text NOT NULL DEFAULT 'AVAILABLE'
                  CHECK (status IN ('AVAILABLE','ASSIGNED','OOS')),
    -- geom: GeoJSON Point — DEFAULT (Turf)
    geom        jsonb,
    -- geom     geometry(Point,4326),                   -- [POSTGIS]
    org         text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_resource_kind   ON resource (kind);
CREATE INDEX idx_resource_status ON resource (status);


-- =============================================================================
-- 16. SHELTER  — agency-seeded shelter w/ capacity vs occupancy
-- =============================================================================
CREATE TABLE shelter (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NATURAL KEY (migration 0010, ADR-041 §4): the readable id an operator edits the row by in Directus
    -- ('shelter-civic-center'). NULLABLE — this table pre-dates the column and already holds seeded rows.
    domain_id   text UNIQUE,
    -- geom: GeoJSON Point — DEFAULT (Turf)
    geom        jsonb NOT NULL,
    -- geom     geometry(Point,4326) NOT NULL,          -- [POSTGIS]
    capacity    integer CHECK (capacity IS NULL OR capacity >= 0),
    occupancy   integer NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
    status      text NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','FULL','CLOSED')),
    org         text,   -- agency-entered/seeded
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_shelter_occupancy_le_capacity
        CHECK (capacity IS NULL OR occupancy <= capacity)
);
CREATE INDEX idx_shelter_status ON shelter (status);


-- =============================================================================
-- 17. RESOURCE_TASK  — tasking lifecycle (PROPOSED->...->CLEARED, EV9)
-- =============================================================================
CREATE TABLE resource_task (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id  uuid NOT NULL REFERENCES resource (id) ON DELETE CASCADE,
    incident_id  uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
    shelter_id   uuid REFERENCES shelter (id) ON DELETE SET NULL,  -- staffed_by (DOMAIN_MODEL §2)
    status       text NOT NULL DEFAULT 'PROPOSED'
                   CHECK (status IN ('PROPOSED','TASKED','ENROUTE','ONSCENE','CLEARED')),
    -- target: GeoJSON geometry — DEFAULT (Turf)
    target       jsonb,
    -- target    geometry(Geometry,4326),               -- [POSTGIS]
    edxl_rm_ref  text,   -- mutual-aid round-trip id (EDXL-RM, EV10)
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_restask_resource ON resource_task (resource_id);
CREATE INDEX idx_restask_incident ON resource_task (incident_id);
CREATE INDEX idx_restask_shelter  ON resource_task (shelter_id);
CREATE INDEX idx_restask_status   ON resource_task (status);
CREATE INDEX idx_restask_edxlref  ON resource_task (edxl_rm_ref);


-- =============================================================================
-- 18. EVAC_ROUTE  — hazard-avoiding evacuation route (EV7)
-- =============================================================================
CREATE TABLE evac_route (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     uuid NOT NULL REFERENCES incident (id) ON DELETE CASCADE,
    -- geom: GeoJSON LineString — DEFAULT (Turf)
    geom            jsonb NOT NULL,
    -- geom         geometry(Geometry,4326) NOT NULL,   -- [POSTGIS]
    avoids_hazard   boolean NOT NULL DEFAULT true,
    suggested_start timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_evacroute_incident ON evac_route (incident_id);


-- =============================================================================
-- 19. AUDIT_EVENT  — append-only audit trail (PRD §11; every state change)
-- =============================================================================
CREATE TABLE audit_event (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        uuid REFERENCES app_user (id) ON DELETE SET NULL,
    action          text NOT NULL,
    target          text NOT NULL,
    at              timestamptz NOT NULL DEFAULT now(),
    -- Cost attribution (ADR-022) — set on LLM/vision/adapter calls; NULL on non-AI events.
    -- Numbers are deterministic (tokens x tier rate, Art. XII); no PII/content captured here (§9.3).
    cost_tokens_in  int,
    cost_tokens_out int,
    cost_usd        numeric,
    model_tier      text
                       CHECK (model_tier IS NULL OR model_tier IN ('CLOUD','LOCAL','DETERMINISTIC','VISION')),
    -- Tamper-evident hash chain (ADR-017/ADR-022; persisted per D-27). hash = H(prev_hash || canonical(row));
    -- each event links its predecessor's hash and is verified on read (append-only; fail-closed on any gap).
    prev_hash       text,
    hash            text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor  ON audit_event (actor_id);
CREATE INDEX idx_audit_at     ON audit_event (at DESC);
CREATE INDEX idx_audit_target ON audit_event (target);


-- =============================================================================
-- updated_at maintenance (optional convenience trigger).
-- Drizzle can also do this in app code; trigger keeps SQL-only paths correct.
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to tables that have updated_at:
CREATE TRIGGER trg_region_updated        BEFORE UPDATE ON region              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_incident_updated      BEFORE UPDATE ON incident            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_gauge_updated         BEFORE UPDATE ON gauge               FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_infranode_updated     BEFORE UPDATE ON infrastructure_node FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_app_user_updated      BEFORE UPDATE ON app_user            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_public_report_updated BEFORE UPDATE ON public_report       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_threshold_updated     BEFORE UPDATE ON threshold_rule      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_alert_updated         BEFORE UPDATE ON alert               FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_resource_updated      BEFORE UPDATE ON resource            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_shelter_updated       BEFORE UPDATE ON shelter             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_resource_task_updated BEFORE UPDATE ON resource_task       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- A `DB` row's served freshness IS its updated_at (ADR-041 §3), so these four are load-bearing, not hygiene.
CREATE TRIGGER trg_supply_lot_updated     BEFORE UPDATE ON supply_lot              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_volunteer_team_updated BEFORE UPDATE ON volunteer_team          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_damage_entry_updated   BEFORE UPDATE ON damage_assessment_entry FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ems_product_updated    BEFORE UPDATE ON ems_overlay_product     FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 20-23. THE OPERATOR-MAINTAINED PANEL DATASETS (ADR-041; migration 0010).
-- Nothing publishes relief stock, team readiness or shelter occupancy — there is no adapter to write and no
-- feed to poll. These are the tables an EMERGENCY MANAGER edits by hand in Directus, read by the five dock
-- panels and labelled `DB` on the wire: operator-maintained records in BEACON's own store, never a feed.
-- Every one carries a NATURAL KEY (NOT NULL — these tables are new, so a row with no readable id is simply
-- forbidden) because these are the only rows a human has to find again mid-incident.
-- `shelter` (table 16) is REUSED for the shelter board rather than duplicated.
-- =============================================================================
CREATE TABLE supply_lot (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id   text        NOT NULL UNIQUE,          -- 'supply-water-1l' — what the operator sees
    region_id   uuid        REFERENCES region(id) ON DELETE CASCADE,  -- curation scope; the route takes no region
    quantity    integer     CHECK (quantity IS NULL OR quantity >= 0),
    unit        text        CHECK (unit IN ('EACH','CASE','PALLET','LITRE','KILOGRAM')),
    expires_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- makeSupplyFields refuses a quantity with no unit; the same rule in SQL, because a human types here.
    CONSTRAINT chk_supply_lot_quantity_requires_unit CHECK (quantity IS NULL OR unit IS NOT NULL)
);
CREATE INDEX idx_supply_lot_region  ON supply_lot (region_id);
CREATE INDEX idx_supply_lot_expires ON supply_lot (expires_at);

CREATE TABLE volunteer_team (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id    text        NOT NULL UNIQUE,         -- 'team-alpha-3'
    region_id    uuid        REFERENCES region(id) ON DELETE CASCADE,
    callsign     text,
    headcount    integer     CHECK (headcount IS NULL OR headcount >= 0),  -- a TALLY, never a roster
    skills       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    availability text        CHECK (availability IN ('AVAILABLE','COMMITTED','OFF_DUTY')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_volunteer_team_region       ON volunteer_team (region_id);
CREATE INDEX idx_volunteer_team_availability ON volunteer_team (availability);

CREATE TABLE damage_assessment_entry (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id          text        NOT NULL UNIQUE,   -- the report id ('rep-001') — already the readable key
    -- TEXT, not a uuid FK: the incident COP is derived per-read in memory even under FEATURE_STORE=postgres,
    -- so a live incident routinely has no `incident` row for a FK to point at.
    incident_domain_id text        NOT NULL,
    report_status      text        NOT NULL CHECK (report_status IN ('UNVERIFIED','TRIAGED','VERIFIED','REJECTED')),
    category           text        NOT NULL CHECK (category IN ('SOS','DAMAGE','NEED')),
    severity           text        CHECK (severity IN ('MINOR','MODERATE','SEVERE','DESTROYED')),
    need_kind          text        CHECK (need_kind IN ('WATER','FOOD','SHELTER','HEALTH','POWER','ACCESS')),
    site_count         integer     CHECK (site_count IS NULL OR site_count >= 0),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_damage_entry_incident ON damage_assessment_entry (incident_domain_id);
CREATE INDEX idx_damage_entry_status   ON damage_assessment_entry (report_status);

CREATE TABLE ems_overlay_product (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id        text        NOT NULL UNIQUE,     -- the publisher's own product id
    region_id        uuid        REFERENCES region(id) ON DELETE CASCADE,
    activation_code  text        NOT NULL,
    product_type     text        NOT NULL CHECK (product_type IN ('DELINEATION','GRADING')),
    area_of_interest text        NOT NULL,
    produced_at      timestamptz NOT NULL,
    provider         text        NOT NULL,
    licence          text        NOT NULL,            -- an unlicensed overlay may not be displayed (Art. XI)
    view_url         text        NOT NULL,            -- LINK-ONLY: never mirrored, never dereferenced
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ems_product_region   ON ems_overlay_product (region_id);
CREATE INDEX idx_ems_product_produced ON ems_overlay_product (produced_at DESC);

-- =============================================================================
-- Seed data + the PostGIS geometry/GIST switch are single-sourced in
-- schemas/MIGRATION_PLAN.md (§5 Seed strategy, §4 GeoJSON-jsonb ↔ PostGIS switch)
-- — not duplicated here. The reference seed there uses the Romania (EU) flood region
-- (D-25) seeded with copernicus-glofas / "Copernicus GloFAS" (flood) and
-- copernicus-effis / "Copernicus EFFIS" (fire) + meteoalarm-ro; GloFAS (global) is
-- distinct from EFAS (European) — EFAS is the live European upgrade, not the seed.
-- The inline  -- [POSTGIS]  per-column markers
-- above stay as the authoritative per-column reference for that switch.
-- =============================================================================
