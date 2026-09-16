# ADR-042 — A record that is not about the region is not served for the region

**Status:** Accepted · 2026-09-13 · PR #29

## Context

Every source adapter declares a coverage — GLOBAL, a bbox, or a set of countries — and the redundancy
ladder consults a source for a region only when that coverage admits the region. Coverage is a statement
about the SOURCE. On 2026-09-13 the live deployment drew California's cell sites and infrastructure on
every region's map, Greek and Romanian burnt areas on each other's, and Atlanta's traffic cameras on
California's. Each came through a source whose coverage admitted the region (GLOBAL, or EU) and whose
answer — a recorded fixture made somewhere else, or a live feed pointed at another state — was about
somewhere else. Nothing asked whether the RECORD was about the region.

## Decision

At the slice seam (`src/main/live-seed.ts`, `fetchSliceOnce`) every served record is tested against the
queried region with `clipToRegion` (`src/application/shared/region-clip.ts`):

- only the domain's own placing fields are read — a GeoJSON `geometry`/`geom`, a `position`, a
  `bbox`/`area`; an unnamed pair of numbers is never taken for a coordinate;
- an entity with no placing field is never judged (a weather reading, a population figure, a news item);
- "about the region" means the entity's own bounds intersect the region's — a perimeter crossing the
  border, or a polygon enclosing the region, is about the region;
- an answer that is entirely elsewhere is **cited but not served**: the adapter was consulted and its mode
  label is recorded, and every consumer keeps the seeded slice exactly as for a primary-down source
  (Art. XVI — never a dead-end); the per-layer freshness badge follows the data, not the citation.

Coverage remains the gate that decides whether a source is asked. This rule decides what an answer may be
used for.

## Consequences

- Fixtures recorded for one region no longer appear in another under a MOCK or CACHED label. Tests whose
  premise was that bleed (open-meteo recorded over Bucharest, OpenAQ over Washington, NFHL over New
  Orleans, all served for California) relocate the fixture into the region they test.
- Characterisation snapshots changed once (15), reviewed line by line; only the bleed left.
- A live source pointed at the wrong territory (a state 511 feed) is harmless: cited, not drawn.
- Cost: one pass over each served slice's entities per composition; measured negligible against the
  network time the same composition spends.
