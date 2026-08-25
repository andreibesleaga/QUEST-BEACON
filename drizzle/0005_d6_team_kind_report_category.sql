-- BEACON — migration 0005: FR-D6-1 volunteer TEAM resource kind, FR-D4-4 report category, FR-D6-5 casualty
-- tally (ADR-035 §4, ADR-036 §7; findings F-171 / F-151 / F-174).
--
-- ADDITIVE ONLY.
--  • `resource.kind` — a CHECK cannot be widened in place, so it is dropped and re-added with 'TEAM'. The new
--    constraint is a SUPERSET of the old one, so no existing row can violate it and the migration cannot fail
--    on data. The value list is no longer hand-written anywhere in TypeScript: `logistics-tables.ts` now hands
--    `RESOURCE_KINDS` (src/domain/resource.ts) to `checkEnum`, so this DDL is the only remaining copy and it
--    is pinned to the domain array by tests/architecture/domain-db-enum-pin.test.ts.
--  • `public_report.category` — NULLABLE, so every existing row is valid as-is (an uncategorised report is
--    not an assumed 'SOS'). `col IN (...)` passes NULL, so the CHECK needs no extra allowance.
--  • `public_report.casualty_count` / `casualty_as_of` — the FR-D6-5 tally. Note what is NOT here: there is
--    no column for the mandatory "unverified — not authoritative" caveat. It is deliberately unstorable, so
--    no row can carry the number without it; `makePublicReport` stamps it on every hydration.
--
-- 0000_init.sql is never rewritten — replaying 0000→0005 yields the same schema as a fresh 0000 with these
-- values inlined (schemas/schema.sql is the human-authored reference DDL and shows the final state).
-- Hand-completed for the same reason as 0003/0004: drizzle-kit emits `IN ($1, $2, …)` placeholders for a
-- sql`` CHECK body, which is not valid migration SQL.
ALTER TABLE "resource" DROP CONSTRAINT "chk_resource_kind";--> statement-breakpoint
ALTER TABLE "public_report" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "public_report" ADD COLUMN "casualty_count" integer;--> statement-breakpoint
ALTER TABLE "public_report" ADD COLUMN "casualty_as_of" text;--> statement-breakpoint
ALTER TABLE "public_report" ADD CONSTRAINT "chk_public_report_category" CHECK ("public_report"."category" IN ('SOS', 'DAMAGE', 'NEED'));--> statement-breakpoint
ALTER TABLE "public_report" ADD CONSTRAINT "chk_public_report_casualty_count_nonneg" CHECK ("public_report"."casualty_count" IS NULL OR "public_report"."casualty_count" >= 0);--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "chk_resource_kind" CHECK ("resource"."kind" IN ('CREW', 'ENGINE', 'AIRCRAFT', 'MEDICAL', 'SUPPLY', 'TEAM'));
