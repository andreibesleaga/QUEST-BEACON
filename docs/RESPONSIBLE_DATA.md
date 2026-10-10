# BEACON — Responsible Data Policy (binding)

> The responsible-data rules BEACON is built to. This is the canonical index; each rule names where it is
> **enforced** (constitutional article · control · test), so the policy is executable, not aspirational.
> Referenced as binding by `agents/AGENTS.md §14`, `THREAT_MODEL.md`, ADR-008, and the Phase-2 concept
> (`../../Phase2/submission/RESPONSIBLE_DATA.md` is the accepted origin; this file operationalizes it).

| # | Rule | Enforced by |
|---|---|---|
| 1 | **Consent before intake.** No public/SOS report is accepted without explicit consent; submit is blocked without it. | Constitution **Art. XIV** · DB CHECK `consent=true` · E8 T-376 · `report-triage.feature` |
| 2 | **Unverified is visible.** Every crowdsourced/social item carries an "Unverified" badge + numeric confidence until a human verifies. | Art. XIV · FR-5 · E8 T-356/T-377 · F12 |
| 3 | **Human before public action.** No UNVERIFIED report emits CAP/EDXL or tasks a resource; threshold fires are DRAFT-only. | **Art. XIII** · DB CHECK (ACTUAL⇒approved_by) · **F8** contract test |
| 4 | **No PII retention.** Reporter PII is purged after the incident lifecycle (`purgeAfter`); no PII in logs/exports/EDXL. | Art. XIV · COMPLIANCE_MATRIX C8 (detect/redact, fail-closed) · E7 T-308 PII-screen · pino redaction |
| 5 | **Precise location is responder-only.** Public views get generalized geometry; `geomPrecise` requires RESPONDER+ auth. | ST3 · RBAC (E7 T-323) · E8 T-370 |
| 6 | **Provenance on everything.** Every datum → SOURCE_RECORD; every response → `provenance[]+freshness`; every SitRep field → `citations[]`. | **Art. XI** · **F1/F2** contract tests |
| 7 | **Misinformation flagged, never merged.** Conflicting/low-authority signals lower `source_authority` confidence and are flagged — not asserted as fact. *Tier split (reconciles Phase-2 §6 wording): official agency **RSS/API** posts = authoritative-news tier (adapter T-175); **social-platform** posts — even from official accounts — = confidence-scored corroboration, never auto-trusted (T-177/T-179).* | Art. XIV · SPEC §5.4 · E8 T-380 |
| 8 | **AI never invents.** Numbers are deterministic; LLM narrates cited facts only; every AI call passes the fail-closed compliance proxy. | **Art. XII** · **F3/F16** · ADR-017 |
| 9 | **No scraping / ToS-protected platforms.** Free/open, license-compatible sources only (X/Twitter excluded; xView2 never bundled). | Art. XI · `NOTICE` · `docs/audit/DATA_SOURCE_VERIFICATION.md` |
| 10 | **Accountable.** Every state change and AI call is written to the hash-chained, append-only audit trail. | ADR-022 · AUDIT_EVENT (prev_hash/hash) · F19 |
| 11 | **Honest limitations.** Source limits (FIRMS ≠ perimeters; EAGLE-I county-granular; cache staleness) are stated in the UI and docs. | Art. XI · freshness badges (FR-2) · E8 T-355 |

*Canonical enforcement detail: `agents/CONSTITUTION.md` Art. XI–XVI · `docs/architecture/COMPLIANCE_MATRIX.md`
· `docs/architecture/THREAT_MODEL.md` §11 · fitness functions F1/F2/F3/F8/F12/F16 (TEST_PLAN).*
