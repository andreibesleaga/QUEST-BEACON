# ADR-010: Interop Standards — CAP v1.2 + Full EDXL-RM Round-Trip + EDXL-SitRep + GeoJSON/OGC
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-010-interop-cap-edxl-geojson.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** api | interop | infrastructure

---

## Context

BEACON's integrator persona must consume and produce real inter-agency interchange: alerts, mutual-aid
resource requests/commits/responses, situation summaries, and geospatial data. The user explicitly upgraded
EDXL scope to a full mutual-aid round-trip (CLARIFICATIONS §A U1). The canonical internal entities
(`RESOURCE`/`RESOURCE_TASK`/`SHELTER`/`ALERT`/`SITREP`) are the source of truth; standards are boundary
serializations via an `EdxlPort`/`AlertSink` adapter. We decide the standard set now because S03 defines the
EDXL-RM message set, JSON-Schemas, and the field mapping (internal entity ↔ standard element), and the API
surface (PRD §8) exposes the import/export endpoints.

**Current state:** Locked (CLARIFICATIONS §A U1, §B Q2, §C C6 / §D) = CAP v1.2 (produce + validate, no live IPAWS origination) + full EDXL-RM 1.0 mutual-aid round-trip + EDXL-SitRep 1.0; GeoJSON/OGC + GLIDE for geo/incident identity. No code yet.
**Constraints:** real inter-agency interoperability (U1); CAP produced + validated, **no** live IPAWS origination (Art. XIII, §C C6); HITL before any outbound alert (Art. XIII); standards at the boundary, canonical model is truth (Art. II/XV); free/open standards.

## Options Considered

### Option A — CAP v1.2 + full EDXL-RM round-trip + EDXL-SitRep + GeoJSON/OGC (+ GLIDE), via an EdxlPort ACL (CHOSEN)
Produce + validate CAP v1.2 alerts (IPAWS-ready, no live origination); implement the full EDXL-RM 1.0
mutual-aid lifecycle (RequestResource → CommitResource → ResponseToRequestResource, etc.) as real
import/export; emit situation summaries as EDXL-SitRep 1.0; use GeoJSON/OGC for all geometry and GLIDE for
cross-agency incident identity. All standards are boundary serializations mapped to/from canonical entities
by an anti-corruption adapter, with JSON-Schemas (schemas/, S03) gating both directions.
**Pros:** genuine inter-agency interoperability — full EDXL-RM round-trip lets BEACON participate in real mutual aid, not just emit one-way alerts (U1, integrator persona, PRD EV10/FR-9); CAP v1.2 is the established public-alert standard, IPAWS-ready and schema-validatable, and producing + validating (not originating) respects the FEMA-authority boundary (Art. XIII, §C C6); standards-at-the-boundary keeps the canonical model clean and the core stable (Art. II/XV), the EdxlPort ACL maps fields both ways with JSON-Schema validation preventing malformed interchange; GeoJSON/OGC + GLIDE give portable geometry and stable cross-agency incident identity (multi-region).
**Cons:** full EDXL-RM is a substantial spec surface (message types, lifecycle states, field mapping) — more S03 schema + mapping work than a subset; standards verbosity (XML EDXL) requires careful ACL mapping and round-trip tests.
**Source:** CLARIFICATIONS §A U1, §B Q2, §C C6 / §D; OASIS CAP v1.2, EDXL-RM 1.0, EDXL-SitRep 1.0; OGC GeoJSON (RFC 7946); GLIDE (ReliefWeb/GLIDEnumber); Constitution Art. XIII/XV.

### Option B — CAP-only (no EDXL)
Produce + validate CAP v1.2 alerts; skip EDXL entirely.
**Pros:** much smaller scope, CAP alone covers public alerting, faster to ship; one standard to map and validate.
**Cons:** no mutual-aid interchange — the integrator can't exchange resource requests/commits or situation summaries, directly contradicting the user's upgraded U1 decision; misses the responder-logistics interoperability that is a flagship feature (PRD §4.4, FR-9); weaker rubric interoperability/innovation story.
**Source:** CLARIFICATIONS §A U1 (explicitly upgraded *from* a subset to full round-trip).

### Option C — Proprietary/custom JSON interchange (no formal standards)
Define BEACON's own JSON for alerts, resources, and situations.
**Pros:** simplest to design around the canonical model; no spec mapping.
**Cons:** not interoperable with any real agency tooling — defeats the integrator persona and the whole point; no IPAWS path, no standards credibility, rubric interoperability near zero; reinvents well-established free standards (CAP/EDXL/GeoJSON).
**Source:** team experience; Art. XI/XV (use established open standards); rubric.

## Decision

**We will use Option A — CAP v1.2 (produce + validate, no live IPAWS origination) + full EDXL-RM 1.0
mutual-aid round-trip + EDXL-SitRep 1.0 + GeoJSON/OGC (+ GLIDE), all as boundary serializations via an
EdxlPort/AlertSink anti-corruption adapter with JSON-Schema validation.**
Rationale: (1) only the full EDXL-RM round-trip delivers the real inter-agency mutual-aid interoperability
the user mandated (U1) and the flagship responder-logistics feature requires (PRD §4.4/EV10/FR-9); (2) CAP
v1.2 produce+validate (no origination) gives an IPAWS-ready, schema-checkable alert format while respecting
the FEMA-authority boundary and HITL gate (Art. XIII, §C C6); (3) keeping every standard at the boundary
(canonical model is truth) preserves core stability and lets each format be added/validated without core
change (Art. II/XV) — and GeoJSON/OGC + GLIDE make the data portable and identifiable across regions.

## Consequences

- **+** BEACON can genuinely interoperate: emit CAP, exchange EDXL-RM mutual aid both ways, share EDXL-SitRep.
- **+** Schema-validated interchange in both directions; malformed messages rejected at the boundary.
- **+** Canonical model stays clean; new standards/versions are adapter work, not core surgery.
- **−** Larger S03 schema + field-mapping effort (full EDXL-RM message set + lifecycle).
- **−** XML EDXL verbosity demands careful ACL mapping and round-trip fidelity tests.
- **~** `EDXL_VERSION`, `CAP_SENDER`, `CAP_EMIT_MODE` (`draft` default), `IPAWS_ENABLED=off` are config (CONFIGURATION.md §8).
- **risk:** round-trip fidelity loss (internal ↔ EDXL) → mitigated by JSON-Schemas + round-trip tests asserting request→commit→response lifecycle integrity (schemas/, S03).
- **risk:** accidental live origination / unverified emission → mitigated by `CAP_EMIT_MODE=draft` default, `IPAWS_ENABLED=off`, and the HITL gate — no CAP from an UNVERIFIED report (Art. XIII, ST1, UW5).
- **risk:** spec drift across agencies → mitigated by validating against the OASIS schemas and documenting the emitted subset/mapping.

## Y-Statement
> For integrators and partner agencies needing real inter-agency interoperability — exchanging public
> alerts, mutual-aid resources, and situation summaries — CAP v1.2 + full EDXL-RM round-trip + EDXL-SitRep +
> GeoJSON/OGC behind an anti-corruption EdxlPort maps established open standards to/from a clean canonical
> model with schema-validated round-trips; unlike a CAP-only or proprietary-JSON design, it supports genuine
> two-way mutual aid while respecting the FEMA-authority boundary (no live IPAWS origination) and the
> human-verify gate.

## Links
- **PRD:** §4.4 (EDXL-RM mutual aid + SitRep + CAP), EV5/EV10 (CAP on verify; EDXL import/export), ST1/UW5 (no outbound from unverified), §8 (API: `/alerts`, EDXL endpoints).
- **Constitution:** Art. XIII (HITL, CAP produced/validated, no live IPAWS origination), XV (standards at the boundary via adapters), XI (open standards/data).
- **Decision source:** CLARIFICATIONS §A U1, §B Q2, §C C6 / §D.
- **Related ADRs:** ADR-001 (EdxlPort/AlertSink in the hexagon), ADR-011 (multi-region identity via GLIDE/GeoJSON), ADR-012 (interop config), ADR-009 (interop endpoints behave under degradation).
- **Official docs:** OASIS CAP v1.2 (OASIS Standard); OASIS EDXL-RM 1.0 (OASIS Standard); OASIS EDXL-SitRep 1.0 (**OASIS Committee Specification CS02, 2016** — a stable committee deliverable, *not* a full OASIS Standard); RFC 7946 (GeoJSON); OGC; GLIDEnumber.
  - *Status note (verified 2026-06-29): CAP v1.2 and EDXL-RM 1.0 are ratified OASIS Standards; EDXL-SitRep 1.0 reached Committee Specification (CS02) only. BEACON serializes all three at the boundary regardless of track; the distinction is recorded for standards accuracy.*
- **Implementation:** S03 schemas (`schemas/` CAP, EDXL-RM/SitRep) + S05 EdxlPort adapter — pending S04 gate.

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S03 (when the EDXL-RM message set + JSON-Schemas + field mapping are finalized).
