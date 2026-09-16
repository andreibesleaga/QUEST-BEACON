-- BEACON — one CURRENT row per source, so live provenance can upsert (ADR-039; V2·A2).
--
-- `/sources` came up EMPTY under FEATURE_STORE=postgres because nothing wrote provenance at runtime. The
-- write path added with this migration upserts on the source's natural key rather than appending a row per
-- fetch: bounded growth on a long-running deployment, and — decisively — a STABLE uuid per source, which is
-- what `citation.source_id` must reference (the second half of ADR-039 closes the recorded FK defect using
-- exactly this key).
--
-- Deduplicate BEFORE constraining, because an existing database may already hold repeats. Order of
-- operations matters: every FK that points at a loser is REPOINTED at the survivor first, and only then are
-- the losers deleted. `citation.source_id` is NOT NULL ON DELETE RESTRICT, so deleting first would either
-- abort the migration or, on a laxer FK, silently strand a citation — and a citation that cannot name its
-- source is the one kind of row this project must never produce (Art. XI).
-- The survivor of each group is the most recently fetched row (ties: created_at, then id), i.e. the
-- freshest truth about that source.

WITH keep AS (
  SELECT DISTINCT ON ("source") "source", "id" AS keep_id
    FROM "source_record" ORDER BY "source", "fetched_at" DESC, "created_at" DESC, "id"
), remap AS (
  SELECT s."id" AS old_id, k.keep_id
    FROM "source_record" s JOIN keep k ON k."source" = s."source"
   WHERE s."id" <> k.keep_id
)
UPDATE "hazard_geometry" t SET "source_id" = r.keep_id FROM remap r WHERE t."source_id" = r.old_id;

WITH keep AS (
  SELECT DISTINCT ON ("source") "source", "id" AS keep_id
    FROM "source_record" ORDER BY "source", "fetched_at" DESC, "created_at" DESC, "id"
), remap AS (
  SELECT s."id" AS old_id, k.keep_id
    FROM "source_record" s JOIN keep k ON k."source" = s."source"
   WHERE s."id" <> k.keep_id
)
UPDATE "gauge" t SET "source_id" = r.keep_id FROM remap r WHERE t."source_id" = r.old_id;

WITH keep AS (
  SELECT DISTINCT ON ("source") "source", "id" AS keep_id
    FROM "source_record" ORDER BY "source", "fetched_at" DESC, "created_at" DESC, "id"
), remap AS (
  SELECT s."id" AS old_id, k.keep_id
    FROM "source_record" s JOIN keep k ON k."source" = s."source"
   WHERE s."id" <> k.keep_id
)
UPDATE "infrastructure_node" t SET "source_id" = r.keep_id FROM remap r WHERE t."source_id" = r.old_id;

WITH keep AS (
  SELECT DISTINCT ON ("source") "source", "id" AS keep_id
    FROM "source_record" ORDER BY "source", "fetched_at" DESC, "created_at" DESC, "id"
), remap AS (
  SELECT s."id" AS old_id, k.keep_id
    FROM "source_record" s JOIN keep k ON k."source" = s."source"
   WHERE s."id" <> k.keep_id
)
UPDATE "prediction" t SET "source_id" = r.keep_id FROM remap r WHERE t."source_id" = r.old_id;

WITH keep AS (
  SELECT DISTINCT ON ("source") "source", "id" AS keep_id
    FROM "source_record" ORDER BY "source", "fetched_at" DESC, "created_at" DESC, "id"
), remap AS (
  SELECT s."id" AS old_id, k.keep_id
    FROM "source_record" s JOIN keep k ON k."source" = s."source"
   WHERE s."id" <> k.keep_id
)
UPDATE "public_report" t SET "source_id" = r.keep_id FROM remap r WHERE t."source_id" = r.old_id;

WITH keep AS (
  SELECT DISTINCT ON ("source") "source", "id" AS keep_id
    FROM "source_record" ORDER BY "source", "fetched_at" DESC, "created_at" DESC, "id"
), remap AS (
  SELECT s."id" AS old_id, k.keep_id
    FROM "source_record" s JOIN keep k ON k."source" = s."source"
   WHERE s."id" <> k.keep_id
)
UPDATE "citation" t SET "source_id" = r.keep_id FROM remap r WHERE t."source_id" = r.old_id;

-- Now, and only now, delete the losers. Every FK above has been repointed at its survivor, so no
-- ON DELETE RESTRICT can fire and no citation is stranded.
--
-- This statement was MISSING from the original migration (defect B3, found by the A2 all-lens review
-- 2026-09-10): the file went straight from the six repoints to ADD CONSTRAINT, so on any database that
-- actually held duplicates — the only database this dedup block exists for — the constraint build failed
-- with `Key (source)=(firms) is duplicated` and the whole migration rolled back, taking 0008 and 0009 with
-- it. The header above described the correct algorithm; the file implemented five sixths of it.
DELETE FROM "source_record" s
 USING (
   SELECT DISTINCT ON ("source") "source", "id" AS keep_id
     FROM "source_record" ORDER BY "source", "fetched_at" DESC, "created_at" DESC, "id"
 ) k
 WHERE k."source" = s."source" AND s."id" <> k.keep_id;

ALTER TABLE "source_record" ADD CONSTRAINT "uq_source_record_source" UNIQUE ("source");
