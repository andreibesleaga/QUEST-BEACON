CREATE TABLE "alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"threshold_rule_id" uuid,
	"cap_status" text DEFAULT 'DRAFT' NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"area" jsonb,
	"edxl_kind" text DEFAULT 'CAP' NOT NULL,
	"sent_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_alert_cap_status" CHECK ("alert"."cap_status" IN ('DRAFT', 'ACTUAL')),
	CONSTRAINT "chk_alert_category" CHECK ("alert"."category" IN ('Fire', 'Met', 'Safety')),
	CONSTRAINT "chk_alert_severity" CHECK ("alert"."severity" IN ('MINOR', 'MODERATE', 'SEVERE', 'EXTREME')),
	CONSTRAINT "chk_alert_edxl_kind" CHECK ("alert"."edxl_kind" IN ('CAP', 'EDXL_RM', 'EDXL_SITREP')),
	CONSTRAINT "chk_alert_actual_approved" CHECK ("alert"."cap_status" <> 'ACTUAL' OR "alert"."approved_by" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text DEFAULT 'PUBLIC' NOT NULL,
	"org" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_app_user_role" CHECK ("app_user"."role" IN ('PUBLIC', 'RESPONDER', 'VERIFIER', 'EM'))
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"cost_tokens_in" integer,
	"cost_tokens_out" integer,
	"cost_usd" numeric,
	"model_tier" text,
	"prev_hash" text,
	"hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_audit_event_model_tier" CHECK ("audit_event"."model_tier" IN ('CLOUD', 'LOCAL', 'DETERMINISTIC', 'VISION'))
);
--> statement-breakpoint
CREATE TABLE "citation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sitrep_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"field" text NOT NULL,
	"claim" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evac_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"geom" jsonb NOT NULL,
	"avoids_hazard" boolean DEFAULT true NOT NULL,
	"suggested_start" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exposure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"inside_hazard" boolean DEFAULT false NOT NULL,
	"distance_m" double precision,
	"reason" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_exposure_incident_node" UNIQUE("incident_id","node_id"),
	CONSTRAINT "chk_exposure_reason" CHECK ("exposure"."reason" IN ('IN_POLYGON', 'IN_BUFFER', 'OUTAGE'))
);
--> statement-breakpoint
CREATE TABLE "gauge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"geom" jsonb NOT NULL,
	"stage" double precision,
	"flood_category" text DEFAULT 'NONE' NOT NULL,
	"crest_forecast" double precision,
	"crest_time" timestamp with time zone,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_gauge_flood_category" CHECK ("gauge"."flood_category" IN ('NONE', 'ACTION', 'MINOR', 'MODERATE', 'MAJOR'))
);
--> statement-breakpoint
CREATE TABLE "hazard_geometry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"geom" jsonb NOT NULL,
	"bbox" jsonb,
	"intensity" double precision,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_hazard_geometry_kind" CHECK ("hazard_geometry"."kind" IN ('HOTSPOT', 'PERIMETER', 'FLOOD_REACH', 'SPREAD_CONE'))
);
--> statement-breakpoint
CREATE TABLE "incident" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_incident_type" CHECK ("incident"."type" IN ('WILDFIRE', 'FLOOD')),
	CONSTRAINT "chk_incident_status" CHECK ("incident"."status" IN ('ACTIVE', 'CONTAINED', 'CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "infrastructure_node" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"geom" jsonb NOT NULL,
	"status" text DEFAULT 'ONLINE' NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_infrastructure_node_type" CHECK ("infrastructure_node"."type" IN ('HOSPITAL', 'NURSING_HOME', 'POWER', 'CELL', 'ROAD', 'RAIL', 'SHELTER')),
	CONSTRAINT "chk_infrastructure_node_status" CHECK ("infrastructure_node"."status" IN ('ONLINE', 'AT_RISK', 'OFFLINE'))
);
--> statement-breakpoint
CREATE TABLE "prediction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"geom" jsonb,
	"method" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uncertainty" double precision,
	"horizon" timestamp with time zone,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_prediction_kind" CHECK ("prediction"."kind" IN ('FIRE_CONE', 'FLOOD_INUNDATION', 'IMPACT_OVER_TIME', 'ESCALATION'))
);
--> statement-breakpoint
CREATE TABLE "public_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid,
	"source" text NOT NULL,
	"status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"confidence" double precision,
	"confidence_components" jsonb,
	"geom_generalized" jsonb,
	"geom_precise" jsonb,
	"consent" boolean DEFAULT false NOT NULL,
	"purge_after" timestamp with time zone,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_public_report_source" CHECK ("public_report"."source" IN ('WEB', 'SMS', 'SOCIAL')),
	CONSTRAINT "chk_public_report_status" CHECK ("public_report"."status" IN ('UNVERIFIED', 'TRIAGED', 'VERIFIED', 'REJECTED')),
	CONSTRAINT "chk_public_report_confidence" CHECK ("public_report"."confidence" IS NULL OR ("public_report"."confidence" >= 0 AND "public_report"."confidence" <= 1)),
	CONSTRAINT "chk_public_report_consent" CHECK ("public_report"."consent" = true)
);
--> statement-breakpoint
CREATE TABLE "region" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"bbox" jsonb,
	"enabled_adapters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_mode_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_region_scope" CHECK ("region"."scope" IN ('COMMUNITY', 'STATE', 'COUNTRY'))
);
--> statement-breakpoint
CREATE TABLE "resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"geom" jsonb,
	"org" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_resource_kind" CHECK ("resource"."kind" IN ('CREW', 'ENGINE', 'AIRCRAFT', 'MEDICAL', 'SUPPLY')),
	CONSTRAINT "chk_resource_status" CHECK ("resource"."status" IN ('AVAILABLE', 'ASSIGNED', 'OOS'))
);
--> statement-breakpoint
CREATE TABLE "resource_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"shelter_id" uuid,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"target" jsonb,
	"edxl_rm_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_resource_task_status" CHECK ("resource_task"."status" IN ('PROPOSED', 'TASKED', 'ENROUTE', 'ONSCENE', 'CLEARED'))
);
--> statement-breakpoint
CREATE TABLE "shelter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"geom" jsonb NOT NULL,
	"capacity" integer,
	"occupancy" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"org" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_shelter_status" CHECK ("shelter"."status" IN ('OPEN', 'FULL', 'CLOSED')),
	CONSTRAINT "chk_shelter_capacity_nonneg" CHECK ("shelter"."capacity" IS NULL OR "shelter"."capacity" >= 0),
	CONSTRAINT "chk_shelter_occupancy_nonneg" CHECK ("shelter"."occupancy" >= 0),
	CONSTRAINT "chk_shelter_occupancy_le_capacity" CHECK ("shelter"."capacity" IS NULL OR "shelter"."occupancy" <= "shelter"."capacity")
);
--> statement-breakpoint
CREATE TABLE "sitrep" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text,
	"priorities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trend" text,
	"ai_mode" text DEFAULT 'deterministic-only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sitrep_trend" CHECK ("sitrep"."trend" IN ('ESCALATING', 'STEADY', 'DEESCALATING')),
	CONSTRAINT "chk_sitrep_ai_mode" CHECK ("sitrep"."ai_mode" IN ('cloud', 'local', 'deterministic-only'))
);
--> statement-breakpoint
CREATE TABLE "source_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"adapter" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"license" text,
	"mode" text DEFAULT 'LIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_source_record_mode" CHECK ("source_record"."mode" IN ('LIVE', 'CACHED', 'MOCK'))
);
--> statement-breakpoint
CREATE TABLE "threshold_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"operator" text NOT NULL,
	"value" text NOT NULL,
	"scope" uuid,
	"hysteresis" text,
	"cooldown" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_threshold_rule_target" CHECK ("threshold_rule"."target" IN ('GAUGE_CATEGORY', 'HAZARD_BUFFER')),
	CONSTRAINT "chk_threshold_rule_operator" CHECK ("threshold_rule"."operator" IN ('crosses', 'gte', 'enters'))
);
--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_threshold_rule_id_threshold_rule_id_fk" FOREIGN KEY ("threshold_rule_id") REFERENCES "public"."threshold_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_sitrep_id_sitrep_id_fk" FOREIGN KEY ("sitrep_id") REFERENCES "public"."sitrep"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_source_id_source_record_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evac_route" ADD CONSTRAINT "evac_route_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposure" ADD CONSTRAINT "exposure_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposure" ADD CONSTRAINT "exposure_node_id_infrastructure_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."infrastructure_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gauge" ADD CONSTRAINT "gauge_source_id_source_record_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazard_geometry" ADD CONSTRAINT "hazard_geometry_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazard_geometry" ADD CONSTRAINT "hazard_geometry_source_id_source_record_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident" ADD CONSTRAINT "incident_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_node" ADD CONSTRAINT "infrastructure_node_source_id_source_record_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_source_id_source_record_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_report" ADD CONSTRAINT "public_report_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_report" ADD CONSTRAINT "public_report_source_id_source_record_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_task" ADD CONSTRAINT "resource_task_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_task" ADD CONSTRAINT "resource_task_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_task" ADD CONSTRAINT "resource_task_shelter_id_shelter_id_fk" FOREIGN KEY ("shelter_id") REFERENCES "public"."shelter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitrep" ADD CONSTRAINT "sitrep_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threshold_rule" ADD CONSTRAINT "threshold_rule_scope_region_id_fk" FOREIGN KEY ("scope") REFERENCES "public"."region"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_alert_incident" ON "alert" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_alert_status" ON "alert" USING btree ("cap_status");--> statement-breakpoint
CREATE INDEX "idx_alert_severity" ON "alert" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_alert_sent" ON "alert" USING btree ("sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_alert_approved_by" ON "alert" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "idx_app_user_role" ON "app_user" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_event" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_audit_at" ON "audit_event" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_target" ON "audit_event" USING btree ("target");--> statement-breakpoint
CREATE INDEX "idx_citation_sitrep" ON "citation" USING btree ("sitrep_id");--> statement-breakpoint
CREATE INDEX "idx_citation_source" ON "citation" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_citation_field" ON "citation" USING btree ("sitrep_id","field");--> statement-breakpoint
CREATE INDEX "idx_evacroute_incident" ON "evac_route" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_exposure_incident" ON "exposure" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_exposure_node" ON "exposure" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_exposure_inside" ON "exposure" USING btree ("incident_id","inside_hazard");--> statement-breakpoint
CREATE INDEX "idx_gauge_category" ON "gauge" USING btree ("flood_category");--> statement-breakpoint
CREATE INDEX "idx_gauge_source" ON "gauge" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_hazgeom_incident" ON "hazard_geometry" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_hazgeom_kind" ON "hazard_geometry" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_hazgeom_observed" ON "hazard_geometry" USING btree ("observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_hazgeom_source" ON "hazard_geometry" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_hazgeom_bbox_gin" ON "hazard_geometry" USING gin ("bbox" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "idx_incident_region_id" ON "incident" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "idx_incident_status" ON "incident" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_incident_updated" ON "incident" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_infranode_type" ON "infrastructure_node" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_infranode_status" ON "infrastructure_node" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_infranode_source" ON "infrastructure_node" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_incident" ON "prediction" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_kind" ON "prediction" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_prediction_horizon" ON "prediction" USING btree ("horizon");--> statement-breakpoint
CREATE INDEX "idx_public_report_incident" ON "public_report" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_public_report_status" ON "public_report" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_public_report_purge" ON "public_report" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "idx_public_report_source" ON "public_report" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_region_scope" ON "region" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "idx_resource_kind" ON "resource" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_resource_status" ON "resource" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_restask_resource" ON "resource_task" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_restask_incident" ON "resource_task" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_restask_shelter" ON "resource_task" USING btree ("shelter_id");--> statement-breakpoint
CREATE INDEX "idx_restask_status" ON "resource_task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_restask_edxlref" ON "resource_task" USING btree ("edxl_rm_ref");--> statement-breakpoint
CREATE INDEX "idx_shelter_status" ON "shelter" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sitrep_incident" ON "sitrep" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_sitrep_generated" ON "sitrep" USING btree ("generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_source_record_fetched_at" ON "source_record" USING btree ("fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_source_record_adapter" ON "source_record" USING btree ("adapter");--> statement-breakpoint
CREATE INDEX "idx_source_record_mode" ON "source_record" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "idx_threshold_rule_scope" ON "threshold_rule" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "idx_threshold_rule_target" ON "threshold_rule" USING btree ("target");