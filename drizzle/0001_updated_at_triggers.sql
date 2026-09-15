-- BEACON — updated_at maintenance trigger (E3·T-107). Mirrors schemas/schema.sql L452-474.
-- drizzle-kit does not manage triggers/functions (MIGRATION_PLAN §2) — authored as a custom migration.
-- Keeps updated_at correct on SQL-only write paths (app code may also set it).

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Attach to every table that carries updated_at (11 tables).
CREATE TRIGGER trg_region_updated        BEFORE UPDATE ON region              FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_incident_updated      BEFORE UPDATE ON incident            FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_gauge_updated         BEFORE UPDATE ON gauge               FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_infranode_updated     BEFORE UPDATE ON infrastructure_node FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_app_user_updated      BEFORE UPDATE ON app_user            FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_public_report_updated BEFORE UPDATE ON public_report       FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_threshold_updated     BEFORE UPDATE ON threshold_rule      FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_alert_updated         BEFORE UPDATE ON alert               FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_resource_updated      BEFORE UPDATE ON resource            FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_shelter_updated       BEFORE UPDATE ON shelter             FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_resource_task_updated BEFORE UPDATE ON resource_task       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
