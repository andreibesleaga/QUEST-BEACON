# Changelog

All notable changes to BEACON are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Final audit of code and documentation (2026-09-16).** `docs/audit/FINAL-AUDIT-2026-09-16.md`: the
  inventory of what is implemented and supported, the method, and every stale or wrong statement found
  in the current-truth documents (more than forty: adapter/live/keyless counts, ADR/module/table/test
  figures, dock-panel and CI/SAST status, three feature flags that never existed, private-file and
  contest-mechanics references in `llms.txt`) with its correction in the same change. `llms.txt`
  rewritten to the final product. Cited news outlets now carry a declared licence when their
  `source_record` row is materialised (`NEWS_OUTLET_LICENSE`), closing the writer behind the 2026-09-15
  422; the upsert heals a NULL licence without ever overwriting a stored one.

- **Fix — `/status` and `/sources` no longer 422 on a legacy unlicensed `source_record` row (2026-09-15).**
  Under `FEATURE_STORE=postgres` the source read model projected each row through the SourceRecord
  factory, which (rightly) refuses a missing licence; a row written before the provenance sink carried
  the licence stayed NULL because the upsert never repaired it, and that single row failed both reads
  for everyone. The view — which exposes no licence — is now projected straight from the row, and the
  sink's upsert heals a NULL licence on the next poll (`coalesce(excluded.license, license)`) without
  ever erasing a stored one.
- **Installable, offline-capable COP (ADR-047, 2026-09-15).** Behind the build-time flag `NEXT_PUBLIC_PWA`
  (default `off`): web-app manifest + generated icons, a hand-written module service worker
  (`public/sw.js`, zero dependencies) that keeps the app shell, the hashed build assets and the last
  **PUBLIC** picture on the device and serves them when the network drops; a locale-aware banner names
  when the served copy was saved. Only anonymous answers to PUBLIC GET routes are ever stored (contract
  test against `docs/api/openapi.yaml`); writes, auth, `/me`, the SSE stream and role-gated reads are never
  touched; navigations are stored under the same anonymous-only gate. Every saved page and data entry is
  keyed by URL + locale (the `beacon-locale` cookie via the Cookie Store API), so a copy saved in one
  language never answers another; a browser without that API (older than Chrome 87 / Firefox 132 /
  Safari 18.4) saves no pages or data at all — only the build assets — rather than risk a wrong-language copy. The banner tracks saved copies per URL, names the oldest one on
  screen, appears only while a worker controls the page, and says "no saved picture yet" rather than
  claiming one. Off builds unregister the worker and purge its caches. Proven in a real offline reload
  (`e2e/pwa-offline.spec.ts`).
- **Overpass identifies itself** (`SOURCE_OSM_OVERPASS_USER_AGENT`, default a descriptive BEACON string):
  the public instances answer `406` to a client without a User-Agent, which every live attempt was.
- **GloFAS names its configuration gap**: a live-configured region with no `SOURCE_GLOFAS_POINTS`
  reporting point inside it now logs that, not a phantom "cache was cold" (`RedundancySpec.cachedReason`).
- Documentation set for release: `docs/USER_GUIDE.md`, `docs/RELEASE_GUIDE.md`,
  `docs/DEVELOPER_HANDBOOK.md`; dated status documents rewritten to the current truth.

- **Live-demo delivery increment S1–S3 (2026-08-07…10).** S1 closed five standing §13 findings: the five
  formerly-unserved catalog endpoints (`GET /incidents/{id}`, `/incidents/{id}/exposure`,
  `/threshold-rules`, `/audit-events`, `/health/adapters`) are served and RBAC-gated with `x-status:
  planned` removed from the OpenAPI (F-323/F-401); `POST /alerts/{id}/all-clear` documented; the
  retention purge is scheduled (`startBackgroundJobs`, default-on hourly — F-280); logistics durable
  under `FEATURE_STORE=postgres` (`makePgLogisticsStore`); `CAPACITY_MATCH_DIRECTION` wired; shelters
  load from operator-editable `config/shelters.json`. S3 then: five D4/D6 dock panels composed end-to-end —
  supplies, volunteer teams, shelter status (logistics dock), damage reports, EMS/CEMS damage overlay
  (SitRep dock): `routes/panels.ts` GETs + connected panels, flag-gated, fixture-fed MOCK (labelled in
  provenance), malformed-envelope-safe (labelled error state, never a crashed dock). The FR-8
  **shelter capacity-vs-demand widget** feeds from the served map projection (rows missing a figure are
  dropped, never fabricated). The map's accessible fallback (`MapFeatureList`) now covers **all 14
  layers**. The auth/session slice persists in **sessionStorage** (survives a same-tab reload; dies with
  the tab; forged tokens verify to PUBLIC). **Air-quality** cited SitRep fact + the
  `openaq`/`airnow`/`sensorcommunity` adapter trio. **Population figures cite their serving adapter**
  (census→worldpop→nri ladder; seeded figures stay ungrounded — F-66(b) re-closed). **D-38 executed:**
  registry now **44 registered / 41 consumed / 3 not consumed** (`itu`/`camara-gsma` by design; `hifld`
  held pending a merge-not-replace slot design); new sources appended per-slot so no precedence moved.
  `news:<host>` outlet provenance so every SitRep news citation resolves inside its own envelope.
  Judge-repo export policy: `docs/JUDGE_REPO_MANIFEST.md`. Five panel i18n namespaces translated across
  all 13 non-English catalogs. Visual baselines re-minted for the planned UI delta (entrant decision).
  Final hardening (2026-08-10): `EvacRoute.engine` (`ors`/`heuristic`) tagged by every route producer and
  rendered as an honest engine label in the route panel; the dead `?refresh` SitRep param removed from
  the OpenAPI; Playwright `reuseExistingServer` defaults off (a reused stale server was the true cause of
  both observed "flakes") and the golden-path API-gate test proves VERIFIER RBAC non-mutatingly (404 on a
  nonexistent id) so the one-shot UI click is the suite's only alert promoter.
- **Localization (wave MW-A — 14 locales).** `en zh-Hans hi es ar fr bn pt-BR id ur ru ro fil el`
  (**RTL: `ar`, `ur`**), architecture per ADR-030. Two-part registry — `config/locales.json` (data,
  validated by the new `schemas/locales.schema.json`) + `src/config/locales.ts` `LOCALE_IDS` (a literal
  union = the type-level truth **and** the path-traversal allowlist), drift-guarded by a test. ICU
  catalogs at `messages/<locale>.json` with an honest `_meta` block; **231 message keys** across 16
  namespaces; `tests/i18n/catalog-parity.test.ts` gates key parity, ICU-argument parity, per-locale ICU
  compilation, `_meta` honesty and the absence of blanks.
- **i18n access layer** `app/_lib/i18n.tsx` — next-intl's core `createTranslator` behind a context whose
  DEFAULT is the English catalog. **No i18n routing, no middleware, no `[locale]` segment, no
  `NextIntlClientProvider`, `next.config.mjs` untouched.** Components render identical English with or
  without a provider (every pre-existing component test and visual baseline stayed valid), a raw key can
  never render, and message keys are compile-checked. Locale is the **`beacon-locale` cookie**, resolved
  server-side in the async root layout ⇒ correct `<html lang>`/`dir` and localized `generateMetadata` on
  the first byte. Fallback = server-side deep merge over English + `getMessageFallback`.
- **Bundled script fonts** — `@fontsource/noto-sans-{arabic,devanagari,bengali}` script subsets at weights
  400 + 700 (6 CSS imports, ~300 KB of `woff2` on disk; the packages' Latin subsets are deliberately not
  imported since Inter covers them), behind one per-glyph `--font-sans` stack; self-hosted, no CDN.
- **Multilingual CAP** (`src/adapters/interop/cap-mapper.ts`) — `CapOptions.translations` +
  `capTranslationsFor()` emit one `<info>` per language (region language first, English always; a
  language with no copy is skipped rather than mislabelled), and `capMachineValuesAgree()` asserts
  `category`/`urgency`/`severity`/`certainty`/`responseType`/`web`/`area` are identical across blocks —
  enum tokens are never translated. With no translations the output is byte-identical to before.
- **Presentation-only locale plumbing** — `InteractionRequest.locale?`, `NarrativeRequest.locale?`,
  `SynthesizeSitRepInput.locale?`. English or absent ⇒ byte-identical prompt; the LLM still emits no
  figure (Art. XII / F3 unchanged).
- **Closed vocabulary at the presentation edge** — `ProjectedWeather` now ships a `compass` token
  (8-point) + `observedAt`, and the wind label is composed client-side with locale-correct compass
  abbreviations (Romanian `V`/`SV`/`NV`, Russian `С`/`СВ`/`З`…). The engine's English `label` remains the
  CLI/API fallback.
- **Gates** — `tests/architecture/rtl-logical-css.test.ts` (logical CSS only; the map canvas never
  mirrors) and `e2e/i18n-rtl.spec.ts` (Arabic first-paint RTL, raw-key-leak scan across `ar`/`ro`/
  `zh-Hans`, axe under both Arabic and Chinese, one RTL visual baseline per viewport project).
- **Required region fields (MW-B first slice)** — `config/regions.json` regions now carry required `iso`,
  `tz` and `languages[]`, validated by the new `schemas/regions.schema.json`; the domain `Region` carries
  them too (`iso` enforced as ISO-3166-1 alpha-2 by a factory invariant).
- `llms.txt` at Phase3 root — AI-agent orientation file (absolute rules, architecture map, exact
  commands/gates, verified counts) reflecting the audited state as of 2026-07-18.
- `docs/SUBMISSION_CHECKLIST.md` — consolidated IEEE portal #5320 submission checklist (repo-scope
  decision, live validation, video, portal mechanics; deadline 9 Oct 2026).
- Baseline security response headers in `next.config.mjs` (nosniff, X-Frame-Options DENY,
  Referrer-Policy); `.gitignore` hardened to `.env*` + `!.env.example`.
- **Plan-file consolidation (2026-07-18):** all implemented execution plans are summarized in this
  changelog and archived/banner-marked in place — `docs/audit/PHASE3-FULL-DELIVERY-PLAN.md`
  (Phase-D program, moved from repo root), `MASTER_PLAN.md` (Phases A/B/C), and
  `docs/features/LIVE_VIEWS_FEATURE_PLAN.md` (E11) are HISTORICAL records. The **single pending plan
  of record** lives at the repo root: `IEEE/Quest/CURRENT-PLAN.md` — **Localization (i18n)**, the
  last feature before the first release tag (plan awaiting approval; no implementation started).

### Changed

- **Public-release pass (2026-10-10).** Audit documents relocated (`docs/audit/v1/` for the Phase-2 carry-over, `docs/audit/DATA_SOURCE_VERIFICATION.md`, dated `FINAL_AUDIT-2026-06-29.md` / `FINAL_LIVE_AUDIT-2026-08.md`) with every reference rewritten; README gains three live screenshots; access wording says the repository is public and the deployment is brought online for the judging window and on request; local machine paths, a third-party address in a feed fixture and references to internal strategy documents removed. Recorded in `docs/audit/FINAL-AUDIT-2026-09-16.md` §8.
- Visual baselines regenerated **once** for the tablet and phone viewports — the locale switcher wraps the
  COP toolbar at those widths. This was the single regeneration budgeted for MW-A.
- `config/regions.json`: the misleading `units` field was **removed**. It was declared and never read, and
  it implied a per-region imperial display mode that does not exist — BEACON displays SI everywhere,
  always labelled. `docs/SPEC.md` §3.5 and `docs/architecture/CONFIGURATION.md` §12a corrected to match.
- Documentation trued to code for this wave: SPEC §3.5, CONFIGURATION §9/§12a, `.env.example`,
  `docs/features/LOCALIZATION_FEATURE_PLAN.md` (PLAN → IMPLEMENTED), `llms.txt`.
- Final pre-release audit fix-pass (2026-07-17/18): documentation counts trued to code
  (27 adapters registered / 24 consumed / 1832 tests / 13 layers); per-region
  `source_mode_overrides` made operative (per-region registries; env > region > manifest);
  `config/regions.json` ids aligned to the manifest with a drift-guard test; reference CLI
  invocable via `npm run cli`; test hardening (fake timers, injectable clock, fixture provenance
  annotations, NASA Worldview bbox clamp).

### Fixed

- **An unconfigured region silently inherited California's bounding box (finding F-06).** The composition
  root held a hardcoded ISO map and a duplicated bbox fallback table, so a region without configured
  geography would have queried every source over California and rendered the result as if it were local.
  Both tables are removed: geography comes only from the region registry, and an unconfigured region keeps
  its hand-seeded, labelled picture. This also made "add a region by config" true for the first time.
- **A real WCAG contrast defect found by the new browser gates.** The light-theme warn colour `#9a6b00`
  measures **4.41:1** on the light background — under AA for text below 14 pt, which the machine-
  translation notice uses. Replaced with a new `--warn-strong` token (`#8a5f00`, measured **5.31:1**);
  the dark theme already cleared 4.5:1 and is unchanged.
- Stale `.env.example` default: `DEFAULT_REGION_ID` example was `ca-flagship`, a region id that does not
  exist in `config/regions.json` (the real default is `us-ca`).

### Security

- **`npm audit` had drifted to 3 HIGH** — `brace-expansion`, `postcss`, `sharp` — all pre-existing
  transitive advisories whose only `npm audit fix` remedy was an absurd downgrade (`next@9.3.3`). Fixed
  properly with `overrides` pinning the patched versions (`brace-expansion@^5.0.8`, `sharp@^0.35.3`,
  `postcss` pinned to the direct devDependency, itself bumped to `^8.5.23`) ⇒ **0 high, 0 critical**.
- Remaining advisories are **4 moderate, dev-only**: one esbuild dev-server issue reached through
  `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`. It affects the local
  migration tooling's dev server only, never the shipped app or any production path, and the offered fix
  is a breaking `drizzle-kit@0.18.1` downgrade. Accepted and named honestly rather than papered over.

---

### MW-B/MW-C/MW-D additions (still within [Unreleased], 2026-07-27 → 2026-07-31)

> The [Unreleased] entries above this subsection cover MW-A (localization) only. This subsection covers
> the region-generic engine + zones + storm hazard family (MW-B), prediction/probability (MW-C), and the
> four "differentiator" tiers — predicted impact, anticipatory action, warning excellence, governance +
> coordination/aggregate modules (MW-D). Full detail: `project/TASKS-FINAL-VERSION.md`,
> `docs/SPEC.md` §13 (Known limitations).

#### Added

- **3 new zones as config only** — `es`, `gr`, `ph` (`config/regions.json`), no region-specific
  application code, via the region-generic composition engine (ADR-031). Registered total: **5 shipped
  zones**. `ph` ships on a real national alert source (PAGASA via the `wmo-swic` CAP relay, F-21 resolved).
- **Storm hazard family** (ADR-032) — `STORM_SURGE` exposure with a new `CONE` hazard kind, wired with
  zero engine change (`risk-intersection.ts` is hazard-kind-agnostic, F-18).
- **Prediction/probability tier (MW-C)** — GloFAS exceedance probability + tendency reach the domain;
  labeled likelihood classes; a ranked Outlook wired into SitRep synthesis for the first time (F-17).
- **Predicted-impact quantifications (D1)** — clipped exposure, comms-blackout/alert-reach, shelter
  demand + clearance, all pure/reproducible/aggregate-only/method-labeled.
- **Multilingual CAP now has a real production caller** (F-53) — `src/adapters/alerting/cap-text.ts`,
  wired through `src/main/feature-seed.ts`. Previously the machinery existed with zero callers for two
  entire waves; every emitted CAP carried exactly one English `<info>` block regardless of region.
- **The Art. XIV retention-purge executor** (F-25) — `src/application/governance/retention-sweep.ts` +
  a Postgres store (`src/adapters/persistence/retention-store.ts`) implementing `RetentionStorePort`.
  Closes the "stamped but never enforced" defect. **Caveat, not yet closed:** nothing in the composition
  root schedules or triggers it (no cron, HTTP route, or CLI command) — see `docs/SPEC.md` §13.4.
- **Anticipatory-action engine (D2)** — EAP config schema (6 IFRC elements), ensemble member-counting
  evaluator, replay-determinism test, suggestions into pre-positioning; on-camera panel gated OFF by
  default (`FEATURE_ANTICIPATORY_PANEL`).
- **Warning excellence (D3)** — CAP profile validator (blocking pre-emit), Update/Cancel/ALL-CLEAR
  lifecycle + delivery counts, ISO 22324 pictograms, plain-language templating, opt-in TTS, 93-char
  cell-broadcast preview.
- **Governance (D4)** — hash-chained trigger/warning ledger; SOP chain with delegated fallback approver;
  DRILL mode with a structural (type-level + composition-level) guarantee that no drill artifact reaches
  a real channel.
- **The D5/D6 differentiator modules** (rumor board, mutual-aid EDXL-RM, shelter status, damage/needs,
  EMS overlay · volunteer teams, supplies, reunification link-out, incident-summary export, aggregate
  casualty tally) behind `FEATURE_D4_*`/`FEATURE_D6_*`, all default **`on`** (dated Resolution notes on
  ADR-035 and `ADR-036-warning-excellence-and-response-modules.md`). **Built, guarded, and tested; not yet
  composed into any panel or route** — see `docs/SPEC.md` §13.3. The default is currently inert.
- `GET /incidents/:id/summary` CSV/JSON export (F-172), RESPONDER+ RBAC, `FEATURE_D6_INCIDENT_EXPORT`.
- Ten `NEXT_PUBLIC_FEATURE_D{4,6}_*` browser mirrors with a boot-blocking parity refine that treats an
  unset mirror as inheriting its server flag (F-173/F-240).

#### Changed

- **Exposure figures are now clipped, with named rungs, and the unclipped rungs say so in their own
  text (F-23).** Previously `blendPopulation` summed every served population estimate with no clipping
  while the UI claimed "residents within the exposed area" — a live honesty defect, now fixed at the root
  (`src/application/derivation/derive-cop.ts`).
- **Inbound EDXL-RM is now schema-validated before mapping (F-31/F-156) — a deliberate, breaking
  behaviour change.** A partner sending a non-standard member, a malformed `sentDateTime`, or a message
  with no `originatingMessageID` was previously accepted; it is now **rejected with a typed
  `PARSE_ERROR`** (`src/adapters/interop/edxl-rm-mapper.ts:268`). Any integration relying on the previous
  lenient behaviour must send conformant EDXL-RM.
- **A source not enabled for a region no longer appears in that region's `/status` projection at all**
  (previously it appeared MOCK-labelled) — a more honest surface (F-56).
- **Adapter count corrected: 30 registered / 28 consumed / 2 not consumed** (`itu`, `camara-gsma` —
  operator-gated MOCK-only by design). Three MeteoAlarm/WMO-SWIC rows (`meteoalarm-gr`, `meteoalarm-es`,
  `wmo-swic`) added in MW-B were previously undercounted in README/SUMMARY/llms.txt/DATA_SOURCE_VERIFICATION
  (stale at 27/24/3); `usgs-water` is now consulted (and cited) for `us-ca`'s gauge slot alongside `nwps`,
  so it moved from "not consumed" to "consumed."

#### Fixed

- **The logistics board's "Task" button now works end-to-end in a real browser (F-24/F-140/F-190/F-191/
  F-192).** Three independent defects stacked: the state-machine vocabulary the `<select>` posted
  disagreed with the domain (F-24); the client's hand-authored wire type used the wrong field name and
  made a server-required field optional, so a tasking POST either 400ed or silently created a stray task
  (F-140); the resource list itself 400ed because the client sent no `incidentId` query at all (F-192);
  and even after those, a new task could only legally start at `PROPOSED`, while the control defaulted to
  a later state (F-191). Fixed at the root by deriving the client wire type from the server's own parse
  contract instead of hand-duplicating it, so a future rename is a compile error, not a runtime 400.
  Verified by a real end-to-end test through the unmocked `api.taskResource` and by the full Playwright
  suite (86 passed / 0 failed at Checkpoint #4).

#### Known limitations (added this block — see `docs/SPEC.md` §13 for the full indexed list)

- The D5/D6 differentiator modules are built and tested but not composed (F-152/F-171–F-174) — no panel,
  no route, no `src/main` wiring; their flags defaulting `on` currently changes nothing observable.
- The retention-purge executor (F-25) is real but unscheduled — no cron/route/CLI triggers it in the
  running app (new finding, F-280).
- The forecast DRAFT-alert path is fully tested but unreachable from the running app (F-81).
- `es`/`gr`/`ph` browser coverage (F-72) is in progress, not yet verified — `e2e/helpers.ts` now derives
  its region list from `config/regions.json` instead of hand-declaring two entries, and a new
  `e2e/zones.spec.ts` gate exists, but this docs pass could not run Playwright to confirm a passing result
  (a sibling lane owns the browser suite exclusively this session). See `docs/SPEC.md` §13.8.
- Two of seven curated family-reunification URLs answer automated fetch with HTTP 403 — liveness is
  unconfirmed, not disproven; one has no positive evidence at all (F-177).
- FR-D4-5 is the Copernicus Emergency *Management* Service damage overlay, not an EMS/casualty-transport
  feature (F-150) — a scope clarification, not a defect, but a misreading that must not recur.
- The C1.4 likelihood-word guard does not police a translated narration (F-62) — deterministic English
  fact claims are unaffected.
- `docs/architecture/decisions/ADR-036-response-coordination-tier.md` is an orphaned file containing only
  a Resolution note, no original ADR body (new finding, F-281) — the real content is in
  `ADR-036-warning-excellence-and-response-modules.md` §7.

### MW-E/E3 docs-truth corrections (still within [Unreleased], 2026-08-01)

Documentation-only. No `src/**` or `app/**` behaviour changed; these entries **remove over-claims**, they
add no capability. Every verdict was taken from the code, not from a prior document.

- **Five endpoints in the `docs/SPEC.md` §2.2 "canonical" catalog return 404 and are now marked
  `🚫 NOT SERVED (v1)` (F-323, absorbing F-401):** `GET /incidents/:id`, `GET /incidents/:id/exposure`,
  `GET /threshold-rules`, `GET /audit-events`, `GET /health/adapters`. Verdicts proven by running BOTH
  route tables (`resolveRoute`, `src/adapters/channels/http/routing.ts:304-318`, and
  `handleFeatureRoute`, `src/adapters/channels/http/routes/feature-router.ts:551-557`) directly on each
  path; the rows are annotated with the deciding `file:line` and **kept, not deleted**. New ledger entry
  `docs/SPEC.md` §13.11; matching notes added to §1.1 (FR-3), `docs/requirements/PRD.md` §8 and
  `README.md`. `docs/api/openapi.yaml` was already honest on all five (`x-status: planned` + "NOT YET
  SERVED (v1)") and is unchanged.
- **`GET /incidents/:id/exposure` sits inside the FR-3 golden thread**, so the thread cannot be walked
  end-to-end with `curl` as documented. Stated explicitly rather than quietly dropped: the exposure ENGINE
  ships and is served as `exposure[]` on `GET /regions/:id/map`
  (`src/application/map-projection/map-projection.ts:511`).
- **Withdrawn false claim:** `docs/SPEC.md` said `GET /health/adapters` "always 200 while the service is
  up" (F-401). Only the single-segment `/health` is wired (`routing.ts:88-89`).
- **Demo beat struck (F-324):** `docs/DEMO_SCRIPT.md` scripted filming an "adapter-health board
  (`/health/adapters`)" that has no component in `app/_components/**` and whose route 404s. Replaced with
  `GET /sources` (real per-source effective mode + `fetchedAt`, `routing.ts:94-95`) plus the COP's
  existing per-layer freshness badges.
- **Browser-gate caveat disclosed in `README.md` and `docs/SPEC.md` §13.8 (F-322):** all **11** Playwright
  spec files call `disableWebGL(context)` (`e2e/helpers.ts:19-29`), forcing `MapView`'s `failed` branch
  (`app/_components/map/MapView.tsx:53-54,75-89`). The axe result, the visual baselines and the TTTP
  number therefore describe the accessible FALLBACK; **the shipped deck.gl/MapLibre map has zero browser
  coverage**, and "Playwright 86 passed / 0 failed" is evidence about the fallback only. Previously
  disclosed only in `docs/audit/S06_BROWSER_GATES.md` §6.
- **Added `e2e/webgl-smoke.spec.ts`** — the one spec that runs with WebGL **enabled**, asserting the real
  MapLibre canvas mounts inside `[data-testid="map-canvas"]` with a live GL context.
  ⚠️ **WRITTEN BUT NOT YET RUN** (Playwright is owned exclusively by another lane in this session); until
  it reports green, the map's browser coverage must still be described as zero.
  **↳ Superseded 2026-08-01/02 — it has since been run. It passed on desktop and failed on tablet + phone,
  which surfaced F-414; F-414 was then diagnosed and fixed, and the spec's desktop-only scope was removed,
  so it now asserts the real map on all four device projects. See the repo-presentation subsection below.**

### Repo-presentation & docs-truth pass (still within [Unreleased], 2026-08-02)

Judge-facing surfaces only — `README.md`, `NOTICE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
`docs/QUICK_GUIDE.md`, `.env.example`. **No `src/**`, `app/**`, `e2e/**` or `tests/**` behaviour changed.**
Every figure below was re-derived by running the command on 2026-08-02, not copied forward.

#### Fixed

- 🔴 **The README's headline "one command" did not work from a cold clone.** It said `docker compose up`,
  but the compose file lives at `infra/docker-compose.yml`, so from the project root that command exits 1
  with *"no configuration file provided: not found"* (machine-confirmed). The compose file's own header
  (`infra/docker-compose.yml:7`) always documented the correct form. `README.md`, `docs/QUICK_GUIDE.md`
  and `.env.example` now all use `docker compose -f infra/docker-compose.yml up -d --build`, with the
  reason stated inline. This was the single most likely first command a judge would type.
- **Dead link in the README's closing "Principles" paragraph** — it linked `agents/CONSTITUTION.md`, but
  `agents/` is gitignored (`.gitignore:22`, 0 tracked files), so the link 404s in any clone. Removed, and
  the gitignored-governance-kit fact is now stated explicitly in both `README.md` and `docs/QUICK_GUIDE.md`
  instead of being a broken link.
- **Stale gate figures in the README**, the recurring defect class this project has been fighting. It
  claimed vitest `3719 passed` (a `--coverage` run on 2026-08-02 measured **3723 passed / 2 skipped**, and
  a plain run later the same day, after new test files landed, measured **306 files / 3771 passed /
  2 skipped**); `depcruise 0/726` (now **0/729**); Playwright `170 passed`; and, in the F-322 caveat,
  `86 passed / 0 failed` (the last recorded run is **186 passed / 30 skipped / 0 failed**, 2026-08-01).
  The gates are now a table, every row carrying the date it was produced, with both vitest measurements
  shown rather than one silently chosen. Rows this lane did not personally run — `next build` and
  `playwright test`, the latter owned exclusively by another lane — are marked with their 2026-08-01
  origin instead of being restated as fresh, and the table closes with an explicit instruction to
  re-produce every figure on the tagged commit.
- **Stale F-322 caveat.** The README said "**all 11** e2e spec files call `disableWebGL(context)`" and that
  `e2e/webgl-smoke.spec.ts` was "written but not yet run". Re-counted: **13 tracked spec files, 11 of which
  call `disableWebGL`** — `sse-push.spec.ts` and `webgl-smoke.spec.ts` do not — and webgl-smoke **has** run.
- **`docs/QUICK_GUIDE.md` was two SDLC phases out of date** — it stated *"Status: spec-complete, PAUSED
  before S05 implementation (awaiting user GO)"* and indexed the ADRs as `ADR-001…023`. Rewritten against
  the built repo (ADR-001…036 + 008a; current status; working run + gate commands).
- **`SECURITY.md` over-claimed one control and was scoped to a project that had not been built yet.** It
  said *"pre-release, spec-complete… in-scope once code lands"*, and listed **SAST** among the CI controls.
  There is no CodeQL or Semgrep job — `ci.yml`'s `security` job is SCA + secrets (`npm audit`, gitleaks,
  OSV-Scanner) and nothing else, and it is **non-blocking** (`continue-on-error: true`, `ci.yml:149`).
  Replaced with a wired/not-wired table naming the workflow file for each row.
- **`.env.example` carried two mutually contradictory adapter-consumption counts** (24 in one paragraph,
  27 in another; the README said 28). Removed both rather than adding a third: the file now asserts only
  what is machine-re-derivable — `config/adapters.json` ↔ `ADAPTER_FACTORIES`
  (`src/main/adapter-registry.ts:56`) is an exact **30 ↔ 30** match — and points at the single authority
  (`docs/audit/DATA_SOURCE_VERIFICATION.md` §0) for the consumption split. `NOTICE` was given the same
  treatment; its wired list already covered all 30 ids correctly.
- **`CODE_OF_CONDUCT.md` shipped the placeholder `[maintainer contact — set on publish]`** as its
  enforcement channel. Replaced with the two real private channels (GitHub private security advisory /
  the maintainer address in the repo profile), consistent with `SECURITY.md`.

#### Added

- **F-414 is now disclosed in the README's honest-limitations section** — as *diagnosed and fixed*, since
  the fix landed while this pass was in flight and the code is the authority. The live map measured
  **378 × 0 on phone and 776 × 0 on tablet**: nothing in the shell's ancestor chain has a definite height
  and `MapView`'s success branch renders a single `absolute inset-0` child contributing zero content
  height, so the slot collapsed and clipped the map away; desktop survived only because at `lg` the track
  is a row and the tall aside sized the slot. Fixed with a `min-h-80` floor
  (`app/_components/cop-layout.tsx:95`) and gated on **all four** device projects, asserting the CSS floor
  itself and not merely the resulting height (`e2e/webgl-smoke.spec.ts:113-159`).
- **The Playwright gate row is explicitly marked as needing a re-run.** Removing `webgl-smoke`'s
  desktop-only scope changed the suite *after* the 186/30/0 run, so 4 of those 30 skips no longer exist.
  Quoting the old figure as current would be exactly the drift this pass exists to remove; it is dated and
  flagged instead. This lane does not run Playwright (another lane owns it exclusively).
- **`.env.example` is now complete against the code.** `grep -r 'process.env.' src app scripts` has no
  entry absent from it. Newly documented: `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL` (a real shipped browser flag
  read at `app/_components/panels/sitrep-panel.tsx:101` that was undocumented); the per-source override
  **pattern** `SOURCE_<PREFIX>_{URL,TIMEOUT_MS,INTERVAL_SEC}` (`src/adapters/_shared/source-config.ts:63-68`),
  documented once rather than 30×, and noting that `_INTERVAL_SEC` when unset is **omitted**, not defaulted
  to `INGEST_DEFAULT_INTERVAL_SEC`; and a test/script-only block for `DATABASE_URL_TEST`, `OLLAMA_LIVE`,
  `OLLAMA_MODEL` and `PROBE_ROLE`.
- **README first-screen restructure** — what it is · why it matters · the one command · *what is honestly
  not done* now all appear before any wave history. No limitation was removed or softened; F-414 was added.

#### Verified (no change needed)

- **Secrets scan of the working tree AND the full `git log -p --all` history: clean.** No `sk-…`,
  `sk-or-v1-…`, `AKIA…`, `ghp_…`, Telegram bot-token, Slack `xox…` or `BEGIN … PRIVATE KEY` match anywhere.
  The ~1.6k grep hits for `api_key|secret|token|password` are all identifiers or explicitly-labelled test
  fixtures (e.g. `'test-secret-do-not-use-in-prod-…'`). No `.env*` file other than `.env.example` has ever
  been committed (`git log --all --name-only`).
- **`TODO`/`FIXME`/`XXX`/`HACK` across `src/ app/ e2e/ tests/`: 2 hits, both inside
  `tests/i18n/catalog-parity.test.ts`, which exists to FORBID such placeholders in the message catalogs.**
  No un-owned TODO anywhere in the codebase.
- `LICENSE` is Apache-2.0; `NOTICE` covers all 30 wired sources with licence + required credit; C4 carries
  10 Mermaid diagrams and is one click from the README.
- Largest tracked binary is `package-lock.json` (604 KB); the largest image is a 405 KB phone screenshot
  (`docs/screenshots/`, 36 files, 6.5 MB total). No build output, coverage or `node_modules` is tracked.

## [0.1.0] - 2026-07-17

Phase-B (go-live) + Phase-C (6-lens audit + fixes) + Phase-D ("deliver the over-claims" full delivery) +
E11 (Live Views), summarized. Full, verified gate status and honest limitations:
`docs/audit/FINAL_LIVE_AUDIT-2026-08.md` §6, `docs/audit/S09_RELEASE_GATE.md`, `docs/FINAL_LIVE_TEST_AND_DEMO.md`.

### Added

- **Phase-B go-live:** source adapters wired into the live composition (previously seed-only); durable
  Postgres store (`FEATURE_STORE=postgres`, 19 tables, hash-chained triage audit); real per-user JWT
  identity (jose HS256, pinned-alg allow-list, fail-closed to PUBLIC); cloud AI narration proven live on
  OpenRouter (`anthropic/claude-haiku-4-5`), F3 no-invented-numbers holding on a real model.
- **Phase-C:** independent 6-lens adversarial audit (requirements/traceability, architecture/contract-
  parity, security, test-quality, data-source-fit, docs/Phase-2-consistency) and remediation, incl. a
  fixed GDACS live-rung regression and corrected NWS/GDACS consumption claims.
- **Phase-D — 27-adapter catalog:** 14 new source adapters (GDELT, ReliefWeb, agency-RSS, Bluesky, NIFC,
  EFFIS, OSM-Overpass, WorldPop, Census, NFHL, EAGLE-I, OpenCelliD, ITU, CAMARA/GSMA) added to the
  original 8, bringing the registered catalog to 22 data-source adapters (27 with the 5 E11 camera
  sources below; see `docs/audit/DATA_SOURCE_VERIFICATION.md` §0 for the wired/consumed breakdown).
- **Phase-D — news/social → SitRep fusion:** deterministic news-grounding (authority ranking
  OFFICIAL>MEDIA>SOCIAL, corroboration counts, misinformation flagged-not-merged, minted before the LLM
  so AI-on == AI-off; `src/application/sitrep-synthesis/news-grounding.ts`), with an `ai-parity.test.ts`
  regression guard.
- **Phase-D — new COP layers:** outage ("ASSUMED offline" derivation), cell coverage, weather wind-glyph,
  and flood-zone (NFHL) layers, each with per-layer freshness badges; **NFHL∩crest predicted flood
  impact** (labeled method/inputs/uncertainty).
- **Phase-D — real ORS road routing** behind `FEATURE_ROUTING=ors` + `ORS_API_KEY` (hazard-avoiding
  heuristic fallback, never a dead end).
- **Phase-D — real Telegram broadcast** of approved-ACTUAL alerts (Bot API, HITL-gated, PII-redacted,
  audited-not-fatal on failure; secret-verified webhook + poller, mutually exclusive).
- **Phase-D — advisory vision assist** in the verify flow (consent + PII-screen gated, Sentinel-2
  burn-area task) and **pre-positioning-from-predictions** suggestions on the logistics board.
- **E11 "Live Views":** 5 link-out camera sources (Caltrans CCTV, ALERTCalifornia, Windy, 511 DOT,
  CNADNR-RO) as a default-off `cameras` COP layer (bringing the registered adapter count to 27, 24
  consumed); deterministic external-context deep-links (Google Earth 3D/Maps/Street View/NASA
  Worldview…) in the SitRep panel; a flag-gated, consent+HITL, permanently-"Unofficial" citizen
  live-view link on SOS — all link-only (never embed/proxy/rehost; the engine and LLM never read a
  pixel), attributed, and provenance-stamped (ADR-027/028/029).
- **Hexagonal core** — canonical domain model (Incident, HazardGeometry, Gauge, Exposure, SitRep,
  Citation, SourceRecord, Alert, Resource, and related entities), application use-cases (risk
  intersection, priority ranking, threshold evaluation, evac routing, capacity matching, SitRep
  synthesis), and ports P1–P15 behind an anti-corruption layer.
- **Six deterministic/AI engines wired into the live path** — exposure, priority ranking, trend
  classification, predictions (labeled fire cone / flood inundation), evac routing, decision support —
  computing from seed **inputs**, not hand-authored outputs.
- **AI-compliance gateway** — in-path, fail-closed chokepoint on every model call (prompt-injection /
  PII / policy screens); the app is fully functional with the LLM disabled (deterministic-only path).
- **Next.js Common Operating Picture** — MapLibre map, AI intel panel, logistics board; drivable
  end-to-end **offline** for two regions (California wildfire, Romania flood).
- **HTTP API** with the mandatory `{ data, provenance[], freshness }` envelope; SitRep responses carry
  `citations[]`. CAP v1.2 / EDXL interop with JSON-Schema validation at emit.
- **Persistence** — Drizzle schema + migrations (19 tables), proven to apply on Postgres 16.
- **Governance & CI/CD scaffolding** — `.github/workflows/{ci,nightly,release}.yml` (Phase 1 of
  `docs/CI_CD_PLAN.md`), Dependabot, PR template, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, this
  changelog, and a pre-commit hook.

### Security

- Fail-closed JWT/RBAC on protected routes; precise PII/geometry gated to the responder view.
- Hash-chained append-only audit log; server-derived audit actor (a forgeable-actor bug found by the
  browser gates was fixed and regression-guarded).
- XXE-hardened XML parsing; `npm audit` clean of high/critical (moderate dev/build-only advisories
  documented).
- Supply-chain evidence pipeline authored for release: CycloneDX SBOM + SLSA L2 provenance + Sigstore
  cosign keyless signing (tag-driven `release.yml`).

### Known limitations (current — see `docs/audit/FINAL_LIVE_AUDIT-2026-08.md` §6 and
`docs/audit/S09_RELEASE_GATE.md` for the full, current honest-limitations list)

- 3 of 27 registered source adapters are not consumed by the live composition: `usgs-water` (a
  gauge-redundancy alternative, not threaded into the default composition) and `itu` + `camara-gsma`
  (operator-gated MOCK-only plugins by design).
- Per-user identity is a role-derived stub; full JWT `sub` claims are a follow-up.
- Live messaging / IPAWS origination transports are MOCK by design (Telegram flips to live with
  `CHANNEL_TELEGRAM_MODE=live` + a bot token).
- CI/CD workflows are authored but unpinned (major-tag + `# TODO(pin)`) and unproven on a real runner
  until first push; Phase-2 gates (mutation, chaos, BDD, evals, SAST, container scan, api-surface,
  benchmark) are not yet wired — they need the scripts/tools tracked in `.github/PINNING_CHECKLIST.md`.
- The UI does not yet distinguish an ORS-routed evacuation route from the heuristic fallback
  (`EvacRoute` carries no method field).
- EFFIS is CACHED-only (endpoint unconfirmed); EAGLE-I outage layer shows "ASSUMED offline" (a
  hazard∩infra inference, not confirmed per-address outages).

### Historical limitations (S00 / pre-go-live era — resolved by Phase-B, kept for the record)

- ~~Source adapters do **not** yet feed the live composition — the running app computes over in-memory
  seed inputs (MOCK-mode provenance), not live/cached feeds.~~ Resolved Phase-B: adapters feed the live
  composition; 27 registered, 24 consumed (see above).
- ~~Drizzle persistence is a config path, not the demo default (the running app is in-memory).~~
  Resolved Phase-B: `FEATURE_STORE=postgres` is a proven durable path (in-memory remains the offline
  default per Art. XVI).
- ~~`docker compose up` full-stack has not been executed end-to-end.~~ Resolved Phase-B: proven
  end-to-end (`docs/audit/LIVE_VERIFICATION.md`).
- ~~FR-16 CAMARA telecom adapter absent (documented v1.1 plugin).~~ Resolved Phase-D: `camara-gsma`
  adapter built, registered, and mock-consumable by design (operator-gated, MOCK-only).

[Unreleased]: https://example.invalid/BEACON/compare/v0.1.0...HEAD
[0.1.0]: https://example.invalid/BEACON/compare/HEAD
