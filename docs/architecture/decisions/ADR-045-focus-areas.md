# ADR-045 — Lifeline and telecom sources are asked about the incidents, not the whole region

**Status:** Accepted · 2026-09-14

## Context

Every source adapter is consulted with the region as its query: one bbox, the region's outline (ADR-042).
That is right for a hazard feed (FIRMS answers a state-sized box in one call) and wrong for two sources
the COP depends on for exposure and coverage:

- **OpenStreetMap Overpass** — every hospital, fire station, substation and communications mast in
  California is a query no public Overpass mirror completes inside its timeout. The live rung failed on
  every refresh and the lifeline layer was the recorded MOCK fixture (Butte County's), which under the
  live-only picture (ADR-043) is cited but not drawn — so the live deployment had **no lifeline nodes,
  no exposure claim and no `HAZARD_BUFFER` reading** for any discovered incident.
- **OpenCelliD** — `cell/getInArea` refuses any box above 4 km² (`400 "BBOX too big - Limit to
  4,000,000 sq.mts."`, measured 2026-09-14). A region is a million times that; the live rung never
  answered.

The owner's report was "OpenCelliD used to work" — it did in the recorded fixture; the live rung never
had a query it could answer.

## Decision

1. **The adapter contract's `Region` gains an optional `focus`**: the boxes around the incidents the
   picture is being assembled for. An adapter that ignores it is unchanged.
2. **The composition consults the hazard sources first, for the whole region, then every other source
   about the focus** — one rectangle per incident cluster the served hazards form (the same clustering
   that discovers the incidents), padded by ~10 km and clipped to the region. No served hazard ⇒ no
   focus ⇒ the adapters query the region as before. Provenance order is unchanged; the per-run memo keys
   the focus, so the same source asked about a different area is a different fetch.
3. **Overpass** queries the focus boxes (all filters, each box) instead of the region.
4. **OpenCelliD** sends one ~1.9 km square centred on each focus box — the cells around each incident —
   and, given no focus and a box above the cap, degrades down its ladder **without making the request**
   that would have been refused.

## Consequences

- Lifeline nodes, exposure and the `HAZARD_BUFFER` reading exist for discovered incidents on the live
  deployment; the SitRep's exposure claim cites Overpass, and ADR-044's alerting has something to read.
- The lifeline layer is honest about its extent: nodes within ~10 km of an incident, not the region's
  every hospital. The COP already drew exposure only around hazards.
- Cell coverage is a ~1.9 km window per incident (honest limitation, stated in the adapter).
- The hybrid picture with no live hazard behaves as before (region query; Overpass may still time out and
  fall back to the recording, drawn and labelled MOCK).

Related: ADR-042 (region clip), ADR-043 (live-only picture), ADR-044 (live threshold alerting).

**Addendum 2026-09-14 (PR-H).** The free OpenCelliD key is metered per day and answered `429` on live under
8 tiles × every focused region × every 5-minute refresh. The adapter now sends at most
`SOURCE_OPENCELLID_MAX_TILES` (default 4) tiles per region and spends at most `SOURCE_OPENCELLID_DAILY_BUDGET`
(default 800) requests per UTC day; a spent budget answers RATE_LIMITED without a request, so the ladder
serves the last-known-good tiles until the day turns. The counter is in memory (a restart starts a new
count), which errs on the side of one extra cycle, never a silent overrun of the whole day.

