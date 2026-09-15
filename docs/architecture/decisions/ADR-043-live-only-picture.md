# ADR-043 — Under the live posture, the picture is live-only

**Status:** Accepted · 2026-09-14

## Context

Until this decision the live deployment served a *hybrid* picture: one hand-seeded demo incident per
region (the Bear Ridge fire, the Siret flood, …), enriched by whatever live sources served, with every
hand-seeded layer retained wherever no source served and every MOCK fixture drawn where a live rung had
fallen over. That was the honest design for a product that had to run air-gapped with zero keys — and it
is what the owner saw on the production map on 2026-09-14: "only the initial demo mock data … this must
be eliminated, and only current live reportings be shown", "the news are fake".

Three things were wrong at once, all consequences of the same choice:
- the demo incidents stayed on the board beside the discovered ones;
- a MOCK recording (GDELT's 2024 headlines, Butte County's cell sites) was drawn as if it were today's;
- a layer with no live source showed the hand-seeded demo (a demo shelter, a demo route).

## Decision

A new configuration value, `LIVE_PICTURE` (`auto` | `hybrid` | `live-only`, default `auto`), decides what
the COP is made of under `DATA_SOURCE_COMPOSITION=adapters`. `auto` resolves to `live-only` there. Under
`live-only`:

1. **Incidents are only those discovered from live hazards** (`discovered:<region>:<type>:<cell>`). The
   enrichment is still per incident, so one *blank* base per region — the region's identity and
   derivation settings, no hazards, no headline — drives it and is never served. A region whose live
   sources report nothing has no incident, and the UI says so.
2. **A MOCK answer is cited but never drawn.** The redundancy ladder still consults every source and the
   provenance lists it with its mode, so `/status` and `/sources` remain honest; its recording does not
   become the region's picture. This is applied at the slice seam, not in the engine, so an explicit
   `SOURCE_*_MODE=mock` behaves the same as a fallen-over live rung: consulted, labelled, not drawn.
3. **Map layers start blank**, then hold only what a LIVE or CACHED source served — except shelters,
   which come from the agency registry `config/shelters.json`, the same rows the database is seeded
   with (operator-maintained data, not a demo).
4. **The refresh doorbell rings for every map region**, incidents or not: "nothing is happening, as of
   now" is a state worth pushing.

`hybrid` keeps the previous behaviour by name for the offline-demo profile and for the tests that
describe it. `DATA_SOURCE_COMPOSITION=seed` (the air-gapped demo) is untouched: the hand-seeded picture
remains the whole product there.

## Consequences

- Regions without live hazards show an empty incident list on the live deployment. That is the truth,
  and it is labelled.
- SitRep, logistics and routing operate on discovered incidents. Anything keyed to a demo incident id
  (seeded resource tasks, seeded reports) is region data the operator sees through the region, not
  through the demo incident.
- The map's prediction layer for a live-only region is empty until a projection is derived for a
  discovered incident (follow-up: derive the fire cone from the discovered cluster).
- Tests describing the hybrid picture set `LIVE_PICTURE=hybrid` explicitly.

Related: ADR-042 (a record that is not about the region is not served for the region).
