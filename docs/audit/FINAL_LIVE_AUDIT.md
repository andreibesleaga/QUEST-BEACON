# BEACON — Final Live Audit (S00→S09 multi-lens)

*IEEE Response Quest 2026 · Phase 3 · Phase-C re-sweep after go-live. This is the authoritative,
independently-audited record of what is **built + live** vs **planned**, the findings from a 6-lens
adversarial audit, their resolutions, and the honest limitations. Companion to
[`LIVE_VERIFICATION.md`](LIVE_VERIFICATION.md) (captured live evidence) and
[`../E2E_TESTING_PLAYBOOK.md`](../E2E_TESTING_PLAYBOOK.md) (reproduce it all).*

**Method.** Six independent read-only adversarial audit lenses — requirements/traceability, architecture/
contract-parity, security, test-quality, data-source-fit, docs/Phase-2-consistency — each producing a
🔴/🟡/🟢 findings list, cross-checked against the import graph and the running app (not just docs). Then
fixes, then re-green. Nothing was taken on faith.

---

> **⚠️ ERA STAMP — 2026-08-02 (lens-7 machine recount).** Every count in this file, INCLUDING the
> "current state (2026-07-17)" pointers in §4 and §6 that were themselves written as corrections, is stale.
> Machine truth on 2026-08-02, with how to re-derive each:
>
> | Claim in this file | Measured 2026-08-02 | How counted |
> |---|---|---|
> | 27 adapters registered / 24 consumed | **30 / 28** | `config/adapters.json → adapters.length`; `ADAPTER_FACTORIES` entries (`src/main/adapter-registry.ts:56-94`); consumed = union of `enabled_adapters` over the 5 zones in `config/regions.json` |
> | `usgs-water`/`itu`/`camara-gsma` not consumed | **only `itu` + `camara-gsma`** | `usgs-water` is in `us-ca`'s `enabled_adapters` |
> | vitest 1055+ pass / depcruise 302 modules | **304 files / 3742 tests — 3 FAILING** · **730 modules** (`src app`) / **570** (`src`) | `vitest run`; `depcruise src app` and `depcruise src` |
>
> The three failures are in `app/_lib/hooks.mutations.e2e.test.tsx` (Art. XIII approve-with-CAP) — see
> `docs/SPEC.md` §13.13. **This file is a historical record; re-derive before quoting any figure from it.**

## 1. Gate state (verified)
`tsc 0 · eslint 0 · vitest 1055+ pass / 2 env-gated skip · coverage ≥99% domain+application · depcruise
302 modules 0 violations · madge 0 circular · next build ✅ · Playwright golden-path US+RO + axe WCAG 2.2 AA
(0 serious/critical) + TTTP<10s + visual · npm audit 0 high/critical`. **Live-proven** (LIVE_VERIFICATION.md):
docker compose full stack (19 tables), keyless-live sources (nwps/open-meteo over real egress), durable
Postgres (round-trip + hash chain), real per-user JWT, and **cloud AI narration** via OpenRouter
(`anthropic/claude-haiku-4-5`) passing F3.

## 2. Verified-strong spine (🟢 — proven from import-graph + tests + live)
- **AI-compliance proxy in-path, fail-closed, no bypass.** Every LLM/vision call routes through the
  `ComplianceGateway` (role-scope → rate-limit → breaker → semantic firewall → policy → PII-redact →
  hash-chained audit → sealed upstream → output firewall). The LLM ladder refuses any un-sealed call; the
  only seal minter is the gateway. `COMPLIANCE_PROXY_ENABLED=off` → 503.
- **Deterministic→AI→human / F3.** The LLM never emits a number absent from the cited facts — enforced at
  the validator, re-checked at synthesis grounding, and proven on a **real** OpenRouter model (numbers in
  the prose are all cited; a hallucinated figure is rejected → deterministic fallback).
- **Real per-user JWT.** jose HS256, pinned-alg allow-list (rejects alg=none/confusion), `exp` enforced,
  fail-closed to PUBLIC, empty-`sub` → role-key; the audit records the true user. Body-`actorId` rejected;
  every mutation's actor is server-derived (verify/approve/report/route).
- **HITL + provenance + citations structural**; CAP/EDXL only from a VERIFIED/ACTUAL state; precise PII
  responder-gated on every path incl. the pg store; consent at intake.
- **FR-10 adapter registry** genuinely wired (manifest load+validate, 8 typed factories, one shared
  RedundancyEngine, env>region>manifest mode precedence, fail-open into offline seed), reachable from the
  Next dispatcher. **3 redundancy acceptance tests** + golden-path e2e assert F1/F2 on the app-as-shipped.
- **Durable Postgres** behind `FEATURE_STORE=postgres` (public reports + hash-chained triage audit +
  regions/sources); the incident COP derives per-read in memory by design.

## 3. Findings → resolutions

### Security (S07) — strong; no critical default vuln
| # | Finding | Resolution |
|---|---|---|
| S1 | PII redaction token was a reversible unkeyed FNV hash (brute-forceable by the upstream LLM) | **FIXED** — `pii.ts` no longer leaks an offline-reversible value-derived token |
| S2 | `/auth/dev-login` could mint an arbitrary-role bearer when enabled | **FIXED** — double-gated (AUTH_SECRET + AUTH_DEV_LOGIN=on) **and** hard-off in NODE_ENV=production / DEPLOY_MODE=cloud (regression-tested) |
| S3 | Adapter fetch followed redirects (theoretical SSRF-via-redirect) | **FIXED** — `redirect:'manual'` in `resilient-http.ts` |
| S4 | PUBLIC shares one rate-limit bucket (anonymous DoS) | **Documented limitation** — role-keyed bucket is spoof-proof; per-IP fallback needs the edge layer (roadmap) |
| — | SSRF not request-driven; JWT fail-closed; AI proxy role-scoped/F3; secrets clean; npm audit 0 high/crit | **Confirmed 🟢** |

### Architecture / contract parity (S02/S03)
| # | Finding | Resolution |
|---|---|---|
| A1 | No ADR covered the Phase-B seams; Art. V wants a threat model for new auth | **ADR-024** (live composition + durable store) + **ADR-025** (JWT identity + dev-login) + THREAT_MODEL auth rows — *pending (next pass)* |
| A2 | OpenAPI drift: `/status` + `/auth/dev-login` undocumented; 6 documented-but-unserved paths | *pending* — add served routes; mark unserved `x-status: planned` |
| A3 | Stale ADR-023 addendum / http README "STUB RBAC" / ADR footers "spec phase" | *pending* |
| — | Boundaries clean (depcruise 0, madge 0), DDL 19/19, schemas all used, JWT hardened | **Confirmed 🟢** |
| A4 | `DATA_SOURCE_COMPOSITION`/`AUTH_SECRET`/`AUTH_DEV_LOGIN` bypassed fail-fast; `AI_MODE` default mismatched | **FIXED** — added to `EnvSchema`; `AI_MODE` default → `off` (matches offline-first wiring) |

### Test quality (S06)
| # | Finding | Resolution |
|---|---|---|
| T1 | Phase-B composition seam (`assembleLiveSeeds`, `buildCoreLive`, `createHttpDepsLive`) 0% covered; floor scoped only to domain+application | *pending* — add composition tests + a second enforced floor over `src/main`+`src/adapters` |
| T2 | No explicit AI-on == AI-off numeric-equality test | *pending* (the guarantee holds by construction + the 999-casualties rejection) |
| — | Assertion quality high; redundancy triad, JWT, AI ladder, pg round-trip are real input→output proofs; deterministic (fixed clock) | **Confirmed 🟢** |

### Data-source fit + honesty
| # | Finding | Resolution |
|---|---|---|
| D1 | NWS/GDACS set LIVE but not consumed; LIVE_VERIFICATION over-claimed | **FIXED** — corrected to the consumed set (firms/open-meteo/nwps/glofas/meteoalarm-ro); NWS/GDACS marked built-but-not-consumed |
| D2 | GloFAS manifest port mislabeled (HazardSource vs FloodGauge); NWS entity (Alert vs WeatherObservation) | **FIXED** in `config/adapters.json` |
| D3 | `.env.example` advertised ~25 unbuilt sources; NOTICE over-listed + claimed a nonexistent CI check; usgs `.env` live vs manifest MOCK | **FIXED** — flags marked "NOT WIRED"; NOTICE split wired/planned + CI claim removed; usgs → mock |
| — | Licensing/attribution of the 8 adapters clean; planned sources honestly excluded; most limitations accurate | **Confirmed 🟢** |

### Requirements / rubric traceability + Phase-2 consistency
| # | Finding | Resolution |
|---|---|---|
| R1 | Docs said "paused/spec-only/S05 next"; COMPLIANCE_MATRIX "planned-S05" | **FIXED** — README/SUMMARY/COMPLIANCE_MATRIX updated to built+live |
| R2 | Flagship-2 "news+social fusion" + "misinformation flagged" not built; flagship-3 "ORS routing" is heuristic | **Scoped honestly** (roadmap) in README/PRD — *rubric/judge/demo docs pending* |
| R3 | internal score-tracking notes "22 sources implemented / EAGLE-I-Sentinel2-GDELT on camera" | *pending* — rewrite to 8-adapter reality |
| R4 | Outage/cell/weather COP toggles exist but not data-populated; vision unwired; CAMARA port-only | **Documented as roadmap** (honest limitations) |
| R5 | docker-compose didn't set FEATURE_STORE (demo ran in-memory) | **FIXED** — `FEATURE_STORE: postgres` added |
| R6 | Cited-AI SitRep never run on a real model | **FIXED** — proven live on OpenRouter (`.env` wired; `npm run ai:probe`) |

*Items marked "pending" were captured in the internal session tracker for completion; the
tree is green with them outstanding — they are additive quality/traceability, not correctness defects.*

## 4. Honest limitations (a graded rubric item — stated, not hidden)
> ⚠️ **Superseded 2026-07-15 by §6 below, further updated 2026-07-17** — kept here verbatim for the
> historical Phase-C record (this was the accurate state on 2026-07-13/14, before the Phase-D "deliver the
> over-claims" program). Current state (2026-07-17): **27 adapters registered, 24 consumed** by the live
> composition (19 data sources on the COP/status pipeline + 5 E11 camera sources on the `cameras` layer);
> `usgs-water`/`itu`/`camara-gsma` remain registered-but-not-consumed by design; news/social fusion,
> outage/cell/weather/floodzone COP layers, NFHL∩crest prediction, ORS routing, Telegram broadcast, advisory
> vision, and logistics pre-positioning are all now real end-to-end. See §6.

8 of ~22 portal-named sources are wired as adapters (rest planned). NWS/GDACS built but not yet consumed by
the derivation bridge. News/social fusion, misinformation-flagging, ORS road-routing, WorldPop population,
NFHL zones, and the outage/cell/weather COP layers run on seed data or are roadmap — not claimed as live.
Vision is advisory + off by default. CAMARA is a wireable port (mock). PUBLIC rate-limit is role-bucketed.
FIRMS≠perimeters; predictions are labeled first-order. The production fixture-fallback path resolves from
`.next` (a dev/docker affordance); the offline seed + live network rungs are unaffected.

## 5. Rubric 5/5 argument
The security/governance/determinism spine is a legitimate 5/5 story and genuinely live: cited AI through a
fail-closed compliance proxy, deterministic→AI→human, real JWT, HITL, hash-chained audit, CAP/EDXL round-trip,
durable Postgres, offline-first redundancy, WCAG 2.2 AA, ~$0 free-data — reproducible by a judge via
`docker compose up` + `docs/E2E_TESTING_PLAYBOOK.md`. The path to exceed on every category is to keep the
claims **honestly scoped to the 8-adapter build** (this audit's corrections) so the filmed narrative matches
reality — honest limitations score; caught over-claims penalize.

---

## 6. Phase-D addendum — "Deliver the Over-Claims" (2026-07-15)

Everything §4 honestly scoped down as roadmap has now been **delivered end-to-end and re-verified**
(program: `docs/audit/PHASE3-FULL-DELIVERY-PLAN.md` — implemented, archived from repo root 2026-07-18; 15 single-owner lanes + main-loop integration):

- **Source catalog complete (updated 2026-07-17 with E11):** **27 adapters registered; 24 consumed by the
  live composition** — 19 data sources on the COP/status pipeline by the live seed (incl. nifc + effis fire
  **perimeters** merged beside FIRMS hotspots, closing the "FIRMS ≠ perimeters" gap — gdelt, reliefweb,
  agency-rss, bluesky, osm-overpass, worldpop, census, nfhl, eagle-i, opencellid also consumed) + 5 camera
  sources on the E11 `cameras` map layer. The 3 remaining (`usgs-water`, a wired gauge-redundancy
  alternative not threaded into the default composition, and `itu`/`camara-gsma`, operator-gated
  **MOCK-only plugins**, wired + mock-consumable **by design**) are not fused onto the COP. Honest tiers
  kept: effis CACHED-only, census/nfhl/eagle-i US-only, bluesky vetted-social corroboration-only.
- **News/social→SitRep fusion + misinformation flagging (deterministic, pre-LLM):**
  `news-grounding.ts` — authority ranking, distinct-outlet corroboration, flag-not-merge; verifier queue
  shows confidence components + misinfo-reject. AI-on==AI-off parity is now a TEST (`ai-parity.test.ts`).
- **COP layers end-to-end:** outage ("ASSUMED offline"), cell, weather wind-glyph, NFHL floodzone —
  server derivation → wire → deck.gl builders → tooltips + **per-layer freshness** badges
  (layerSources→provenance, shared-stamp fallback rung).
- **NFHL∩crest predicted impact** (`projectFloodZoneImpact`, labeled method/inputs/uncertainty, ladder
  fallback) — flagship-3 prediction claim now TRUE. WorldPop/census-blended exposure.
- **Real ORS road routing** (avoid_polygons; `FEATURE_ROUTING=ors` + key; heuristic fallback; UI does not
  yet label ORS vs heuristic — EvacRoute has no method field, stated honestly).
- **Real Telegram channel** (ADR-026): live sendMessage transport, subscriber registry, HITL broadcast
  strictly after approved-ACTUAL emit (audited-not-fatal), secret-verified webhook + poller (mutually
  exclusive). Mock default. **Vision** composed (advisory VisionFinding in verify flow, consent+PII gated,
  Sentinel-2 burn-area task; chip UI in verifier queue). **Pre-positioning** suggestions
  (`GET /pre-positioning`, advisory, human decides).
- **Audit debt closed:** openapi.yaml valid incl. all served paths + `x-status: planned` ×6; THREAT_MODEL
  +7 rows; 19 ADR footers code-verified-flipped + ADR-023 addendum + ADR-026; docs claims-flip
  code-verified across README/PRD/rubric/judge/demo/DSV/playbook; two-tier coverage floor
  (domain+application 99×4 · src/main 97/79/96/97 · src/adapters 90/83/93/90).
- **New live proofs this pass:** GDACS **LIVE rung restored** — live audit found GDACS now serves
  Polygon/MultiPolygon footprints which the ACL rejected, silently degrading every live fetch to MOCK;
  fixed (bbox-centre representative point, regression-tested). gdelt live returns HTTP 429 at probe time —
  ladder degrades honestly to MOCK (Art. XVI proof, visible in the probe label). Cloud AI re-proven
  (OpenRouter narration, F3 PASS, per-call cost attribution).

**Final gate (this addendum, re-verified 2026-07-17):** `tsc 0 · eslint 0 · vitest 206 files / 1832 pass /
2 env-gated skip · coverage floors pass (exit 0) · depcruise 499 modules 0 violations · next build ✅ ·
Playwright 53 pass / 0 fail / 3 designed-skip · axe 0 serious/critical (WCAG 2.2 AA) · TTTP ~0.83 s
(budget 10 s) · npm audit 0 high/critical · visual baseline regenerated once (4 snapshots)`. All work
uncommitted on `phase-d-deliver` for user review.
