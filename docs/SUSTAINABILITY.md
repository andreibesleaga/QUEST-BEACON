# BEACON — Sustainability Methodology & Disclosure (Estimated / Modeled, Demo)

> **Out-of-core OPTIONAL plugin / basic alignment example — non-blocking.** This is a minimal, modeled/estimated demonstration of sustainability-reporting alignment (`.well-known/sustainability` Internet-Draft v05 + the author's SFC profile 1.1), not a core BEACON feature or acceptance criterion.

> **Provenance (verified 2026-06-29):** the `.well-known/sustainability` **v05** spec
> (`draft-besleaga-green-sustainability-wellknown-05`) is an **individual IETF Internet-Draft authored by
> the project author** — **NOT an RFC and NOT an adopted IETF/working-group standard** — and the **SFC
> engineering profile 1.1 is the author's own profile**, not an adopted industry standard. Both are cited
> here only as *author-originated alignment examples*. The recognized external standards this methodology
> actually conforms to are **GSF SCI (ISO/IEC 21031:2024)**, **GHG Protocol**, **CSRD/ESRS-E1**, and **RFC
> 8615**. "RFC v05" used elsewhere is shorthand for "Internet-Draft v05."

> **This is the `methodology-uri` target** for BEACON's `GET /.well-known/sustainability` endpoint
> (RFC `draft-besleaga-green-sustainability-wellknown-05`; see `docs/architecture/decisions/ADR-020-sustainability-reporting.md`).
> Every number in BEACON's published sustainability document is **ESTIMATED / MODELED (demo)** — it is
> *not* hardware-metered. `measurement-method` is reported as `third-party-modeled`. This is deliberate
> and disclosed (honest-limitations rule): a ~$0, offline-capable demo running on free tiers has no access
> to authoritative datacenter metering, so we publish a transparent model rather than fabricate measured
> figures (the LLM never produces these numbers — they are deterministic/modeled; Constitution Art. XII).

**Attribution / standards basis:** this methodology applies public standards and the author's agentic-AI
engineering framework. It draws on the **Green Software Foundation Software Carbon Intensity (SCI)**
specification — standardized as **ISO/IEC 21031:2024** — the **GHG Protocol** (scopes/accounting), the
**EU CSRD / ESRS-E1** disclosure expectations, and the **Sustainability-First Consensus (SFC) engineering
profile 1.1** (criteria C1–C4) as documented in `rfc-sustainability-wellknown/COMPLIANCE/SFC.md`. BEACON
does not depend on SFC; SFC is one engineering profile we align our checklist to.

---

## 1. Scope and boundary

- **System boundary:** the BEACON application boundary only — Next.js app + API routes, Postgres, the
  ingestion workers (CRON/BullMQ), and any cloud LLM/vision calls that BEACON itself makes. Upstream data
  providers (NASA, NOAA, Copernicus, OSM, CAMARA, etc.) are **out of boundary** — we report *our* compute,
  not theirs.
- **Functional unit (R):** `per 1,000 COP requests served` (an extended-field `functional-unit`). This is
  the unit BEACON's SCI score is normalized to. (Alternative units — per-user, per-incident — may appear
  in extended/target reports; if present, the unit is stated in the document and here.)
- **Reporting period:** Basic level reports the most recently completed full calendar month (per the RFC);
  extended trend requests slice by `granularity`.
- **Aggregation only:** values are aggregate for the origin; no per-user or sub-24h granularity is
  published (RFC privacy considerations).

---

## 2. Modeled basis (how the numbers are produced)

BEACON is designed to run two ways (CONFIGURATION §1, `DEPLOY_MODE`), and the model reflects whichever
applies:

1. **Cloud (free-tier) basis — `cloud-billing`-style modeling.** Where BEACON runs on free-tier cloud
   hosts (e.g. a serverless/edge platform + a hosted Postgres + a hosted Redis), energy is **modeled from
   billing/usage proxies**: provisioned/served compute-time, request counts, and storage-GB-months are
   multiplied by published or typical energy coefficients for that class of resource. We do **not** read a
   power meter; we model from the usage signals the platform exposes. `measurement-method: third-party-modeled`.
2. **Local / air-gapped basis — modeled from host class.** In `DEPLOY_MODE=local` (docker-compose, local
   Ollama, ~$0, no egress), energy is modeled from the developer/host machine class and run-time. Still
   `third-party-modeled`, still labeled estimated.

**Carbon from energy.** Carbon is derived deterministically from modeled energy and a grid carbon
intensity:

```
carbon (gCO2e) = energy (kWh) × carbon-intensity (gCO2e/kWh)
```

- We use a **location-based** grid intensity by default (`carbon-accounting: location-based`), taking the
  intensity for the hosting region. The `carbon-intensity-gCO2-per-kWh` field carries the value used.
- A **market-based** figure (renewable contracts/RECs) MAY be reported instead where a deployment has
  procurement evidence (`carbon-accounting: market-based`); the demo uses location-based.
- Grid-intensity sourcing can be made carbon-aware (e.g. ElectricityMaps/WattTime) per the green-software
  skill, but the demo uses a fixed representative regional intensity and labels it modeled.

**Embodied carbon (M).** Server/hardware lifecycle (embodied) carbon is **amortized** over the reporting
period from a typical server-lifetime carbon debt divided across its service life and BEACON's share of the
host — a coarse modeled allocation, labeled estimated. On shared free tiers BEACON's amortized share is small.

**Unit handling.** The published document uses the RFC's fixed unit literals; the model converts internally
(`Wh↔kWh↔MWh↔GWh`, `gCO2e↔kgCO2e↔mtCO2e`) and reports a single consistent `energy-unit` / `carbon-unit`
per object (mirrors the SFC↔well-known unit bridge in `COMPLIANCE/SFC.md`).

---

## 3. Software Carbon Intensity (SCI) — GSF / ISO/IEC 21031:2024

BEACON reports an optional `sci-score` using the GSF SCI equation:

```
SCI = ((E × I) + M) / R
```

| Variable | Meaning (BEACON) | Source in the model |
| :--- | :--- | :--- |
| **E** — Energy | Modeled kWh consumed within the BEACON boundary over the period | §2 modeled basis (cloud-billing proxy or host-class) |
| **I** — Carbon intensity | gCO2e/kWh for the hosting region | location-based grid intensity (`carbon-intensity-gCO2-per-kWh`) |
| **M** — Embodied carbon | Amortized hardware-lifecycle carbon for BEACON's host share over the period | §2 embodied amortization |
| **R** — Functional unit | per 1,000 COP requests served (`functional-unit`) | §1 boundary |
| **SCI score** | `((E×I)+M)/R` → gCO2e per 1,000 COP requests | computed deterministically, published as `sci-score` |

The SCI score is the actionable figure to reduce. It is deterministic given the modeled inputs — never
LLM-produced (Art. XII).

---

## 4. SFC engineering profile 1.1 — C1–C4 checklist (applied to BEACON)

The SFC profile (criteria C1–C4; conformance checks C-SFC-*) is summarized in
`rfc-sustainability-wellknown/COMPLIANCE/SFC.md`. BEACON is not a blockchain/DLT system, so we apply the
**applicable engineering intent** of each criterion to a web service and surface the result in the
well-known document. All values are **modeled (demo)**.

| Check | SFC intent (profile 1.1) | BEACON applied (modeled/demo) | Well-known field(s) |
|---|---|---|---|
| **C1 — Energy < 1 GWh** | Annualized boundary energy below 1 GWh | ✅ Trivially met: a single free-tier web app's modeled annual energy is far below 1 GWh (orders of magnitude under). Stated as modeled. | `energy-consumption` + `energy-unit`; `estimated-annual-emissions-kgCO2` (optional) |
| **C2 — Hardware (general-purpose)** | General-purpose hardware, no single-use ASICs | ✅ Met by design: BEACON runs on commodity CPUs (cloud free tier or a laptop); no ASICs/GPU-mining; optional vision uses general-purpose inference (Ollama/LiteLLM). Documented here (no on-chain analog). | (documented in this methodology; not a numeric field) |
| **C3 — Carbon transparency (Scope 2 & 3)** | Native carbon transparency incl. GHG Scope 2 & 3, accounting basis | ✅ Reported: `scope-2` (purchased-energy carbon from modeled E×I) and `scope-3` (value-chain — modeled embodied/amortized + cloud-service share); `carbon-accounting` declares location- vs market-based. Scope 1 ≈ 0 (no direct combustion). | `scope-2`, `scope-3`, `carbon-accounting`, `carbon-footprint`, `renewable-energy` |
| **C4 — Regulatory readiness (CSRD / ESRS-E1)** | Machine-readable CSRD/ESRS-E1 disclosure | ✅ Ready: the well-known document is machine-readable, schema-validated (`schemas/sustainability-v05.schema.json`), carries the GHG-scope + accounting fields ESRS-E1 expects, and links its methodology here; an optional `verifiable-attestation-uri` slot is reserved for future signed attestations (anti-greenwashing). | full document + `methodology-uri` (this file) + optional `verifiable-attestation-uri` |

> **C2 and cryptographic attestation remain SFC-side concerns** for true DLT operators; BEACON documents
> the hardware posture (C2) here and *links* to attestations rather than defining them — matching the RFC's
> own non-goals (`COMPLIANCE/SFC.md` §4–§5).

---

## 5. Green-software estimate (GREEN_SOFTWARE_REPORT-style) — estimated/modeled (demo)

Following the `GREEN_SOFTWARE_REPORT_TEMPLATE` structure. **All values below are modeled placeholders for
the demo, clearly labeled estimated; replace with measured figures if/when real metering exists (ADR-020
upgrade path).**

### 5.1 Executive summary
BEACON's footprint is dominated by (a) the ingestion workers polling upstream sources and (b) any cloud
LLM/vision calls. The biggest controllable offenders are over-frequent polling and unnecessary cloud-AI
calls — both already mitigated by config (poll cadence, `AI_MODE=off`/local, vision off by default).

### 5.2 SCI estimate (modeled, illustrative)

| Variable | Modeled value (demo, illustrative) | Unit / note |
| :--- | :--- | :--- |
| Energy (E) | ~420 kWh / month (modeled, free-tier cloud basis) | kWh; modeled from usage proxies, not metered |
| Carbon intensity (I) | ~233 gCO2e/kWh (representative regional, location-based) | gCO2e/kWh; modeled |
| Embodied (M) | small amortized share | gCO2e; coarse host-share amortization |
| Functional unit (R) | per 1,000 COP requests | R |
| **SCI score** | **~1.2 gCO2e / 1,000 COP requests (modeled)** | `((E×I)+M)/R`; illustrative, deterministic given inputs |

*(These mirror the example BEACON document validated against `schemas/sustainability-v05.schema.json`. They
are illustrative model outputs, not measurements.)*

### 5.3 High-impact reduction targets (carbon/energy efficiency)
1. **Ingestion polling cadence** — *current:* per-source polling (`INGEST_DEFAULT_INTERVAL_SEC=300`); *green proposal:* widen cadence + event-driven/delta ingestion + heavy caching (`CACHE_TTL_SEC`); *est. savings:* High.
2. **Cloud LLM/vision calls** — *current:* optional cloud synthesis/vision; *green proposal:* prefer local Ollama / deterministic-only (`AI_MODE=local|off`, `FEATURE_VISION=off`), batch SitRep synthesis; *est. savings:* High.
3. **Realtime channel** — *current:* SSE push; *green proposal:* debounce/coalesce deltas (`SSE_DEBOUNCE_MS`), fall back to polling only when needed; *est. savings:* Medium.
4. **Data lifecycle** — purge PII at incident-lifecycle end (already mandated, Art. XIV) and prune stale cache (the "joy of delete," *never* forensic/audit logs — green-software guardrail); *est. savings:* Low–Medium.

### 5.4 Infrastructure / hardware audit
- **Carbon-aware region:** prefer low-intensity hosting regions; report `carbon-intensity-gCO2-per-kWh`.
- **Scale-to-zero:** serverless/edge for the app + CRON-default workers keep idle energy near zero (offline/air-gapped uses local compute).
- **Caching/density:** last-known-good cache reduces redundant upstream fetches; modes (`live→cached→mock`) avoid wasteful retries when a source is down.

### 5.5 ESG (Social / Governance)
- **Social:** advisory AI, cited and confidence-scored, never auto-acts; accessibility is a UI goal; no demographic bias in deterministic geometry.
- **Governance:** every datum has provenance; the sustainability document is auditable, schema-validated, and links its methodology (this file); data collection is transparent and consent-gated (Art. XIV).

---

## 6. Example published document (validates against `schemas/sustainability-v05.schema.json`)

A representative Basic+extended BEACON document (modeled). Served at `GET /.well-known/sustainability`:

```json
{
  "version": "1.1",
  "updated": "2026-06-29T00:00:00Z",
  "capabilities": "extended",
  "provider": "BEACON (sustain@beacon.local)",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "https://beacon.local/docs/SUSTAINABILITY.md",
  "reporting-period": "2026-05",
  "energy-consumption": 420,
  "energy-unit": "kWh",
  "carbon-footprint": 98,
  "carbon-unit": "kgCO2e",
  "carbon-accounting": "location-based",
  "scope-2": 92,
  "scope-3": 6,
  "sci-score": 1.2,
  "functional-unit": "per-thousand-COP-requests",
  "carbon-intensity-gCO2-per-kWh": 233,
  "renewable-energy": 35
}
```

> **Labeling reminder:** every figure here and in the published document is **estimated / modeled (demo)**.
> `measurement-method` is `third-party-modeled`. Per ADR-020, a deployment with real datacenter metering
> can flip `measurement-method` to `hardware-metered` and update this methodology accordingly.

---

## 7. References

- RFC `draft-besleaga-green-sustainability-wellknown-05` — the well-known URI, data model, CDDL/JTD (public spec).
- `schemas/sustainability-v05.schema.json` — JSON Schema the published document is validated against.
- `docs/architecture/decisions/ADR-020-sustainability-reporting.md` — the decision to expose this surface (modeled).
- `rfc-sustainability-wellknown/COMPLIANCE/SFC.md` — SFC engineering profile 1.1; C1–C4 + C-SFC checks; field-level mapping and unit bridge.
- Green Software Foundation **Software Carbon Intensity (SCI)** = **ISO/IEC 21031:2024**.
- **GHG Protocol** (Corporate Standard; scopes, location- vs market-based accounting).
- **EU CSRD / ESRS-E1** (machine-readable climate disclosure expectations).
- BEACON green-software / sustainability-checks skills + `GREEN_SOFTWARE_REPORT_TEMPLATE` (the author's agentic-AI engineering framework).
