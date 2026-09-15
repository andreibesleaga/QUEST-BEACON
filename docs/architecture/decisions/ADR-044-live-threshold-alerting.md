# ADR-044 — Threshold alerting evaluates the live picture

**Status:** Accepted · 2026-09-14

## Context

The threshold engine — edge detection, dwell, cooldown, the DRAFT → human approval → CAP handshake
(Art. XIII) — was complete and tested, and it only ever evaluated the hand-seeded demo specs: a fixed
reading against a fixed rule for a fixed demo incident, mode MOCK. Under the live-only picture (ADR-043)
the demo incidents are not served, so those specs proposed drafts for incidents nobody could see, and
no discovered incident could ever raise one. The owner's goal for Phase 3 is "live incidents happening
and alerting for the region US and RO".

## Decision

1. **Readings are computed from the picture just assembled**, by a pure application module
   (`src/application/threshold-evaluation/live-signals.ts`), for every (rule, discovered incident) pair
   in a region:
   - `HAZARD_BUFFER` — the incident's own hazards against the region's served lifeline nodes, through the
     same exposure derivation the COP draws; "within" is inside the hazard or closer than the rule's
     metres.
   - `GAUGE_CATEGORY` — the highest observed flood category among the region's served gauges, for FLOOD
     incidents.
   - `FORECAST_GAUGE_CATEGORY` — not derived: no live source publishes a forecast *category*, and a
     category invented from a crest figure would be a derived claim (Art. XII). Those rules keep the
     seeded/forecast path.
2. **The rules are the configured region rules** (`config/reference-data.json` → `threshold_rule`
   table), scoped by region. `GET /threshold-rules` lists all of them for the picture.
3. **The specs feed the existing evaluator unchanged.** Alert ids are stable per (rule, incident)
   (`live:<rule>:<incident>`), and the evaluator's runtime state (edge / dwell / cooldown) is carried
   across reingests in process memory, so a rule that fired five minutes ago does not fire again every
   cycle; a restart re-evaluates from a clean state, which errs on the side of a draft an operator can
   decline.
4. **Drafts are ADDED to the operators' alert store on every reingest**, never overwriting an alert that
   already exists (approved, declined, or still a draft) — the store deliberately survives refreshes.
5. **The feature layer sees the discovered incidents** through the same overlay: each incident's hazard
   footprint (the bounding rectangle of its cluster — deliberately a rectangle, the honest "somewhere in
   here") is what a road route avoids and what the projected extent reports; each incident's region is
   what an approved alert is published under.

## Consequences

- A discovered wildfire whose hotspots come within the configured distance of a lifeline node proposes a
  SEVERE `Fire` draft to the EM; a discovered flood in a region whose gauges read MODERATE proposes a
  `Met` draft. Approval remains a human act.
- Rules are edited in configuration (and, under Postgres, in the seeded table for operators to see); the
  live composition reads the configuration. Reading operator-edited rules back from the table is a
  follow-up. **Done 2026-09-14 (PR-G):** under `FEATURE_STORE=postgres` every cycle reads
  `threshold_rule` (`loadThresholdRules`, scoped by the region's config id) and evaluates those; the
  configuration file is the fallback when the table cannot be read, never "no rules". GET /threshold-rules
  lists what was evaluated.
- **Hybrid picture (2026-09-14, PR-G):** the overlay exists under BOTH pictures. Live-only replaces the
  seeded demo specs (their incidents are not served); hybrid keeps them and ADDS the live specs, because the
  demo incident is still on the map. Until PR-G a deployment on `LIVE_PICTURE=hybrid` evaluated no live rule.
- Every alert carries the founding source of its incident as provenance.

Related: ADR-043 (live-only picture), ADR-014 (threshold debounce), ADR-033 (forecast triggers).
