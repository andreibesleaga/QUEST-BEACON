# BEACON — EARS ADDENDUM: Live-Demo Delivery Increment

> Companion to `docs/requirements/EARS_REQUIREMENTS.md`, added for the increment specified in
> `docs/LIVE_DEMO_DELIVERY_PLAN.md`. One section per session; every requirement names the test that
> proves it, so the golden thread (requirement → spec → test → code → audit) stays intact even though
> the increment batches its GABBE ceremony per session rather than per task (plan §1.8, user-approved).
>
> Numbering continues the FR series as `FR-LD-*` (Live Demo) to avoid colliding with the S01 PRD.

---

## Session 1 — backend completion

### Persistence (plan §2·S1 Lane P; ADR-037 §1)

- **FR-LD-1** — WHEN `FEATURE_STORE=postgres`, THE SYSTEM SHALL persist resources, resource tasks and
  shelters in PostgreSQL, so that a restart does not lose tasking state.
  *Proof:* the shared logistics contract suite executed against the Postgres store.
- **FR-LD-2** — THE SYSTEM SHALL expose exactly one behavioural contract for `ResourceLogisticsPort`,
  and BOTH the in-memory and the Postgres implementation SHALL satisfy it.
  *Proof:* one exported contract suite run twice (memory + pg); a divergence fails a gate.
- **FR-LD-3** — WHERE `CAPACITY_MATCH_DIRECTION` is configured, THE SYSTEM SHALL rank shelters by the
  configured objective, and the default SHALL preserve the pre-existing ranking exactly.
  *Proof:* per-direction ranking tests; existing shelter tests unchanged.
- **FR-LD-4** — WHEN a SitRep is synthesized under `FEATURE_STORE=postgres`, THE SYSTEM SHALL persist it
  as an immutable history record, AND the SitRep read path SHALL remain engine-computed per read.
  *Rationale (constraint, not preference):* a persisted SitRep rendered as current would present stale
  figures as live ones — the exact failure Art. XII exists to prevent.
- **FR-LD-5** — WHEN a citation is produced, THE SYSTEM SHALL persist it via the citation repository.
- **FR-LD-6** — WHEN an evacuation route is accepted, THE SYSTEM SHALL persist it keyed by incident.
- **FR-LD-7** — THE SYSTEM SHALL allow an operator to define shelters without a UI, via
  `config/shelters.json` (schema-validated at boot) or a direct database update.
- **FR-LD-8** — IF a database schema object is missing, THEN THE SYSTEM SHALL report a server fault
  (5xx), NOT a client validation error (400).
  *Rationale:* a missing migration previously surfaced as "your request was invalid", which sent
  diagnosis in exactly the wrong direction.

### API surface (plan §2·S1 Lane R)

- **FR-LD-9** — THE SYSTEM SHALL serve `GET /incidents/{id}`, `GET /incidents/{id}/exposure`,
  `GET /health/adapters`, `GET /threshold-rules` and `GET /audit-events`, each carrying the standard
  `{data, provenance[], freshness}` envelope and enforcing the RBAC matrix.
  *Proof:* dispatcher tests per route — happy path, unknown id, RBAC refusal.
- **FR-LD-10** — THE published API contract SHALL describe every served route, and SHALL NOT mark a
  served route as planned. *Proof:* OpenAPI parses; register rows closed.

### Scheduling & demo aids (plan §2·S1 Lane S; ADR-037 §2, §5)

- **FR-LD-11** — WHILE the server is running AND `RETENTION_SWEEP_ENABLED=on`, THE SYSTEM SHALL execute
  the retention purge every `RETENTION_SWEEP_INTERVAL_SEC` and SHALL audit each sweep.
  *Rationale:* Art. XIV's no-PII-beyond-lifecycle guarantee cannot depend on a human remembering.
- **FR-LD-12** — IF a scheduled job throws, THEN THE SYSTEM SHALL audit the failure and continue
  scheduling; it SHALL NOT terminate the process.
- **FR-LD-13** — WHILE `DEMO_AUTO_REPORT=on`, WHEN the deterministic threshold evaluation first reports a
  critical wildfire or flood signal in `DEMO_AUTO_REPORT_REGION`, THE SYSTEM SHALL send exactly one
  monitoring notification through the notifier, labelled
  "AUTOMATED MONITORING (not an approved public alert)" and carrying the signal, its citation and its
  freshness.
- **FR-LD-14** — THE demo watcher SHALL NOT emit CAP/EDXL, SHALL NOT create or modify an Alert, and
  SHALL NOT interact with the alert store. Public alerting remains human-approved (Art. XIII).
  *Proof:* a test asserting the alert store is never touched.
- **FR-LD-15** — WHEN a seeded forecast threshold rule fires, THE SYSTEM SHALL create a DRAFT alert
  reachable from the running application (never an ACTUAL one).

---

## Session 2 — live sources + live vision

### Sources (plan §2·S2 lanes A1–A4)

- **FR-LD-16** — THE SYSTEM SHALL provide at least one worldwide social corroboration source that operates
  LIVE without any account or key. *Realised by the keyless Mastodon adapter; Bluesky becomes a
  bring-your-own-account rung after its keyless access began returning 403.*
- **FR-LD-17** — Vetted-social content SHALL be treated as corroboration only: low source authority, never
  auto-trusted, conflicting signals flagged rather than merged, and NO account-identifying field retained
  (Art. XIV). *Proof:* the social adapters' ACL tests.
- **FR-LD-18** — WHERE a source's licence requires attribution or an identifying User-Agent, THE SYSTEM
  SHALL supply it on every request. *Rationale: for met.no and ODbL sources this is a licence obligation,
  not a courtesy.*
- **FR-LD-19** — EVERY region SHALL have at least one live wildfire source and one live flood source
  (FIRMS and GDACS, both global), regardless of which regional sources are reachable.
- **FR-LD-20** — IF a source is unreachable, gated, or licence-incompatible, THEN the system SHALL ship it
  CACHED or MOCK with written access instructions, or remove the source and every claim about it — and
  SHALL NOT present it as live. *Proof:* `audit/DATA_SOURCE_VERIFICATION.md` verdict per source.
- **FR-LD-21** — THE SYSTEM SHALL expose air-quality observations behind an `AirQualityPort`, and WHERE an
  AQI threshold is crossed SHALL emit it as a deterministic, cited SitRep fact (Art. XII, F2).

### Vision (plan §2·S2 lane V; ADR-037 §4)

- **FR-LD-22** — WHEN `VISION_MODE=cloud`, THE SYSTEM SHALL analyse real imagery through a real vision
  model; WHEN `local`, through the configured local endpoint; and in every other case, or on ANY failure,
  SHALL fall back to the recorded-fixture provider **labelled as a degraded rung** (Art. XVI).
- **FR-LD-23** — ALL SEVEN `VISION_*` settings SHALL be read by the running code, and an invalid value
  SHALL fail the boot. *Closes UNIMPLEMENTED_REGISTER row 27, where all seven were read by no code.*
- **FR-LD-24** — A vision model SHALL NOT produce a figure. Its output SHALL be an advisory,
  confidence-scored, cited finding; any numeric claim it returns SHALL be discarded before the finding is
  built (Art. XII). *Proof:* a test feeding a numeric-claiming model response and asserting no figure survives.
- **FR-LD-25** — THE SYSTEM SHALL fetch imagery from a keyless default source (NASA GIBS) and MAY use
  Copernicus Data Space when credentials exist; absent credentials SHALL degrade to the keyless source,
  never fail.
- **FR-LD-26** — THE SYSTEM SHALL refuse an image exceeding `VISION_MAX_IMAGE_MB` rather than truncating
  it. *Rationale: a truncated image yields a confident finding about pixels that were never sent.*
- **FR-LD-27** — Vision output SHALL remain advisory: it SHALL NOT auto-alert and SHALL NOT override
  deterministic geometry (Art. XII/XIII).
