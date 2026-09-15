-- BEACON — `region` gets the same natural key `incident` just gained (ADR-039 §2a; V2·A2).
--
-- WHY THIS FOLLOWS 0008. Persisting an incident requires naming its region, and `incident.region_id` is a
-- uuid FK while the COP addresses regions by their CONFIG id (`us-ca`, `ro`, `es`, `gr`, `ph`). The seed had
-- papered over this with a hardcoded two-entry map from config id to a fixed uuid, with the remaining
-- regions taking POSITIONAL ids — so adding a region to config/regions.json silently reshuffled which uuid
-- every later region owned. That is the same natural-key gap as 0008, one table over, plus a latent
-- ordering hazard.
--
-- Backfilled by the seed runner, which is the only writer of this table.
ALTER TABLE "region" ADD COLUMN "domain_id" text;
CREATE UNIQUE INDEX "uq_region_domain_id" ON "region" ("domain_id");
