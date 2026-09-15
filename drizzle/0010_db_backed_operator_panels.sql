-- BEACON — migration 0010: the five dock panels become OPERATOR-MAINTAINED tables (ADR-041; V2·A12).
--
-- WHAT WAS WRONG. `src/adapters/channels/http/routes/panels.ts` read five `fixtures/coordination/*.json`
-- documents with a top-level `readFileSync` and froze the rows into the process at import time. The panels
-- rendered and were inert: an emergency manager could not change a shelter's occupancy, book in a delivered
-- supply lot, or stand a volunteer team down. Nothing there overstated — every response already said
-- `mode: 'MOCK'` — the product simply could not be operated.
--
-- ADDITIVE ONLY. Four new tables plus one widened CHECK; no column is dropped, renamed or retyped, and the
-- fifth dataset reuses the `shelter` table that has existed since 0000 rather than standing up a second one.
--
-- EVERY TABLE HAS A NATURAL KEY, for the reason 0008/0009 gave `incident` and `region` theirs: these rows
-- are edited by a human in Directus, and an operator must see `supply-water-1l`, not a bare uuid. The
-- surrogate uuid stays the primary key so FKs and Directus both keep working; the natural key is what the
-- panel adapter addresses a row by, and what makes an upsert-by-name possible for the seeder.
--
-- NOT NULLABLE, unlike 0008/0009. Those columns were retrofitted onto tables that already held rows, so
-- they had to tolerate NULL. These tables are new: every row has a natural key from the first insert, and a
-- panel row with no readable id is exactly the row an operator cannot find again.

-- ── The served-provenance vocabulary gains DB (ADR-041 §3) ──────────────────────────────────────────────
-- `source_record.mode` records what ACTUALLY served a source, which is the SERVED axis, not the adapter
-- ladder's. `ProvenanceEntry.mode` — the only shape written into this column — is now the four-value
-- `ServedMode`, so the constraint follows it or the type would typecheck and the INSERT would fail. A CHECK
-- cannot be widened in place; the new list is a strict SUPERSET, so no existing row can violate it and the
-- migration cannot fail on data (the 0005 precedent). The LADDER vocabulary is deliberately untouched:
-- `SOURCE_<NAME>_MODE`, `adapter-manifest.schema.json` and `regions.schema.json` still allow exactly three
-- values, because no adapter can fetch `DB` and a configuration that cannot mean anything is worse than a
-- missing one.
ALTER TABLE "source_record" DROP CONSTRAINT "chk_source_record_mode";--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "chk_source_record_mode" CHECK ("source_record"."mode" IN ('LIVE', 'CACHED', 'MOCK', 'DB'));
--> statement-breakpoint

-- ── The five panel datasets ─────────────────────────────────────────────────────────────────────────────
-- `shelter` (table 16, since 0000) is REUSED rather than duplicated — a second shelter table would be two
-- sources of truth for one fact, and the board would eventually show whichever one the last writer touched.
-- It gains the same natural key, NULLABLE because it already holds seeded rows (the 0008/0009 posture).
ALTER TABLE "shelter" ADD COLUMN "domain_id" text;--> statement-breakpoint
ALTER TABLE "shelter" ADD CONSTRAINT "uq_shelter_domain_id" UNIQUE("domain_id");--> statement-breakpoint

-- 20. SUPPLY_LOT — relief supply stock (FR-D6-2). STOCK ONLY: no donor, no payment, no recipient column
-- exists or ever will (ADR-035 §4); `quantity` is deliberately not named `amount`.
CREATE TABLE "supply_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" text NOT NULL,
	"region_id" uuid,
	"quantity" integer,
	"unit" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_supply_lot_domain_id" UNIQUE("domain_id"),
	CONSTRAINT "chk_supply_lot_unit" CHECK ("supply_lot"."unit" IN ('EACH', 'CASE', 'PALLET', 'LITRE', 'KILOGRAM')),
	CONSTRAINT "chk_supply_lot_quantity_nonneg" CHECK ("supply_lot"."quantity" IS NULL OR "supply_lot"."quantity" >= 0),
	CONSTRAINT "chk_supply_lot_quantity_requires_unit" CHECK ("supply_lot"."quantity" IS NULL OR "supply_lot"."unit" IS NOT NULL)
);--> statement-breakpoint

-- 21. VOLUNTEER_TEAM — team UNITS (FR-D6-1): a callsign, a tally, capability tags. No roster, ever.
CREATE TABLE "volunteer_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" text NOT NULL,
	"region_id" uuid,
	"callsign" text,
	"headcount" integer,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"availability" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_volunteer_team_domain_id" UNIQUE("domain_id"),
	CONSTRAINT "chk_volunteer_team_availability" CHECK ("volunteer_team"."availability" IN ('AVAILABLE', 'COMMITTED', 'OFF_DUTY')),
	CONSTRAINT "chk_volunteer_team_headcount_nonneg" CHECK ("volunteer_team"."headcount" IS NULL OR "volunteer_team"."headcount" >= 0)
);--> statement-breakpoint

-- 22. DAMAGE_ASSESSMENT_ENTRY — one observation plus the TRIAGE STATE it was seen in (FR-D4-4). The state
-- travels with the row so the verified/unverified split stays structural and can never be summed (Art. XIII).
-- `incident_domain_id` is text, NOT a uuid FK: the incident COP is derived per-read in memory even under
-- FEATURE_STORE=postgres, so a live incident routinely has no `incident` row for a FK to point at.
CREATE TABLE "damage_assessment_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" text NOT NULL,
	"incident_domain_id" text NOT NULL,
	"report_status" text NOT NULL,
	"category" text NOT NULL,
	"severity" text,
	"need_kind" text,
	"site_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_damage_entry_domain_id" UNIQUE("domain_id"),
	CONSTRAINT "chk_damage_entry_report_status" CHECK ("damage_assessment_entry"."report_status" IN ('UNVERIFIED', 'TRIAGED', 'VERIFIED', 'REJECTED')),
	CONSTRAINT "chk_damage_entry_category" CHECK ("damage_assessment_entry"."category" IN ('SOS', 'DAMAGE', 'NEED')),
	CONSTRAINT "chk_damage_entry_severity" CHECK ("damage_assessment_entry"."severity" IN ('MINOR', 'MODERATE', 'SEVERE', 'DESTROYED')),
	CONSTRAINT "chk_damage_entry_need_kind" CHECK ("damage_assessment_entry"."need_kind" IN ('WATER', 'FOOD', 'SHELTER', 'HEALTH', 'POWER', 'ACCESS')),
	CONSTRAINT "chk_damage_entry_site_count_nonneg" CHECK ("damage_assessment_entry"."site_count" IS NULL OR "damage_assessment_entry"."site_count" >= 0)
);--> statement-breakpoint

-- 23. EMS_OVERLAY_PRODUCT — published Copernicus EMS products, LINK-ONLY (FR-D4-5/FEV-24). `licence` is NOT
-- NULL: an overlay whose licence nobody recorded may not be displayed at all (Art. XI).
CREATE TABLE "ems_overlay_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" text NOT NULL,
	"region_id" uuid,
	"activation_code" text NOT NULL,
	"product_type" text NOT NULL,
	"area_of_interest" text NOT NULL,
	"produced_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	"licence" text NOT NULL,
	"view_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ems_product_domain_id" UNIQUE("domain_id"),
	CONSTRAINT "chk_ems_product_type" CHECK ("ems_overlay_product"."product_type" IN ('DELINEATION', 'GRADING'))
);--> statement-breakpoint

ALTER TABLE "supply_lot" ADD CONSTRAINT "supply_lot_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_team" ADD CONSTRAINT "volunteer_team_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ems_overlay_product" ADD CONSTRAINT "ems_overlay_product_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_supply_lot_region" ON "supply_lot" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "idx_supply_lot_expires" ON "supply_lot" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_volunteer_team_region" ON "volunteer_team" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "idx_volunteer_team_availability" ON "volunteer_team" USING btree ("availability");--> statement-breakpoint
CREATE INDEX "idx_damage_entry_incident" ON "damage_assessment_entry" USING btree ("incident_domain_id");--> statement-breakpoint
CREATE INDEX "idx_damage_entry_status" ON "damage_assessment_entry" USING btree ("report_status");--> statement-breakpoint
CREATE INDEX "idx_ems_product_region" ON "ems_overlay_product" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "idx_ems_product_produced" ON "ems_overlay_product" USING btree ("produced_at" DESC NULLS LAST);--> statement-breakpoint

-- ── updated_at triggers for the four new tables ─────────────────────────────────────────────────────────
-- NOT optional bookkeeping. A `DB` row's served provenance `fetchedAt` IS its `updated_at` (ADR-041 §3), so
-- a table without this trigger would keep reporting the INSERT instant after an operator edited the row —
-- a timestamp that looks like freshness and is not. drizzle-kit does not manage triggers (MIGRATION_PLAN
-- §2), so they are authored here exactly as 0001 authored the first eleven.
CREATE TRIGGER trg_supply_lot_updated    BEFORE UPDATE ON supply_lot              FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_volunteer_team_updated BEFORE UPDATE ON volunteer_team         FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_damage_entry_updated  BEFORE UPDATE ON damage_assessment_entry FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_ems_product_updated   BEFORE UPDATE ON ems_overlay_product     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
