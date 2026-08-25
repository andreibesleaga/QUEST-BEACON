# BEACON — Browser-based Emergency Awareness & Coordination Open Network

> Open-source, **local-first**, near-real-time **common operating picture (COP)** for wildfires and floods.
> One browser app that ingests free/authoritative data through pluggable adapters, fuses it into a
> **source-cited AI situational report**, and ties it to **responder logistics** — working **fully offline**
> and at ≈ $0, so a real agency could self-host it with no licensing or lock-in.
>
> **IEEE Response Quest™ 2026 · Phase 3 (product)** · entry #5320 · Apache-2.0 · by Andrei Besleaga

> ### 🔎 Judges & first-time readers — start here: **[JUDGE_MATRIX.md](JUDGE_MATRIX.md)**
> One page, built for a fast scan: what was promised vs what shipped, the five judging criteria with
> evidence, production readiness, what's genuinely new, and the honest limitations. Everything below and
> throughout `docs/` is the supporting detail behind it.

## Why it exceeds the brief

Promised a concept → shipped a **live deployment** and one-command local reproduction with zero keys.
Promised some live sources → **44 adapters**, 35 live-capable. Promised a US demo → **5 regions on 3
continents, 14 locales**. Promised WCAG 2.1 AA → shipped **2.2 AA with a CI gate**. Promised cited AI →
shipped an LLM that **structurally cannot emit a number**, provable in one toggle. Promised human-in-the-loop
→ enforced **at the type level** behind a fail-closed AI-compliance gateway. Promised CAP/EDXL → **full
round-trips**. Promised push → **SSE in ~1.7 s**, trustworthy picture in **~1 s**.

Beyond the brief entirely — all working in the live demo: early warning, COP, cited synthesis and
logistics on **one model** · anticipatory-action protocols as config · live cameras and external context
deep-links · cross-domain corroboration · a drill mode that *cannot* reach a real channel · a sustainability
disclosure endpoint. → **[JUDGE_MATRIX.md](JUDGE_MATRIX.md)** for the evidence behind each.

## Why it matters
During a wildfire or flood an emergency manager juggles half a dozen sites and stitches the picture
together by hand while minutes matter. The bottleneck is **integration + synthesis + logistics**, not raw
data. BEACON replaces that scramble with one trustworthy picture, and its distinguishing property is a
discipline rather than a feature: **the deterministic engine owns every number and cites its source · the
LLM only narrates and is structurally prevented from emitting a figure · no public alert leaves the system
without a named human approving it, enforced at the type level.**

## What is built
**A complete, tested product — not a prototype.** The full hexagonal spine is implemented, gated in CI,
and reproducible on any machine with one command.

| | |
|---|---|
| **44 source adapters** registered, 41 consumed | fire, flood, weather, alerts, infrastructure, outages, cell, air quality, population, news, vetted social, cameras |
| **14 COP map layers** | each with its own LIVE/CACHED/MOCK freshness badge |
| **5 regions · 14 locales** (RTL: ar, ur) | three continents, added by configuration — no code change |
| **4,536 tests** passing, 0 boundary violations | plus Playwright across 5 zones × 4 devices, axe WCAG 2.2 AA |
| **36 API paths**, zero documented-but-unserved | CAP v1.2 + EDXL-RM + EDXL-SitRep round-trips |
| **≈ $0 to run** | free/open data, open-source stack, one machine or free-tier cloud |

**Working end-to-end today:** the cited SitRep with deterministic news fusion · fire and flood prediction
with method/inputs/uncertainty on every figure · NFHL∩crest predicted impact · consent → triage → human
verification → CAP alert · hazard-avoiding evacuation routing with real ORS road routes · the logistics
board with tasking, shelter capacity-vs-demand and pre-positioning from predictions · real SSE push
(~1.7 s to a listening browser) · durable Postgres persistence · a fail-closed AI-compliance gateway in
front of every model call · real Telegram broadcast of human-approved alerts · live camera layers and
external context deep-links · a WCAG 2.2-AA crisis-first UI that works air-gapped.

**Live deployment:** https://quest-beacon.up.railway.app — production posture, named-account sign-in.

*Where the detail lives:* per-source verdicts in
[`audit/DATA_SOURCE_VERIFICATION.md`](audit/DATA_SOURCE_VERIFICATION.md) · the delivery history in
[`CHANGELOG.md`](CHANGELOG.md) · the contract of record in [`docs/SPEC.md`](docs/SPEC.md) · the
criteria-by-criteria evidence map in [`JUDGE_MATRIX.md`](JUDGE_MATRIX.md).

## Four flagship capabilities
1. **Unified live geospatial COP** — timestamped layers: fire, flood gauges/forecasts, weather/alerts,
   infrastructure, power outages, cell coverage; per-layer freshness badges.
2. **AI situational-intelligence fusion** — news + vetted signals + geospatial risk → a ranked, **cited**
   SitRep with escalation trend and threshold-triggered DRAFT alerts; misinformation flagged, never trusted.
3. **Responsible crowdsourced SOS + evacuation routing** — consent → AI triage/confidence → human
   verification → CAP alert; hazard-avoiding routes + shelter capacity.
4. **Responder logistics** — live resource registry, tasking, shelter capacity-vs-demand, full
   **EDXL-RM mutual-aid round-trip** + CAP v1.2 interop.

## Run it — one command, no keys, no network
From this directory (the project root — `Phase3/` in the current monorepo layout):
```bash
docker compose -f infra/docker-compose.yml up -d --build   # Postgres → migrations → app
open http://localhost:3000
```
That is the whole setup. **No API key, no account, no egress** — the stack ships air-gapped by default
(`AI_MODE=off`, sources cached/mock) and still renders a full COP with its built-in demo seed. Demo zones:
**California**, **Romania**, Spain, Greece, Philippines. Walkthrough:
[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

> ⚠️ The compose file lives at `infra/docker-compose.yml`, so the `-f` flag is **required** — a bare
> `docker compose up` from the project root exits 1 with *"no configuration file provided: not found"*.
> Tear down with `docker compose -f infra/docker-compose.yml down -v`.
> The command above is the **offline** judge path and is meant to land on the air-gapped defaults. For
> the **live** posture use `npm run docker:up` instead — it renders your `.env` into the compose
> env-file first; bare compose skips that and falls back to the offline defaults.
> To develop without Docker: `nvm use && npm install && npm run dev`.

## Gates — machine-produced, not asserted from memory
| Gate | Command | Result |
|---|---|---|
| Lint | `./node_modules/.bin/eslint .` | **0** |
| Types | `./node_modules/.bin/tsc --noEmit` | **0** |
| Unit/integration | `./node_modules/.bin/vitest run` | **4536 passed / 2 skipped (4538), exit 0** (2026-08-25) |
| …with coverage | `./node_modules/.bin/vitest run --coverage` | **green, every floor met (2026-08-24)** — and now enforced on every PR by CI. Its first CI run *failed* at 98.97% branch coverage against the 99% `src/application/**` floor: real drift accumulated since 2026-08-02, closed by covering `newsOutletProvenance`'s degrade branches. The floor was **not** lowered |
| Architecture boundaries | `./node_modules/.bin/depcruise src app` | **0 violations across 844 modules** |
| API contract | `docs/api/openapi.yaml` | parses — **36 paths · 39 operations · 65 schemas** |
| Dependencies | `npm audit --audit-level=high` | **0 high / 0 critical** (4 moderate, dev-only; re-measured **2026-08-24**). Four HIGH advisories published after the 2026-08-02 measurement were patched: **three transitive** (`brace-expansion`, `fast-uri`, `nanoid`) and **one direct dependency** (`js-yaml`, declared in `package.json`). All were patch-level; `package.json` itself is unchanged (the `^4.3.0` range already admitted the fixed `js-yaml`), so only `package-lock.json` moved |
| Build | `./node_modules/.bin/next build` | ✅ (2026-08-01 — re-run at tag time) |
| Browser | `./node_modules/.bin/playwright test` | **green — 0 failed** (2026-08-24), and now run on every PR by CI on a clean runner across 4 device projects × 5 zones. The 2026-08-10 "mid-re-baseline" state (5 moved visual baselines + 2 flake classes) is fully resolved: baselines re-minted, and the flakes root-caused to a stale reused web server (`reuseExistingServer` now off by default). Read the WebGL caveat above before quoting this |

Rows 1–3, 5–6 and 9 were re-run and re-derived on **2026-08-10**; the remaining rows carry their own
machine-produced dates rather than being restated as fresh, because *"an unverified thing is
'unverified', never 'fine'"* is the rule this project is graded against. **Every figure on this page must
be re-produced on the tagged commit; a stale gate figure in a README is precisely the drift class this
project has been fighting, and it has bitten here before** (`depcruise 0/723`, `301 files / 3615 tests`,
`Playwright 86 passed` were all wrong at the time they were displayed).
**Hexagonal boundaries are machine-enforced, not merely described** — the rules live in
[`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) and "0 violations across 844 modules" is the claim.

## Orient in 5 minutes
| Read | For |
|---|---|
| [docs/QUICK_GUIDE.md](docs/QUICK_GUIDE.md) | one-page map of everything |
| [docs/OPERATOR_GUIDE.md](docs/OPERATOR_GUIDE.md) | **how to use it** — SitRep, logistics/tasking, evacuation routing, per role |
| [docs/LIVE_PRODUCTION_GUIDE.md](docs/LIVE_PRODUCTION_GUIDE.md) | **run it for real** — every source live, real Postgres, real AI/alerts/routing, worldwide (and the honest ceiling: **35 of 44** adapters can serve live) |
| [docs/architecture/C4_ARCHITECTURE.md](docs/architecture/C4_ARCHITECTURE.md) | **architecture diagrams** (C4 L1–L3 + runtime flows) + the 37-ADR index |
| [docs/SPEC.md](docs/SPEC.md) | the contract of record — **§13 is the limitations ledger** |
| [docs/SUMMARY.md](docs/SUMMARY.md) | executive summary of the spec base |
| [docs/requirements/PRD.md](docs/requirements/PRD.md) | requirements (FR-1…16, EARS) |
| [audit/DATA_SOURCE_VERIFICATION.md](audit/DATA_SOURCE_VERIFICATION.md) | every data source, verified, with fallbacks (US · Romania · worldwide) |
| [project/TASKS.md](project/TASKS.md) | the build backlog + execution model |
| [docs/ENGINEERING_PRINCIPLES.md](docs/ENGINEERING_PRINCIPLES.md) | the quality bar every phase honors |
| [JUDGE_MATRIX.md](JUDGE_MATRIX.md) | **the state hub** — verification snapshot, Phase-2 → Phase-3 delivery map, the five judging criteria with evidence, production readiness, honest limitations, innovations, roadmap |

## Principles (enforced, not aspirational)
Provenance + citations on everything · deterministic source of truth (LLM never computes a number) ·
human-in-the-loop before any public action · **total redundancy** (every layer has a fallback ladder;
offline/air-gapped works) · free/open data only · fail-closed AI-compliance gateway on every model call ·
WCAG 2.2 AA crisis-first UX.

## Repo layout note
`audit/` (root) = the **Phase-2 carry-over audits** (Phase-2 review, clarified decisions, and the living
data-source verification catalog). `docs/audit/` = the **Phase-3 SDLC gate audits** (consistency, final,
external verification, readiness). Both are authoritative for their scope.
The GABBE governance kit that drives the AI-assisted SDLC (`agents/`, `.claude/`, `.gabbe/`) is **used at
runtime but deliberately not version-controlled** (`.gitignore:22`), so it is absent from a clone; its
durable output — decisions, ADRs, audits, task ledgers — is committed under `docs/`, `audit/` and
`project/`. Security disclosures: [SECURITY.md](SECURITY.md). Contributing:
[CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License & attribution
**Apache-2.0** ([LICENSE](LICENSE)). Data-source attributions: [NOTICE](NOTICE) — all 30 wired sources
listed with their licence and required credit. Built with free/open data (NASA, NOAA, USGS, Copernicus,
OSM, UN OCHA, and more — all verified + attributed).

*Phase-2 concept was accepted (jury 4.48/5). AI-assisted engineering (disclosed in the entry): specs and
build are produced with LLM agents under a governed SDLC with human gates — the same
deterministic→AI→human principle the product itself implements.*

---

## What is honestly not done
Everything above is built, tested and running. What follows is the short, deliberate list of what is
**not** — stated openly because honest limitation is part of this product's integrity, and because a
system used in an emergency must never overstate itself. None of it blocks the delivered product; each
item is tracked, and most are on the roadmap. Full ledgers:
**[`docs/SPEC.md` §13](docs/SPEC.md)** and
**[`docs/audit/UNIMPLEMENTED_REGISTER.md`](docs/audit/UNIMPLEMENTED_REGISTER.md)**. In short:

- **Map *contents* are not browser-asserted.** The gates run with WebGL disabled and photograph the
  accessible fallback list; one spec (`e2e/webgl-smoke.spec.ts`) proves a live GL canvas on all four
  device projects, but layer and geometry correctness rests on unit tests, not on a browser looking at
  the real map.
- **Five dock panels are fixture-fed MOCK** — supplies, volunteer teams, shelter status, damage reports,
  EMS overlay. No source adapter exists for them; their provenance says so in the UI.
- **Three D5/D6 modules stay registered but uncomposed by plan** — rumor board, mutual aid,
  reunification links.
- **Nine of 44 adapters cannot serve live on free public routes** — ITU and CAMARA/GSMA are
  operator-gated by design; GloFAS's keyless feed was decommissioned upstream; USGS-Water's OGC migration
  is partial; `hifld` is a static-2019 package held out of every region; ANM refuses our TLS handshake;
  CNADNR publishes no machine-readable feed; EFFIS and EAGLE-I need an endpoint the operating agency is
  entitled to. The other **35 can serve live**, 26 of them with no key at all. Each is named with its evidence in
  [`docs/LIVE_PRODUCTION_GUIDE.md`](docs/LIVE_PRODUCTION_GUIDE.md) §1.
- **The outage layer is inference, not observation** — "ASSUMED offline" from hazard ∩ infrastructure at
  county granularity, labelled as such wherever it appears.
- **Persistence gaps:** evacuation routes are computed per request and never saved; the SitRep/citation
  stores exist but nothing calls them (SitReps are derived fresh on every read); shelters are seeded and
  read-only. Logistics durability requires `FEATURE_STORE=postgres`.
- **Forecast evidence stops at the wire** — lead time and likelihood are computed but not yet served.
- **The LLM likelihood-word guard covers English narration only.**
- **Pre-positioning radius and cap are code constants** (20 km / top-5 per category), not configuration.
- **Telegram, vision and CAMARA default to mock/off** until their environment is set.

The gates below ran offline, on MOCK sources, with AI off — deliberately, so the numbers reproduce on
any machine with zero keys and zero egress. Running everything live is documented separately in
[`docs/LIVE_PRODUCTION_GUIDE.md`](docs/LIVE_PRODUCTION_GUIDE.md).
