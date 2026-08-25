# ADR-002: Frontend — Next.js + MapLibre GL + deck.gl + Zustand + TanStack Query
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-002-frontend-stack.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** frontend | performance

---

## Context

BEACON's primary surface is a near-real-time geospatial COP: many toggleable, timestamped layers (fire +
perimeters, flood gauges/forecasts, weather/alerts, infrastructure, derived outages, cell coverage), an AI
intel panel, and a logistics board — responsive desktop/tablet/phone, WCAG 2.2 AA, working on throttled
connections and fully offline/air-gapped (no proprietary tile/map SDK calling home). Layers hold thousands
of points/polygons (FIRMS hotspots, exposure overlays, prediction cones) that must render and update
smoothly as SSE deltas arrive. The map and state/data libraries must be chosen now — they shape the UI
component contracts and the SSE/TanStack integration in S03/S05.

**Current state:** No frontend code yet; Phase-2 concept names a browser-first COP.
**Constraints:** free/open, no paid map SDK or mandatory token (Art. XI, ≈$0 NFR); offline/air-gapped (Art. XVI); WCAG 2.2 AA + responsive (PRD U6/§10); high-volume geospatial rendering; Next.js locked as app framework (CLARIFICATIONS §D).

## Options Considered

### Option A — Next.js (App Router) + MapLibre GL JS + deck.gl + Tailwind + Zustand + TanStack Query (CHOSEN)
MapLibre (BSD-3) renders vector basemaps/layers (no token); deck.gl (Apache-2.0) overlays high-volume WebGL
data layers (hotspots, exposure, cones); Zustand holds UI/layer state; TanStack Query caches server state +
merges the SSE delta channel; Tailwind for accessible responsive styling.
**Pros:** MapLibre is a fully open Mapbox GL fork — no token, no paid tier, self-hostable tiles (Art. XI + offline Art. XVI); deck.gl renders tens of thousands of geometries on GPU with live deltas without blocking UI (latency NFR, EV2 delta pushes); TanStack Query gives caching/stale-while-revalidate + a clean SSE-delta sink, Zustand keeps transient UI/layer toggles separate from server cache (AGENTS.md §4); Tailwind + headless components make WCAG AA contrast/keyboard/SR tractable; all Apache-2.0/BSD/MIT (Art. XI, NOTICE).
**Cons:** deck.gl↔MapLibre interop has a learning curve + WebGL context edge cases on low-end devices; two state libraries (boundary to learn).
**Source:** maplibre.org (BSD-3, no-token); deck.gl.org (Apache-2.0); tanstack.com/query; docs.pmnd.rs/zustand; CLARIFICATIONS §D (locked default).

### Option B — Leaflet (+ React-Leaflet) + Redux Toolkit
Mature DOM/canvas mapping with a huge plugin ecosystem.
**Pros:** very mature, simple API, open-source, no token, easy basic layers; large plugin/community ecosystem.
**Cons:** DOM/Canvas struggles with tens of thousands of points + frequent deltas — poor fit for live FIRMS/exposure + latency NFR; no first-class vector-tile/GPU pipeline (limited styling, 3D/extrusion); Redux Toolkit adds more boilerplate than Zustand for this UI.
**Source:** leafletjs.com; perf comparisons vs WebGL renderers (deck.gl/MapLibre docs).

### Option C — CesiumJS (3D globe)
Full 3D geospatial globe engine.
**Pros:** powerful 3D terrain/globe visualization, impressive for some demos.
**Cons:** heavyweight, steep learning curve, large bundle — overkill for a 2D-first COP and bad on tablet/phone; 3D not a BEACON requirement (cost/complexity unjustified); high-quality assets/tiles gravitate to paid Cesium ion (against Art. XI/cost NFR).
**Source:** cesium.com/cesiumjs.

### Option D — Mapbox GL JS (proprietary)
Commercial upstream of MapLibre.
**Pros:** polished, feature-rich, excellent docs and styles.
**Cons:** requires an access token, billed per map load beyond a free quota — violates ≈$0 NFR + no-egress/air-gapped (Art. XVI), not free-world-open (Art. XI); vendor lock-in; license changed to non-OSS from v2.
**Source:** mapbox.com/pricing; Mapbox GL JS license (BSL/commercial).

## Decision

**We will use Option A — Next.js + MapLibre GL JS + deck.gl + Tailwind + Zustand + TanStack Query.**
Rationale: (1) MapLibre + self-hosted/open tiles is the only mapping choice that is free, tokenless, and
air-gapped-capable (Art. XI, Art. XVI offline); (2) deck.gl's GPU pipeline meets high-volume live-delta
rendering (FIRMS, exposure, cones) without blocking UI (latency NFR, EV2); (3) Zustand (UI/layer state) +
TanStack Query (server cache + SSE-delta merge) is the exact division mandated by AGENTS.md §4. This is the
locked default in CLARIFICATIONS §D; this ADR records the rationale and alternatives weighed.

## Consequences

- **+** Zero map-vendor cost/token; works offline/air-gapped with bundled/cached tiles.
- **+** Smooth rendering of large, frequently-updated geospatial layers.
- **+** Clean state architecture; TanStack Query is a natural SSE delta sink.
- **−** Team must learn MapLibre↔deck.gl interop and manage WebGL perf on low-end devices.
- **−** Bundling/serving open vector tiles for offline mode is an extra build/ops concern.
- **~** Two complementary state libraries with an explicit boundary (UI vs server cache).
- **~** Tailwind utility-first styling adopted project-wide.
- **risk:** low-end device WebGL limits → mitigate with layer-density caps, point aggregation, polling/reduced-layer fallback (ties to ADR-006).
- **risk:** offline tile size → mitigate by shipping only the flagship-region tile extent in the air-gapped image.

## Y-Statement
> For emergency managers/responders needing a fast, responsive, offline-capable geospatial COP with many
> live layers, Next.js + MapLibre GL + deck.gl + Zustand + TanStack Query renders high-volume,
> frequently-updated geodata on the GPU with no map-vendor token or cost; unlike Leaflet (DOM-bound),
> Cesium (heavyweight 3D), or Mapbox (paid/token-gated), it stays free, air-gapped-capable, and performant
> under live delta updates.

## Links
- **PRD:** §4.1 (COP/layers), U6 (WCAG/responsive), §10 (latency, offline, browser support).
- **Constitution:** Art. XI (free-world data/no paid SDK), XVI (offline/air-gapped), VI (accessibility/transparency).
- **Related ADRs:** ADR-001 (hexagonal — UI delegates to use-cases), ADR-006 (SSE delta channel feeding TanStack Query), ADR-009 (offline-first).
- **Official docs:** maplibre.org; deck.gl.org; tanstack.com/query; docs.pmnd.rs/zustand; tailwindcss.com.
- **Implementation:** S05 (`app/` — pending S04 gate).

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S05 UI spike (confirm deck.gl performance on target tablet hardware).
