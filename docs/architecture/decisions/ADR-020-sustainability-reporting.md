# ADR-020: Sustainability Reporting — `GET /.well-known/sustainability` (Out-of-Band, Modeled/Estimated)
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-020-sustainability-reporting.md -->

**Date:** 2026-06-29
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** api | infrastructure | security | sustainability

**Scope: OUT-OF-CORE optional plugin / basic alignment example — non-blocking for the v1 demo (not a core feature or acceptance gate).** Demonstrates compliance + sustainability-reporting alignment (GSF SCI / CSRD) and UN-SDG fit; modeled/estimated only.

> **Provenance (verified 2026-06-29):** the `.well-known/sustainability` **v05** spec
> (`draft-besleaga-green-sustainability-wellknown-05`) is an **individual IETF Internet-Draft authored by
> the project author** — it is **NOT an RFC and NOT an adopted IETF/working-group standard**; an I-D is a
> working document with no standards standing. Likewise the **SFC engineering profile 1.1 is the author's
> own profile**, not an adopted industry standard. Both are cited here only as *author-originated alignment
> examples*. The **recognized external standards** this plugin actually maps to are **GSF SCI (ISO/IEC
> 21031:2024)**, **GHG Protocol**, **CSRD/ESRS-E1**, and **RFC 8615** (.well-known URIs). Wherever this
> document writes "RFC v05" as shorthand, read "Internet-Draft v05."

---

## Context

BEACON is a public-interest emergency platform; environmental transparency of the service itself is both
a graded rubric item (green software) and an alignment goal with emerging disclosure regimes (EU CSRD /
ESRS-E1, GHG Protocol, GSF Software Carbon Intensity = ISO/IEC 21031:2024). We need a discoverable,
machine-readable surface that reports BEACON's aggregate energy/carbon impact without adding overhead to
every crisis request (a per-request header in a disaster COP is exactly the wrong place to spend bytes and
energy). The public RFC draft `draft-besleaga-green-sustainability-wellknown-05` defines precisely this:
an out-of-band `/.well-known/sustainability` URI (RFC 8615) returning I-JSON metrics. We decide now because
the endpoint, its JSON Schema (`schemas/sustainability-v05.schema.json`), and the methodology doc
(`docs/SUSTAINABILITY.md`) are dependencies of the green-software deliverable and the API surface. The
engineering relationship to the author's agentic-AI engineering framework's Sustainability-First Consensus
(SFC) profile 1.1 is documented in `rfc-sustainability-wellknown/COMPLIANCE/SFC.md` and applied here.

**Current state:** No sustainability surface today; green-software guidance exists only as a skill/report template.
**Constraint(s):** must not burden the golden path or per-request flow (Art. XVI, OP1); free/open + offline-capable; no fabricated metrics (the LLM never invents numbers — Art. XII; numbers are deterministic/modeled); honest labeling of estimated vs measured (Art.-honest-limitations); config-driven (12-factor); aligns with the public v05 spec and SFC engineering profile 1.1 (C1–C4) without depending on any non-public source.

---

## Options Considered

### Option A: Out-of-band `/.well-known/sustainability` (RFC v05), modeled values (CHOSEN)
Expose `GET /.well-known/sustainability` returning a v05-conformant JSON document (single object at the
Basic level; an array for `?period=&granularity=` trends). Values are **estimated/modeled**:
`measurement-method: "third-party-modeled"`, `methodology-uri` -> `docs/SUSTAINABILITY.md`. The document
is heavily cached (per the draft's Operational Considerations), validated against
`schemas/sustainability-v05.schema.json`, and carries GHG-scope + SCI optional fields where modeled.

**Pros:**
- Asynchronous + aggregated: zero per-request overhead, no "rebound effect," nothing added to the crisis hot path (draft Introduction; Art. XVI/OP1).
- Standards-aligned and discoverable: RFC 8615 well-known URI, GHG Protocol vocabulary, GSF SCI, CSRD/ESRS-E1 optional fields; bridges cleanly to the SFC engineering profile 1.1 (C1–C4) per `COMPLIANCE/SFC.md`.
- Schema-validated and honest: a published JSON Schema + clear "estimated/modeled (demo)" labeling satisfies the project's honest-limitations rule and the draft's anti-greenwashing guidance (methodology-uri, optional verifiable-attestation-uri).
- Cheap to operate: a cached static/periodic document; no metering infrastructure required for the demo.

**Cons:**
- Modeled numbers are approximate; must be explicitly labeled and never presented as metered truth.
- One more endpoint + schema + methodology doc to keep current as the v05 draft evolves.

**Source:** RFC draft-besleaga-green-sustainability-wellknown-05 (public spec); GSF SCI / ISO/IEC 21031:2024; GHG Protocol; SFC engineering profile 1.1 (`COMPLIANCE/SFC.md`); the author's agentic-AI engineering framework (green-software / sustainability-checks skills).

### Option B: Per-request HTTP sustainability headers
Attach carbon/energy metadata to every HTTP response.
**Pros:** real-time, co-located with the transaction; trivial to attach.
**Cons:** the draft explicitly rejects this — per-request metadata creates a "rebound effect" (the disclosure itself burns bandwidth/energy on every request) and a real-time telemetry / privacy risk (correlating energy spikes to user actions; the draft's Privacy Considerations recommend ≥24h granularity). In a disaster COP with high request volume this is the worst place to add bytes. **Rejected.**
**Source:** draft v05 Introduction + Privacy Considerations (per-request headers / real-time telemetry NOT RECOMMENDED).

### Option C: Real hardware/grid metering (live measured)
Instrument the runtime + datacenter for measured energy and live grid carbon intensity.
**Pros:** highest fidelity; could justify `measurement-method: hardware-metered`.
**Cons:** infeasible/disproportionate for a ~$0 offline-capable demo running on free tiers; depends on host telemetry we don't control; conflicts with the air-gapped acceptance test. Defer to a future deployment that has real metering (then flip `measurement-method` and `methodology-uri`). **Rejected for the demo; kept as a forward path.**
**Source:** CONFIGURATION (DEPLOY_MODE local/cloud, ~$0); Art. XVI air-gapped acceptance test.

---

## Decision

**We will use Option A — expose `GET /.well-known/sustainability` per RFC v05 with modeled/estimated values.**

Because:
1. Out-of-band aggregation is the only option that adds **zero** cost to the crisis hot path while still being discoverable and standards-aligned (the draft was designed for exactly this trade-off; Art. XVI/OP1).
2. Modeled values (`third-party-modeled` + `methodology-uri` -> `docs/SUSTAINABILITY.md`) are honest, cheap, and offline-capable for the demo, and the document is schema-validated against `schemas/sustainability-v05.schema.json` (no fabricated numbers — Art. XII; honest-limitations).
3. It applies the SFC engineering profile 1.1 checks **C1–C4** (energy < 1 GWh modeled; general-purpose hardware; carbon transparency with GHG Scope 2/3; CSRD/ESRS-E1 readiness) and bridges to them via `COMPLIANCE/SFC.md`, with a clean upgrade path to `hardware-metered` if a future deployment has real metering (Option C).

---

## Consequences

### Positive
- A single, cached, schema-valid disclosure surface; aligns with GHG Protocol / GSF SCI / CSRD without per-request overhead.
- Green-software rubric item satisfied with an auditable methodology (`docs/SUSTAINABILITY.md`) and the SFC C1–C4 checklist.
- Forward-compatible: the schema permits unknown fields and `disclosure-uri` (v05 schema 1.1); we can add `verifiable-attestation-uri` later without breaking clients.

### Negative
- Modeled numbers must always be labeled "estimated/modeled (demo)"; a reader who ignores the label could over-trust them (mitigated by explicit labeling + methodology link).
- Extra endpoint + schema + doc to maintain against draft revisions.

### Neutral
- Endpoint is read-only, heavily cached (`Cache-Control: max-age`, ETag/Last-Modified per the draft), rate-limited on parameterized requests, and capped at ≤366 array objects (draft DoS / Array-Size considerations).
- Values are produced by deterministic/modeled computation, never the LLM (Art. XII). The narrative LLM never touches these figures.

### Risks
- Greenwashing perception → mitigated by `methodology-uri` to a transparent methodology, honest "modeled (demo)" labeling, and an optional `verifiable-attestation-uri` slot for future signed attestations (draft anti-greenwashing guidance).
- DoS via dynamic `period` aggregation → mitigated by heavy caching, rate-limiting, and the ≤366-object cap (draft Security Considerations).
- Privacy/fingerprinting via fine-grained metrics → mitigated by aggregate-only, ≥24h granularity, optional ~1% fuzzing (draft Privacy Considerations).
- Schema drift vs the v05 draft → mitigated by pinning the schema file to the v05 data model and revisiting on each draft revision.

---

## Y-Statement Summary

> For operators, aggregators, and regulators who need a discoverable, machine-readable view of BEACON's
> environmental impact without burdening the crisis hot path,
> a `/.well-known/sustainability` endpoint (RFC v05) serving modeled, schema-validated, GHG/SCI-aligned
> metrics out-of-band
> is an asynchronous disclosure surface
> that adds zero per-request overhead and bridges to the SFC engineering profile 1.1 (C1–C4).
> Unlike per-request sustainability headers,
> our solution avoids the rebound effect and real-time-telemetry privacy risk while staying honest about being modeled.

---

## Links

> *Path note (D-33): `rfc-sustainability-wellknown/…` paths below refer to the author's **external
> upstream repo** (github.com/andreibesleaga/rfc-sustainability-wellknown; I-D on the IETF datatracker) —
> NOT a Phase-3 repo path. The in-repo methodology target is `docs/SUSTAINABILITY.md`.*

- **Spec:** RFC draft-besleaga-green-sustainability-wellknown-05 (`rfc-sustainability-wellknown/documents/`) — well-known URI, mandatory/optional fields, CDDL/JTD.
- **Schema:** `schemas/sustainability-v05.schema.json` (validates single object OR trend array; rejects bad units; permits unknown fields).
- **Methodology:** `docs/SUSTAINABILITY.md` (the `methodology-uri` target; assumptions + SFC C1–C4 checklist + SCI estimate).
- **SFC bridge:** `rfc-sustainability-wellknown/COMPLIANCE/SFC.md` (SFC engineering profile 1.1; C-SFC checks).
- **Constitution:** Art. XII (deterministic numbers; LLM never invents figures), Art. XVI (no golden-path/per-request burden; offline-capable), honest-limitations (label modeled vs measured).
- **Related ADRs:** ADR-012 (config-for-everything), ADR-009 (total redundancy / offline-first), ADR-010 (interop/standards surface), ADR-021 (CAMARA telecom adapter — separate concern).
- **Implementation:** S05 thin App-Router route delegating to a use-case that emits the schema-valid document; pending S04 gate.

---

## Review

**Approved by:** prod-architect + human, 2026-06-29 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** on each v05 draft revision and whenever a deployment gains real metering (flip `measurement-method` to `hardware-metered`).
