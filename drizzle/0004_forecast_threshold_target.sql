-- BEACON — migration 0004: FORECAST_GAUGE_CATEGORY threshold target (ADR-033 §6, FEV-9 / C2.4).
-- ADDITIVE ONLY: widens the closed-enum CHECK constraint that mirrors THRESHOLD_TARGETS
-- (src/domain/threshold-rule.ts). A CHECK cannot be widened in place, so it is dropped and re-added with the
-- extra allowed value; no existing row can violate the new constraint (it is a superset), so the migration
-- cannot fail on data. 0000_init.sql is never rewritten — replaying 0000→0004 yields the same schema as a
-- fresh 0000 with this value inlined (schemas/schema.sql is the human-authored reference DDL, final state).
-- Hand-completed for the same reason as 0003: drizzle-kit emits `IN ($1, $2, $3)` placeholders for a
-- sql`` CHECK body, which is not valid migration SQL.
ALTER TABLE "threshold_rule" DROP CONSTRAINT "chk_threshold_rule_target";--> statement-breakpoint
ALTER TABLE "threshold_rule" ADD CONSTRAINT "chk_threshold_rule_target" CHECK ("threshold_rule"."target" IN ('GAUGE_CATEGORY', 'HAZARD_BUFFER', 'FORECAST_GAUGE_CATEGORY'));
