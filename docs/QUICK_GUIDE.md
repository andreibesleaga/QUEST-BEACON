# BEACON — Quick Guide (one page)

> The 60-second orientation. Everything here links to the authoritative doc — this page never duplicates
> content (single-source rule), so a count that lives elsewhere is *pointed at*, not restated.

## What
Open-source (Apache-2.0), local-first, near-real-time **common operating picture** for wildfires & floods.
Deterministic engine owns every number · LLM narrates cited facts and cannot emit a figure · a named human
approves every public action. IEEE Response Quest 2026, Phase 3. North-Star: **cited picture < 10 s**.

## Run
From the project root (`Phase3/`), one command, no keys, no network:
```bash
docker compose -f infra/docker-compose.yml up -d --build   # Postgres → migrations → app
open http://localhost:3000
docker compose -f infra/docker-compose.yml down -v          # tear down
```
⚠️ The `-f` is **required** — the compose file lives in `infra/`, so a bare `docker compose up` from the
project root exits 1 with *"no configuration file provided: not found"*.
Without Docker: `nvm use && npm install && npm run dev`. Defaults are air-gapped (`AI_MODE=off`, sources
cached/mock) and still render a full COP from the built-in demo seed.

**Gate commands** (exact — see `agents/AGENTS.md` §2, local-only, mirrored in `README.md`):
```bash
./node_modules/.bin/eslint .            # 0
./node_modules/.bin/tsc --noEmit        # 0
./node_modules/.bin/vitest run --coverage
./node_modules/.bin/depcruise src app   # 0 violations
./node_modules/.bin/playwright test
npm audit --audit-level=high
```
The measured results live in **one place — `README.md` § Gates** — and are deliberately not restated here.

## Where things live
| Need | Read |
|---|---|
| First contact / gates / honest limitations | `README.md` |
| **Architecture diagrams (C4 L1–L3 + runtime flows) + ADR index** | `docs/architecture/C4_ARCHITECTURE.md` → `docs/architecture/decisions/ADR-001…036` (+`ADR-008a`) |
| Contract of record — **§13 is the limitations ledger** | `docs/SPEC.md` + `docs/api/openapi.yaml` + `schemas/` |
| Requirements | `docs/requirements/PRD.md` (FR-1…16 + EARS) |
| **Quality bar / Definition of Done (every phase)** | `docs/ENGINEERING_PRINCIPLES.md` |
| Config (12-factor, everything env) | `docs/architecture/CONFIGURATION.md` + `.env.example` |
| Data sources + verdicts (LIVE/CACHED/MOCK) + consumption counts | `audit/DATA_SOURCE_VERIFICATION.md` (§0 = wired/consumed authority; §10 = deep fallback catalog) |
| Data-source attribution + licences | `NOTICE` |
| Build backlog (~496 atomic tasks) | `project/TASKS.md` → the 10 epic files in `project/tasks/` (E0, E1, E3–E10 — there is no E2 file); findings register: `project/TASKS-FINAL-VERSION.md` |
| Pinned free/OSS libraries | `docs/LIBRARIES.md` |
| Demo walkthrough + TTTP budget | `docs/DEMO_SCRIPT.md` · shot list of record: `docs/FINAL_LIVE_TEST_AND_DEMO.md` §3 |
| Tests / CI / evals | `docs/TEST_PLAN.md` · `docs/CI_CD.md` · `docs/CI_CD_PLAN.md` · `docs/EVAL_PLAN.md` |
| **UI/UX design charter** | `docs/UI_UX_DESIGN.md` — modern dark-first system, WCAG 2.2 AA, motion, ⌘K |
| Responsible-data rules | `docs/RESPONSIBLE_DATA.md` |
| Security posture + what CI does and does **not** scan | `SECURITY.md` |

> **Not in a clone:** `agents/` (AGENTS.md, CONSTITUTION.md, skills, memory) and `.gabbe/` are the GABBE
> governance kit — used at runtime but **gitignored** (`.gitignore:22`), so those paths exist only on the
> author's machine. Their durable output is committed under `docs/`, `audit/` and `project/`.

## Iron rules (never break)
LLM never computes numbers (F3) · every SitRep field cited (F2) · provenance+freshness on every response
(F1) · HITL before any public action (F8) · every AI call through the fail-closed compliance proxy (F16) ·
every layer has a fallback ladder, offline works (F5–F7) · free/open data only · no auto-commit ·
AGENTS/CONSTITUTION frozen · **an unverified thing is "unverified", never "fine"** — ask of every claim
*what executes it?*, and cite the `file:line` in CODE.

## Status
Built, gated and documented; **at the S08 hard stop**, in the pre-submission repo/video/live-verification
pass. The largest untested surface is that **nothing has yet run against live third-party APIs** — every
gate to date ran offline with MOCK sources and AI off; live verification followed with real keys
(per-source record: `audit/DATA_SOURCE_VERIFICATION.md`).
Open findings and honest limitations: `docs/SPEC.md` §13 and `docs/audit/UNIMPLEMENTED_REGISTER.md`.
