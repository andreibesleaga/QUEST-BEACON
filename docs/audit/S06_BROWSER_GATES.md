# S06 — Gate-8 Browser Gates (F13 · F14 · golden path)

**Persona:** eng-qa / eng-frontend · **Scope owned:** `e2e/**`, `playwright.config.ts`, snapshot dirs, this doc.
**Surface under test:** the REAL running COP — a **production build** (`next build && next start`), offline
in-memory seed, `AUTH_DEV_TRUST_HEADER=on` (honoured in prod via `app/_lib/real-http.ts`).
**Browser:** cached Chromium 1228 (offline; no browser download). **Date:** 2026-07-12.

> **Verdicts up front:**
> - **Gate-8 (golden path): PASS** — the full monitor → assess → decide → act flow drives green for BOTH
>   regions across all 4 projects, including verify-a-report and the HITL DRAFT→ACTUAL promotion.
> - **F13 (axe WCAG 2.2 AA): FAIL — 1 real serious violation** (`definition-list`) on the COP page. Every
>   other surface (command palette, SOS form, Layers popover) is clean. This is a genuine app a11y bug
>   (reported below with `file:line`), not a test artifact.
> - **F14 (TTTP < 10s): PASS** — real measured **~0.63–0.68 s per region** against the prod build.
> - **Visual regression:** 4 baselines **created** this run (dark/light × desktop/tablet/phone); regression
>   protection begins on the NEXT run. In this same run they then **compared green** (deterministic).

---

## 1. Commands (exact)

```bash
source ~/.nvm/nvm.sh && nvm use                       # Node 24.18.0
# Prod build + start (the playwright webServer runs this; shown for a manual run):
rm -rf .next && AUTH_DEV_TRUST_HEADER=on npm run build
AUTH_DEV_TRUST_HEADER=on npm run start -- --port 3100

# Mint the visual baselines the first time (creates snapshots, protection starts next run):
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ./node_modules/.bin/playwright test visual.spec.ts --update-snapshots

# All gates, all 4 projects (desktop dark/light, tablet, phone):
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ./node_modules/.bin/playwright test
```

## 2. Result summary (authoritative full run, prod build, all 4 projects)

```
37 passed
 4 failed        ← all four are the SAME real a11y bug: COP-page `definition-list` (serious)
 3 skipped       ← the one-shot DRAFT→ACTUAL UI promotion runs on desktop-dark only (state isolation)
(1.5m)
```

| Gate | Spec | Result |
|---|---|---|
| 1. Golden path (us-ca + ro) | `e2e/golden-path.spec.ts` | **PASS** — 2 regions × 4 projects |
| 1a. Verify a report (VERIFIER, HITL) | in golden path | **PASS** |
| 1b. DRAFT→ACTUAL promotion via UI (HITL) | `golden-path.spec.ts` (one-shot) | **PASS** (desktop-dark) |
| 1c. DRAFT→ACTUAL RBAC gate (Art. XIII) | `golden-path.spec.ts` (API) | **PASS** — PUBLIC 403, VERIFIER ≠ 403, ×4 |
| 2. axe WCAG 2.2 AA — COP page | `e2e/a11y.spec.ts` | **FAIL** — 1 serious (`definition-list`), ×4 |
| 2. axe — command palette / SOS / Layers | `e2e/a11y.spec.ts` | **PASS** — 0 serious/critical, ×4 |
| 3. Visual regression | `e2e/visual.spec.ts` | **PASS** — 4 baselines created, then compared green |
| 4. TTTP < 10s (F14) | `e2e/perf.spec.ts` | **PASS** — real ms below, ×2 regions ×4 projects |

---

## 3. Golden path — what is actually driven (both regions, real app, no stubbing)

WebGL is disabled in-test so the deterministic computed geometry is asserted via the accessible
`MapFeatureList` fallback (see §6). The flow, per region:

- **MONITOR (as PUBLIC):** load COP, select region, wait for the truth picture (computed features + SitRep
  provenance). Assert real geometry rows (`ca-hotspot-1` / `ro-gauge-1`), open Layers → per-layer
  **FreshnessBadge** (MOCK → "Unavailable"), toggle a layer, open the SitRep **Provenance** popover (F1).
- **ASSESS (F2):** SitRep shows the COMPUTED **trend** + **ranked priorities** list, and per-field
  **citation chips** (`firms` / `glofas` / `open-meteo`) — with **zero** `uncited-field` markers. This holds
  in the offline `deterministic-only` rung (only the LLM summary is hidden; citations/trend/priorities render).
- **DECIDE:** Decision-support tab shows deterministic figures beside narration + the "human approval is
  required" gate; the DRAFT-alerts surface is reachable (as PUBLIC it exposes **no** approve control).
- **ACT (as PUBLIC → VERIFIER):** submit an SOS via the consent-gated form (submit disabled until consent).
  Assert PUBLIC sees **no** `verify-report-btn` (Art. XIII) and **no precise geometry** — us-ca report shows
  the coarse `39.700` and never the responder-only `39.703` (Art. XIV). Then flip the demo `role-switcher`
  to **VERIFIER**: the precise `39.703` now renders (Art. XIV), the verifier queue populates, and approving
  the first pending report transitions it to **VERIFIED**.
- **HITL DRAFT→ACTUAL (one-shot):** as VERIFIER, the computed DRAFT alert (`SEVERE Fire`) is listed with a
  DRAFT badge + "Review & approve"; clicking it promotes the alert and the badge flips **DRAFT → ACTUAL**.

### Constitutional gate (Art. XIII), asserted at the API on every project (deterministic)

```
POST /api/v1/alerts/ca-alert-draft-1/approve                          → 403 FORBIDDEN ("requires VERIFIER, actor is PUBLIC")
POST /api/v1/alerts/ca-alert-draft-1/approve  (x-beacon-role: VERIFIER) → not 403 (RBAC passes)
```

---

## 4. F13 — axe WCAG 2.2 AA (tags: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa)

Real violation counts by impact (per surface; each scanned on all 4 projects, identical results):

| Surface | critical | serious | moderate | minor |
|---|---|---|---|---|
| **COP page (full)** | 0 | **1** (`definition-list`) | 0 | 0 |
| Command palette (open) | 0 | 0 | 0 | 0 |
| SOS intake form | 0 | 0 | 0 | 0 |
| Layers popover | 0 | 0 | 0 | 0 |

**Gate = 0 serious/critical → FAIL on the COP page** (the other three surfaces pass). One real serious
violation; no critical, moderate, or minor. See the bug below.

### REAL app a11y bug (report only — not fixed here per scope)

- **Rule:** `definition-list` (impact **serious**) — "`<dl>` elements must only directly contain properly
  ordered `<dt>`/`<dd>` groups (or `<div>`/`<script>`/`<template>`)."
- **Location:** `app/_components/panels/sitrep-panel.tsx:118` — the SitRep fields `<dl>`. Each per-field
  `<div>` group (lines ~119–126) contains `<dt>` (121) + `<dd>` (124) **and** a `<FieldCitations>` `<span>`
  (line 125). The citation `<span>` inside the `<dl>`'s `<div>` group breaks the dt/dd grouping rule.
- **Repro:** load `/`, wait for the SitRep panel, run axe with the WCAG tags → 1 serious `definition-list`.
- **Suggested fix (for the app team):** render the citation chips **inside** the `<dd>` (or move them out of
  the `<dl>` entirely) so each `<dl>` > `<div>` group contains only `<dt>`/`<dd>`. Do NOT weaken the a11y
  scan to hide it.

---

## 5. F14 — TTTP (time-to-truth-picture), real measured ms

Measured against the **production build** (`next build && next start`) — a fair perf number, not a
dev-server artifact. TTTP = `page.goto` start → the COP renders its first fully-provenanced picture
(computed map features + SitRep provenance). Budget **< 10 000 ms**.

| Region | desktop-dark | desktop-light | tablet | phone |
|---|---|---|---|---|
| **us-ca** (wildfire) | 646 ms | 656 ms | 645 ms | 630 ms |
| **ro** (flood) | 651 ms | 679 ms | 666 ms | 648 ms |

All **~0.63–0.68 s**, comfortably under budget (navigation `responseEnd` ≈ 7–8 ms). **PASS.**

> Dev-server note: an earlier run against `next dev` was **flaky** — first-hit route/chunk compilation and
> HMR intermittently pushed the ro-region truth-picture past the 20 s wait on later projects. Switching the
> webServer to a prod build removed per-request compilation and made every gate deterministic. The dev
> server is not a fair basis for a perf claim; these numbers are prod.

---

## 6. Visual regression

`e2e/visual.spec.ts` captures one full-page COP baseline per project, gated behind the rendered truth
picture, with WebGL disabled (deterministic accessible fallback instead of an opaque GL canvas) and the
transient toast region masked; animations are disabled via `playwright.config`.

- **Baselines CREATED this run** (4): `e2e/visual.spec.ts-snapshots/cop-{desktop-dark,desktop-light,tablet,phone}-linux.png`.
- **Regression protection starts on the NEXT run.** In this same full run the compare step then ran green
  (the baselines are stable/deterministic), but a first run only *creates* baselines — no "no-regression"
  claim is made from a baseline-creation run.

---

## 7. WebGL / headless caveat (disclosed)

WebGL **is** available in the cached headless Chromium 1228 (the MapLibre `map-canvas` mounts). The specs
nonetheless **disable WebGL** (`helpers.disableWebGL` neuters `canvas.getContext('webgl*')`), driving
`MapView` into its labelled accessible fallback `MapFeatureList`. That table lists the same deterministic
computed geometry (hazards, gauges, infrastructure, exposure, reports, shelters) with coordinates — so the
assertions are on genuine engine output (Art. XII), the PII gating is DOM-verifiable (Art. XIV), it's stable
for visual regression, and it doubles as WCAG 2.5.7 non-pointer coverage. This is a deliberate determinism
choice, not a masked failure.

## 8. Determinism notes (config changes, within scope)

- **`workers: 1` / `fullyParallel: false`** — the 4 projects share ONE in-memory server; serial execution
  prevents the golden path's stateful mutations (verify a report, promote the single seeded DRAFT alert)
  from racing across workers.
- **Prod webServer** — `next build && next start` (see §5).
- **Tablet → Chromium** — `devices['iPad (gen 7)']` defaults to WebKit, but only Chromium 1228 is cached
  offline (`webkit-2311` absent); the tablet project keeps the iPad viewport but runs on Chromium.
- **One-shot promotion** — the single seeded DRAFT alert promotes exactly once, so the real UI promotion
  click runs only on `desktop-dark` (`test.skip` elsewhere → the 3 skips); the always-true RBAC gate is
  asserted at the API on every project.

## 9. Final gate verdicts

- **Gate-8 (golden path): PASS.** monitor → assess → decide → act drives green for us-ca and ro on all 4
  projects; verify-a-report, HITL DRAFT→ACTUAL promotion, Art. XIII (PUBLIC 403) and Art. XIV (no precise
  PII for PUBLIC; precise for VERIFIER) all hold.
- **F13 (axe WCAG 2.2 AA): FAIL** — 1 real serious violation (`definition-list`) on the COP page
  (`app/_components/panels/sitrep-panel.tsx:118`); 0 critical; command palette / SOS / Layers all clean.
  Fix the `<dl>` structure and this gate goes green.
- **F14 (TTTP < 10s): PASS** — ~0.63–0.68 s per region (prod build).
- **Visual: baselines created** (protection starts next run).

`tsc --noEmit` = 0 and `eslint .` = 0 after all changes. No commits. Dev/prod servers started for the run
are stopped.
