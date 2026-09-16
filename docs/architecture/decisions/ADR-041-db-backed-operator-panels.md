# ADR-041 — Operator-maintained panels: reading the five dock panels from the database, and the provenance word for data nobody publishes

- **Status:** Accepted (2026-09-10) — decided in V2 work package A12. **Carries one PLAN-DELTA the owner
  should read (§ "What the plan said in one line, and what it actually costs").**
- **Deciders:** Entrant (V2 plan §2·A12) + prod-architect
- **Relates to:** ADR-013 (Drizzle behind RepositoryPort), ADR-035 §4 / ADR-036 §7 (the D4/D6 dock tier),
  ADR-039 (the natural-key ↔ surrogate-uuid translation this reuses), CONSTITUTION Art. XI (provenance is
  structural), Art. XVI (degrade, label, never dead-end)
- **Supersedes nothing.** Extends the served-provenance vocabulary defined in SPEC §2.1.

## Context

Five dock panels are served by `src/adapters/channels/http/routes/panels.ts`:

| Route | Application module | Flag |
|---|---|---|
| `GET /supplies` | `aggregate/supplies.ts` | `FEATURE_D6_SUPPLIES` |
| `GET /volunteer-teams` | `aggregate/volunteer-team.ts` | `FEATURE_D6_VOLUNTEER_TEAMS` |
| `GET /shelter-status` | `coordination/shelter-status.ts` | `FEATURE_D4_SHELTER_STATUS` |
| `GET /damage-reports` | `coordination/damage-assessment.ts` | `FEATURE_D4_DAMAGE_REPORTS` |
| `GET /ems-overlay` | `coordination/ems-overlay.ts` | `FEATURE_D4_EMS_OVERLAY` |

Every one of them is **fixture-fed at module load**: a top-level `readFileSync` of a
`fixtures/coordination/*.json` document, mapped through the real domain factory
(`panels.ts:82-84`, and the five `const` blocks at `:107`, `:147`, `:174`, `:213`, `:252`). The rows are
frozen into the process at import time. An emergency manager cannot change a shelter's occupancy, book in
a delivered supply lot, or stand a volunteer team down. The panels render, and they are inert.

That is the honest description of the defect, and it is worth being precise about what is *not* wrong:
the modules behind them are real, tested, and correct — they were simply never given a writable source of
data. Every response already carries `mode: 'MOCK'` provenance (`panels.ts:70-72`), so nothing today
overstates. The problem is not a lie; it is a product that cannot be operated.

## Decision

### 1. A panel repository port, injected — not a database import in a route

The five handlers gain their rows from a `PanelDataPort` supplied through the existing `PanelDeps`, in
exactly the shape `FEATURE_STORE` already uses for the durable stores (`build-core.ts:146` `resolveStore`).
Postgres-backed under `FEATURE_STORE=postgres`; **the fixture readers stay as the memory-posture default**,
so the offline, air-gapped and Playwright profiles behave byte-identically to today. This is Art. XVI
applied literally: the database is a rung, not a requirement.

The handlers become `async`. This costs almost nothing at the transport boundary because
`dockPanelRoute` (`feature-router.ts:691`) *already* returns `Promise<HttpResponse>` and wraps the pure
call in `Promise.resolve` — the route table's `handle` signature widens to
`PanelHttpResult | Promise<PanelHttpResult>` and the wrapper awaits it.

Rows go through **the same domain factories** the fixtures go through today (`makeSupplyFields`,
`makeVolunteerTeamFields`, `makeShelter`, `makeDamageAssessmentEntry`, `makeDamageOverlayProduct`). A row
an EM types into Directus is therefore held to every invariant a fixture row is held to — integer
quantities, quantity-requires-unit, occupancy ≤ capacity, closed enums. **A malformed row must fail loudly
at the boundary rather than render as a plausible-looking number**, because the entire claim of this
product is that a figure on the screen is one you can walk back to something real.

### 2. A database read failure degrades to the fixtures — it never empties the panel

If the store is configured but unreachable, the panel falls back to the fixture rung and says so in its
provenance, rather than returning an empty board. An empty shelter board and a shelter board with no
shelters in it look identical on a screen and mean opposite things; one of them tells an operator there
is nowhere to send people. The ladder is: **DB → fixture**, labelled at every rung (Art. XVI).

### 3. `DB` becomes a fourth *served-provenance* mode — and deliberately NOT a fourth ladder rung

This is the substantive decision, and it needs stating carefully.

`LIVE | CACHED | MOCK` is used for **two different things** that have so far been able to share one
spelling:

- **the adapter ladder rung** — a per-source *configuration* (`SOURCE_<NAME>_MODE`, the adapter manifest,
  the per-region override map). It answers: *how should this adapter try to get its data?*
- **the served-provenance mode** — `SourceRef.mode` on a response. It answers: *where did the datum I am
  showing you actually come from?*

Operator-maintained data has no place on the first axis and needs a word on the second. So:

- **`SourceRef.mode` gains `DB`** (`src/ports/interaction.ts:32`, `src/ports/infra.ts:24`,
  `command-router.ts:94`, `schemas/source-ref.schema.json`, `schemas/d5-shelter-status.schema.json`,
  `schemas/d6-incident-summary.schema.json`, `docs/api/openapi.yaml`, SPEC §2.1).
- **`adapter-manifest.schema.json` and `regions.schema.json` keep exactly three values.** No adapter can
  ever be configured to `DB`, because no adapter fetches it. Widening those would invite a config that
  cannot mean anything.

**What `DB` asserts:** *an operator-maintained record held in BEACON's own store.* It explicitly does not
imply upstream freshness, and it is not a claim about the outside world — it is a claim about who typed it
and when. `fetchedAt` for a `DB` row is its last edit, and the panel labels it as such.

**Why not just keep `MOCK`.** Because it would be the mirror image of the dishonesty this codebase is built
to prevent. `MOCK` means *recorded fixture* — invented data standing in for real data. A shelter occupancy
an EM entered an hour ago is real operational fact. Labelling it `MOCK` understates, and understating is
usually the safe direction — but here it teaches an operator to discount the one number on the screen that
came from their own organisation. Consistently mislabelling true data as fake erodes the label's meaning
just as surely as the reverse.

**Why not `CACHED`.** `CACHED` is defined as a last-known-good copy *of an upstream response*
(`schemas/source-ref.schema.json:11`). There is no upstream. It would be a straightforwardly false
statement about provenance, which is the one category of statement this system exists to make impossible.

**The ordering hazard, and how it is closed.** `news-grounding.ts:157-161` reduces a set of ambient modes
to the *weakest*, over the three-value ordering. `DB` has no defensible position in that ordering — it is
not a degraded form of `LIVE`; it is a different axis. `DB` never appears in news grounding (news is
adapter-fetched, never operator-entered), so the fix is to make that structural rather than incidental:
the reduce is narrowed to an explicit `AdapterServedMode` (the three ladder values) so that a `DB` value
arriving there is a **compile error, not a silent mis-rank**. This is the same "a re-declared contract
drifts, a derived one cannot" discipline `config/index.ts:14-27` and `d6-flags.ts` already apply.

### 4. Directus is the editing surface, and the panel is the proof

The new tables are registered in `directus_collections` (the INSERT pattern in
`docs/DEMO_INFRA_RAILWAY.md`), so an EM edits a row in the admin UI and the panel reflects it on the next
read. That round trip — *edit a row, watch the operational picture change* — is the acceptance test, and it
is also the demonstration: it is what turns five rendered fixtures into an operated system.

## Consequences

**Good.** The dock stops being a display case. Panels survive restart, the data is per-region and editable
by the people who own it, and the provenance word finally distinguishes *nobody published this, we made it
up* from *our duty officer maintains this*. Five entries leave the unimplemented register.

**Costs, stated plainly.**
- The served-mode enum widening touches ports, two schemas plus the SourceRef schema, the OpenAPI document
  and SPEC §2.1. Contract tests will catch an incomplete pass; that is what they are for.
- Every panel handler becomes async, so their unit tests gain an `await`.
- Seeded rows are **operator data with no external authority**. They must be labelled `DB` and *also*
  carry the honesty note the shelter board already carries (`panels.ts:174-190`) — the plan's A4 requires
  illustrative rows to say they are illustrative. `DB` describes *where the row lives*, never *whether the
  organisation named in it has actually committed the resource*. Those are two different claims and A4
  must keep making the second one explicitly.

**Rubric traceability.** Comprehensiveness (the logistics tier becomes operable, not merely rendered);
Technical excellence (one port, two adapters, no core rewrite); Responsible data (a provenance vocabulary
that can express operator-maintained fact without either inflating or discounting it).

## What the plan said in one line, and what it actually costs — PLAN-DELTA

Plan §2·A12 says: *"Provenance labels change from MOCK to **DB**."* That is one clause, and it is the right
call, but it is **not a one-line edit**: `LIVE|CACHED|MOCK` is written into `src/ports/interaction.ts`,
`src/ports/infra.ts`, `command-router.ts`, `natural-keys.ts`, `news-grounding.ts`, five JSON schemas, the
OpenAPI document and SPEC.md. Plan §0 also freezes API shapes.

The reading taken here is that §2·A12 **is** the owner's authorisation for this specific widening, since
the plan states the label change as a deliverable. It is implemented as an **additive** enum widening on
the response side only — no field is removed, renamed or retyped, and no existing value changes meaning —
which is why it does not read as a breaking change to the freeze. Recorded here so the owner can overrule
it in one place if they disagree; the fallback, if so, is to keep `MOCK` on the wire and carry the
operator-maintained truth in the panel's existing `sourceLabel` prose instead.
