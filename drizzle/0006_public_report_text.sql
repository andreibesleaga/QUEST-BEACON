-- BEACON — persist the reporter's claim so the HITL gate has something to judge (Art. XIII).
-- `PublicReportIntake.text` has been REQUIRED since S03 and every channel supplies it, but no column
-- existed, so the claim was validated at the edge and discarded. The verifier queue consequently asked
-- humans to approve/reject reports whose content they could not read.
-- Art. XIV is satisfied by lifecycle + audience, as it already is for geom_precise: this column is purged
-- with its row at purge_after, and GET /reports is VERIFIER+ only. Nullable — existing rows carry none.
ALTER TABLE "public_report" ADD COLUMN "report_text" text;