# S03 Consistency Audit — findings & fix backlog

*Read-only cross-audit of the S03 artifacts (`docs/SPEC.md`, `docs/api/openapi.yaml`, `schemas/*`) vs
upstream (`DOMAIN_MODEL.md`, `PRD.md`, `CLARIFICATIONS.md`), run 2026-06-27 at the S03 pause.*

**Verdict: SHIP-READY — all consistency fixes APPLIED (2026-06-27).** Architecture is sound; all 19
entities round-trip across DDL+OpenAPI; envelope/citation + constitutional invariants (provenance,
no-LLM-numbers, no-ACTUAL-without-approver, responder-only PII, full EDXL-RM round-trip) are encoded. The
spec-text/contract mismatches below (#1–#9, #14b — none architectural) have all been reconciled across
SPEC / openapi.yaml / DOMAIN_MODEL / schemas; see the **✅ Fixed** section. OpenAPI re-validated clean.

## ✅ Fixed

All consistency reconciliations (#1–#9, #14b — table count, EDXL RBAC, PATCH/reports 202 semantics,
degraded-200-vs-503, `prediction.source_id`, `alert.threshold_rule_id`, EDXL `messageType` enum,
envelope `sourceId`/UPPERCASE-mode casing, `apiEnvelope` meta, `/admin/*` de-namespacing) were
**applied 2026-06-27** across SPEC / openapi.yaml / DOMAIN_MODEL / schemas — see git history / `AUDIT_LOG`.
None were architectural; OpenAPI re-validated clean (redocly: 0 errors).

## 🟢 Verified clean (no action)
Priority weights 0.45/0.35/0.20 + confidence 0.40/0.30/0.20/0.10 match CLARIF/PRD; all core enums match
across DOMAIN_MODEL↔DDL↔OpenAPI; constitutional invariants encoded (envelope required, citations[],
409-no-ACTUAL-without-approver + DDL `chk_alert_actual_approved` + CAP Draft-default, responder-only PII);
ADR citations + CAP v1.2/EDXL 1.0 consistent; endpoint parity (OpenAPI is a superset of SPEC/PRD).

> The 4 JSON-Schemas are Ajv-valid; `openapi.yaml` lints clean (redocly, 0 errors); `schema.sql` defines
> exactly the 19 canonical tables. The items above are contract-wording reconciliations, not rebuilds.
