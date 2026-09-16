# ADR-028 — External view links as a pure deterministic link builder (no adapter)

- **Status:** Accepted (2026-07-17)
- **Deciders:** Entrant + prod-architect (user-directed, E11 "Live Views" wave CW0/CW3b)
- **Relates to:** ADR-027 (live camera sources — the sibling link-only surface), ADR-001 (application-layer
  pure use-case), ADR-012 (config-for-everything — `FEATURE_EXTERNAL_VIEWS`), CONSTITUTION Art. XII
  (advisory-not-fact — no engine/AI reads a linked view), Art. XVI (no external dependency to dead-end)
- **Threat model:** `docs/architecture/THREAT_MODEL.md` TB4 T5.11 (link-out href-injection guard — the
  builder emits only fixed-host https URLs from typed coordinates)

## Context

For any incident (and any clicked map point) a user wants one-click access to third-party 3D/satellite/
street/weather context — Google Earth 3D of the fire, NASA smoke imagery, Street View of the evac road.
Those providers already run public web apps addressable by a coordinate in the URL. The question was
whether to model this as another networked adapter (with keys, caching, a redundancy ladder) or as
something simpler.

It is simpler: a deep-link is a **pure function of a coordinate**. There is no upstream to call, no key to
hold, no response to parse, no freshness to stamp — so an adapter would be pure overhead.

## Decision

1. **A framework-free pure builder, not an adapter.** `buildExternalViews(position, opts?):
   readonly ExternalViewLink[]` (`src/application/external-views/external-views.ts`) returns
   `{label, provider, kind, url}[]` with **no network, no key, no clock, no state**. Coordinates are
   formatted to a fixed 5 decimals (≈1.1 m) and comma/`%2C`-encoded exactly where each provider's verified
   template requires — so the same input always yields the same list and every URL is **exact-match
   unit-testable** (`external-views.test.ts`, CA + RO). Trivially correct, offline, and cost-free.

2. **Eleven verified templates (nine 2026-07-17, two 2026-08-11):** Google Maps, Google Satellite, Street
   View, Google Earth 3D, Bing Aerial, OpenStreetMap, Windy, Zoom Earth, NASA Worldview (the last receives
   a ~1° bbox centred on the point), **NASA FIRMS active fires** and **Google Flood Hub** (see the 2026-08-11
   addendum). Kinds: `map | satellite | street | 3d | weather | imagery | fire | flood` — the last two added
   with the hazard links so the chip states what the view IS, rather than filing a fire feed under
   "imagery" (drives the UI icon/grouping; translated across all 14 locales).

3. **Link-only doctrine (shared with ADR-027).** Every URL opens the provider's own site in a new tab; no
   engine or AI component reads content from a linked view or derives a fact from it (Art. XII). Rationale:
   **liability** (we don't host or endorse the imagery), **bandwidth** (no proxy/DoS surface), **licensing**
   (Google Maps AUP forbids tile/imagery reuse but **sanctions the Maps-URLs deep-link scheme** —
   `?api=1&map_action=…` — which is exactly what the builder emits; a raw fixed-host https anchor is the
   compliant integration), and **CORS** (these are session web apps, not keyless embed targets).

4. **The href-injection guard is structural.** Because every URL is built by string-interpolating a
   `toFixed(5)` **number** into a hard-coded `https://<fixed-host>/…` template, no user- or upstream-supplied
   string can ever reach the href — there is nothing to sanitize because nothing untyped is interpolated
   (see THREAT_MODEL T5.11). Links render with `target=_blank rel="noopener noreferrer"`.

5. **Default-ON.** `FEATURE_EXTERNAL_VIEWS` defaults on (user Q4) — no key, no cost, no network, so every
   incident gets the context panel out of the box.

6. **Surfaced in the SitRep panel; the map right-click context-menu is deliberately deferred.** The links
   render in an `ExternalViewLinks` component mounted in the SitRep decision-support panel as a
   `<details>` "External views" section, positioned via a **zero-network** `positionForIncident`
   helper (`app/_lib/incident-position.ts`) over the already-fetched `MapData`. The planned map right-click
   context-menu was **not built** — a deliberate deferral, not an omission: the panel fully satisfies
   **FR-VIEW-1** (external context for the active incident), and a per-point map context-menu is future
   polish with its own interaction-design pass.

## Consequences

- **Positive.** The most intuitive "see it" interaction in the app (click → Google Earth 3D of the fire)
  with zero infrastructure, zero cost, zero egress, and 100% deterministic testability. Nothing to break in
  an air-gapped demo — the links are always present (whether the provider's site is reachable is the
  viewer's browser's concern, never BEACON's).
- **Negative / accepted.** Street View / Bing-oblique coverage is gappy in rural US and Romania — the link
  still opens (falls back to the provider's map); the UI labels the links as context, never promises
  coverage. Zoom Earth's URL scheme is unofficial-but-stable (documented as such). **Copernicus Browser /
  EO Browser were dropped:** EO Browser was **sunset 2026-03-20**, and Copernicus has no verified raw-
  coordinate URL scheme — parked on the roadmap rather than shipped as a dead or guessed link.
- **Deferred (documented).** Map right-click context-menu for an arbitrary clicked point (FR-VIEW-1 is met
  by the incident panel today).

## Alternatives considered

- **An `ExternalViewsPort` + adapter with caching/redundancy** — rejected: there is no upstream to call or
  fail, so a port/ladder is pure ceremony; a pure function is strictly simpler and more correct.
- **Embedding the provider maps in an iframe** — rejected: same link-only doctrine as ADR-027 (AUP/CORS/
  liability); these are session apps, not keyless embed targets.
- **Shipping EO Browser / Copernicus links anyway** — rejected: EO Browser is sunset; a guessed Copernicus
  coordinate scheme could silently break. Honest roadmap entry instead.
- **Building the map context-menu now** — deferred: the SitRep panel already delivers FR-VIEW-1; the
  context-menu is additive polish.

## Implementation complete: Yes (E11 Live Views, 2026-07-17)

`buildExternalViews` (`src/application/external-views/external-views.ts`, 11 templates as of 2026-08-11, exact-match tested
CA+RO); `ExternalViewLinks` UI mounted in the SitRep panel via `app/_lib/incident-position.ts`
(zero-network `positionForIncident`); `FEATURE_EXTERNAL_VIEWS` default-on. Gate green after CW0/CW3b (tsc 0
· eslint 0). See THREAT_MODEL T5.11 and ADR-027 for the shared link-only doctrine.

---

## Addendum — 2026-08-11: the two HAZARD views (NASA FIRMS active fires, Google Flood Hub)

**Context.** The original nine templates are *generic* context (what does this place look like). BEACON is a
wildfire-and-flood COP, so the two views a responder actually wants next to an incident — the live global
fire picture and the forward flood forecast — were missing. Both are free, keyless, worldwide, and
link-only, so they inherit the doctrine above unchanged.

**Decision.**
- **NASA FIRMS active fires** — `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@{lon},{lat},{zoom}z`,
  kind `fire`, regional zoom 8. Chosen over Copernicus EFFIS/GWIS, Zoom Earth's fire layer and
  FireMappers because it is (a) worldwide rather than EU-centred, (b) near-real-time MODIS+VIIRS, (c) the
  **same upstream that feeds BEACON's own `firms` adapter** — so the link lets a judge or responder
  corroborate our fire layer against its source instead of against an unrelated third party, and (d)
  already licensed and attributed in `NOTICE` (U.S. Government / NASA, public domain).
- **Google Flood Hub** — `https://sites.research.google/floods/l/{lat}/{lon}/{zoom}`, kind `flood`,
  basin zoom 10. AI river-flood forecasts up to 7 days ahead across 150+ countries — genuinely
  complementary to our own NWPS/GloFAS gauges and NFHL zones, and covering many regions no gauge adapter
  reaches. Advisory only; the engine never reads it (Art. XII).

**How the templates were verified — and why it mattered.** Neither provider publishes a deep-link spec, so
both were verified against the provider's **own code/behaviour**, never a guess or a blog post (Research
Policy, Tier 1):

- *FIRMS*: its client bundle (`/dist/firms_map.*.js`) parses `location.hash`, splits on `@`, and validates
  `checkValidLatLon(parts[0], false)` → ±180 and `checkValidLatLon(parts[1], true)` → ±90 ⇒ **longitude
  first**. The same parser bounds zoom to 0..22 and accepts `d:` ∈ {6hrs,12hrs,24hrs,48hrs,7days}.
- *Flood Hub*: the route is server-rendered — `/l/39.76/-121.62/10` returns the app with its own state as
  `[39.76,-121.62],10` (centre pair, then zoom) and emits `<link rel="canonical">` for that exact URL,
  while `/l/nonsense` and a two-segment path both **404** ⇒ **latitude first**, exactly three segments.

**The two new orders are opposite each other.** Stated exactly: Flood Hub is **latitude-first, the same
order as Google Maps' `center=lat,lon`**, while **FIRMS is the only longitude-first provider** in the
builder. (An earlier draft of this addendum also asserted Flood Hub was opposite Google Maps; that half
was false and was corrected in review — an ADR that misstates a coordinate order is precisely what would
lead a later edit to "fix" a working URL into a broken one.) A transposed pair yields a *plausible-looking*
link to the wrong continent — silent, not loud — so the order is pinned by exact-string tests at both the
builder and the render site, including a Brașov case where both values are in-range for either slot and a
swap would look entirely credible.

**Consequences.** +2 links in the SitRep External-views section (11 total), +2 kind tokens ×14 locales,
no new dependency, no key, no network, no engine coupling. Risk accepted: both are undocumented URL
schemes and may drift — the same accepted risk already recorded for Zoom Earth, mitigated the same way
(exact-match tests fail loudly, and a broken deep link degrades to the provider's own landing page rather
than to a wrong-place map).
