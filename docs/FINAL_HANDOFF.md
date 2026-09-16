# BEACON — Final Engineering Handoff (2026-09-16)

> **What this is.** The hub for the state of the finished product: what is verified and how, how the
> product maps to the five judging criteria, what is honestly not done, and what happens after judging.
> It points at the authoritative documents rather than restating them; every figure here is
> machine-produced on the commit it names and must be re-produced, not quoted, at the next release.

## 1. State in one paragraph

Engineering is **complete and live**. The product runs air-gapped from its seed with one command, and
runs live on the reference deployment (https://quest-beacon.up.railway.app: five regions, live sources
through the redundancy ladder, Postgres, named-account sign-in, self-seeding, threshold rules from the
table, CSP/HSTS, an installable offline-capable browser app behind a default-off flag). The contest entry
is frozen at the `v1.0.0-submission` tag; the repository continues as the project's open-source home.

## 2. Verification snapshot — machine-produced 2026-09-15/16 (final commit)

| Gate | Result |
|---|---|
| `tsc --noEmit` · `eslint .` · `depcruise src app` · `madge --circular src` | **0 · 0 · 0 violations (911 modules) · 0 cycles** |
| `vitest run --coverage` | **5,378 passed / 6 skipped (406 files), exit 0**; every floor met (domain + application 99/99/99/99 · main 97/79/96/97 · adapters 90/83/93/90 · app 89/86/89/89); measured 96.0 % statements / 90.9 % branches overall |
| `npm run docs` (OpenAPI contract test) | **36 paths / 39 operations / 66 schemas**, every operation with an id, summary and responses; every operation but the unauthenticated `/health` liveness probe declares its minimum role; every `$ref` resolves; nothing marked planned |
| `next build` | ✅ |
| Playwright (5 zones × 4 device projects; axe; TTTP; visual; SSE; session; i18n/RTL; WebGL; PWA offline) | see `README.md` § Gates for the run on this commit |
| `npm audit --audit-level=high` | **0 high / 0 critical** (dev-only moderates recorded in `osv-scanner.toml`) |
| Adapter registry | **45 registered ↔ 45 factories · 41 consumed · 4 not** (`itu`, `camara-gsma` MOCK-only by design; `hifld` held; `dot511` covers Georgia only) |
| Locales / zones / ADRs | **14 locales** (RTL: ar, ur) · **5 zones** · **49 ADR files** (001–047 + 008a; two share the 036 number — a recorded finding) |
| Live deployment (`npm run check:live`, 2026-09-15 on main a1c76eb) | us-ca **12 pass / 2 warn / 0 fail** · ro **11 / 2 / 0** (anonymous; warnings = sources not live + signed-in checks skipped). The deployment is switched off between judging windows; re-run on the day it is brought up |

**Method, not just numbers:** the final code-and-docs audit is `docs/audit/FINAL-AUDIT-2026-09-16.md`
(what is implemented and supported, what was found wrong and corrected); correctness audited in `docs/audit/FINAL_AUDIT.md`, external facts in
`docs/audit/EXTERNAL_VERIFICATION.md`, live behaviour in `docs/audit/LIVE_VERIFICATION.md` and
`docs/LIVE_STATUS_SOURCE_OF_TRUTH.md`, data sources per row in `audit/DATA_SOURCE_VERIFICATION.md`,
security and AI governance in `docs/architecture/{THREAT_MODEL,COMPLIANCE_MATRIX}.md`, everything
declared-but-not-real in `docs/audit/UNIMPLEMENTED_REGISTER.md`.

## 3. Phase-2 → Phase-3: every promise, its state

| Portal claim | Shipped as |
|---|---|
| Unified live COP (fire, flood, weather, infra, outage, cell, + more) | 14 layers with per-layer freshness and tooltips on every point; outage carries the "ASSUMED offline" caveat; accessible fallback lists all 14 |
| AI fusion → ranked, **cited** SitRep; misinformation flagged | Deterministic grounding minted BEFORE the LLM; authority ranking; flag-not-merge; the no-LLM-numbers contract; AI-off == AI-on numbers |
| Responsible SOS → verify → CAP; evacuation routing | Consent → triage confidence → HITL verify → DRAFT-only CAP; ORS road routing with a labelled heuristic fallback |
| Responder logistics + EDXL-RM round-trip | Roster, forward-only tasking, capacity-vs-demand, pre-positioning, EDXL-RM/SitRep/CAP interop; durable under `FEATURE_STORE=postgres` |
| All portal-named novel sources | 45 adapters, LIVE/CACHED/MOCK honestly tiered (38 can serve live, 29 keyless); prediction labelled first-order; five zones prove portability |
| Works offline | Air-gapped server from the seed; the browser keeps its last public picture as an installable app (ADR-047, flag) |

De-scopes are recorded in `docs/SUMMARY.md` §3; none contradicts the accepted entry.

## 4. The five official judging criteria — where each is proven

1. **Timeliness / reliability** — TTTP < 10 s budget, ≈ 1 s measured (`e2e/perf.spec.ts`); SSE push
   proven in-browser (`e2e/sse-push.spec.ts`); live re-ingest every 300 s with a never-half-built swap;
   kill-a-source → labelled degrade (redundancy acceptance tests); boot warm-up so a cold start never
   times out a login.
2. **Comprehensiveness / data / novelty** — 45 adapters across hazard, weather, gauges, news, social,
   population, infrastructure, outage, cell, air quality, cameras; derived layers no single source
   publishes; per-host coverage (a source is consulted only where it covers).
3. **Integration / synthesis / responsible data** — hexagonal ACL into one canonical model; citations
   structurally required; CAP v1.2 + EDXL round-trips; consent, no-PII, hash-chained audit, fail-closed AI
   compliance proxy; role-gated geometry; the offline cache holds only anonymous answers.
4. **Usability / operational readiness** — WCAG 2.2 AA axe gate; dark ops UI, phone → EOC breakpoints;
   14 locales; status strip with data age; operator, user, release and developer guides; one-command
   reproduction; Railway/Docker/Kubernetes.
5. **Scenario fit / insight / innovation** — wildfire + flood modelled; prediction with method and
   uncertainty; anticipatory-action protocols as data; threshold alerting from live signals; the
   combination (cited deterministic AI + offline local-first + logistics + free data at ≈ $0).

## 5. Honest limitations — current

The ledgers are `docs/SPEC.md` §13 and `docs/audit/UNIMPLEMENTED_REGISTER.md`. The short list:

- The five dock panels are operator data: `DB` from the operator store under Postgres, recorded
  fixtures (`MOCK`, labelled) otherwise; the EMS overlay has no seed rows on the merits.
- Three D5/D6 modules stay registered but uncomposed by plan: rumor board, mutual aid, reunification links.
- Seven of 45 adapters cannot serve live on free public routes (ITU, CAMARA/GSMA operator-gated; USGS
  Water partial; hifld static; CNADNR no feed; EAGLE-I entitled endpoint; EFFIS no queryable service).
- The outage layer is inference ("ASSUMED offline"), not observation.
- The LLM likelihood-word guard covers English narration only.
- Offline mode is read-only and public: no queued writes.
- On the reference deployment some sources run CACHED/MOCK by configuration or upstream reachability
  (`docs/LIVE_STATUS_SOURCE_OF_TRUTH.md` lists them with the reason).

## 6. After judging

The repository becomes public and the deployment is brought online on request. The release process,
the live variables and the verification steps are `docs/RELEASE_GUIDE.md`; the operator's demo switch is
`LIVE_PICTURE` (§6 there). Roadmap: `docs/features/ROADMAP-POST-V1.md` — queued offline writes,
Valhalla/OSRM routing rungs, a production IdP, hifld merge-not-replace, the multilingual likelihood guard.

---
*Governance note: this build was produced under a governed, AI-assisted SDLC (deterministic → AI → human
— the same principle the product enforces) with the entrant holding every gate. Its durable outputs are
the committed ADRs, audits and ledgers cited above.*
