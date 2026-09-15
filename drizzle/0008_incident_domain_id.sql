-- BEACON — give `incident` a natural key, so a SitRep can be persisted against it (ADR-039 §2a; V2·A2).
--
-- THE DEFECT THIS CLOSES (recorded 2026-08-08, UNIMPLEMENTED_REGISTER): `sitrep.incident_id` is a uuid FK,
-- but BEACON addresses incidents by DOMAIN id — `us-ca-wildfire-demo`. The insert was rejected before the
-- FK was even consulted, which is why `makePgSitRepHistoryStore` was built and then composed nowhere: there
-- was no way to write a row that would survive.
--
-- WHY A COLUMN AND NOT A WIDENED FK. Making `incident_id` text would delete the referential guarantee that
-- every citation chain in this product depends on. Deriving a uuid from the domain id (uuid-v5) would work
-- for machines and be useless to the humans this database is meant to be browsable by: an operator opening
-- the table in Directus would see a hash where the incident's name belongs. A natural-key column keeps the
-- surrogate key for the FKs, keeps the readable id for the operator, and gives the writer a single stable
-- target to upsert on.
--
-- NULLABLE by design: rows that predate this column keep working, and an incident that genuinely has no
-- domain id (DB-minted only) stays legal. The UNIQUE index tolerates that — Postgres treats NULLs as
-- distinct, so any number of rows may leave it empty while every populated value stays unambiguous.
ALTER TABLE "incident" ADD COLUMN "domain_id" text;
CREATE UNIQUE INDEX "uq_incident_domain_id" ON "incident" ("domain_id");
