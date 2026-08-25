
---

## Resolution note — 2026-07-31: the five `FEATURE_D4_*` flags default `on` (F-193 / F-155)

**Appended, not rewritten.** Everything above stands as originally decided.

**The conflict.** `docs/SPEC-FINAL-VERSION-DELTA.md:130` tabulated the five `FEATURE_D4_*` flags as
defaulting `on`; the D5 build brief said `off`. The implementing lane shipped `off` — the safe reading —
and raised it as **F-155** rather than choosing silently. The orchestrator had independently recorded the
same drift as **F-193** from the other direction. Two independent discoveries of one drift is a good signal
the findings register is doing its job.

**The decision.** The entrant resolved it to **`on`**, on 2026-07-31, consistent with the F-170 decision
for the D6 tier: these are the demonstrable coordination surfaces of a contest entry, and a capability
nobody can see scores nothing.

**Checked on these modules' own merits — explicitly NOT inherited from D6 by analogy.** The two tiers
guard different things, and the D4 tier contains the genuine privacy risk of the two:

- **FR-D4-4 damage reports** ride the unchanged consent→triage→verify pipeline. `triageStatus` is `Pick`ed
  from the report so it cannot drift, and `DamageAssessmentEntry` carries `AggregateOnly<T>` — planting
  `contactName` fails at `tsc`. Structurally, there is **one bucket per triage state and no grand total**,
  so a figure mixing VERIFIED and UNVERIFIED reports is not expressible.
- **FR-D4-3 shelter status** is additionally guarded at the **CSV export boundary** (`guardAggregateOnly`
  in `csv.ts`) — the one place aggregate data actually leaves the system.
- **FR-D4-5 EMS overlay** carries `AggregateOnly<DamageOverlayProduct>` and, per the F-48 lesson, models
  **no geometry at all**.
- **FR-D4-1 rumor board** projects news facts and **FR-D4-2 mutual aid** projects `ResourceTask` rows.
  Neither carries person data, so neither needs a guard to justify this default.

Each guard was proven by planting a violation and observing the failure, not by inspection.

**What did NOT change.** **V17/NFR-F5 still binds**: with every `FEATURE_D4_*` explicitly set `off`, all
gates stay green and no surface renders. That is a property of the off state, not a statement about the
default, and it is now asserted by its own test rather than implied by the default.

**Currently inert (F-152).** Nothing composes these modules yet — no `src/main` wiring, no panel, no route,
and they are deliberately absent from `src/application/index.ts`. So this default changes no behaviour
today; it becomes live when those seams land. **Re-read this note at that point**, because that is when the
decision starts having effect.
