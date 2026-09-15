-- BEACON — migration 0003: STORM hazard family (ADR-032, FR-STORM-1 / FU-9).
-- ADDITIVE ONLY: widens the two closed-enum CHECK constraints that mirror INCIDENT_TYPES and HAZARD_KINDS.
-- A CHECK cannot be widened in place, so each is dropped and re-added with the extra allowed values; no
-- existing row can violate the new constraints (they are supersets), so the migration cannot fail on data.
-- 0000_init.sql is never rewritten — replaying 0000→0003 yields the same schema as a fresh 0000 with these
-- values inlined (schemas/schema.sql is the human-authored reference DDL and shows the final state).
ALTER TABLE "incident" DROP CONSTRAINT "chk_incident_type";--> statement-breakpoint
ALTER TABLE "incident" ADD CONSTRAINT "chk_incident_type" CHECK ("incident"."type" IN ('WILDFIRE', 'FLOOD', 'STORM'));--> statement-breakpoint
ALTER TABLE "hazard_geometry" DROP CONSTRAINT "chk_hazard_geometry_kind";--> statement-breakpoint
ALTER TABLE "hazard_geometry" ADD CONSTRAINT "chk_hazard_geometry_kind" CHECK ("hazard_geometry"."kind" IN ('HOTSPOT', 'PERIMETER', 'FLOOD_REACH', 'SPREAD_CONE', 'TRACK', 'CONE', 'STORM_SURGE'));
