# ADR-016: Hazard-avoidance routing ladder (RoutingPort)

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human
**Tags:** routing, redundancy, infrastructure

---

## Context

FR-7 / EV7 require evacuation routes that **avoid the hazard polygon** plus nearest shelters. Routing
must degrade gracefully (Constitution Art. XVI) and stay free/offline-capable. OpenRouteService (free
key, rate-limited) was the Phase-2 choice; this ADR records the full fallback ladder.

**Constraints:** free; works offline/air-gapped; never a dead-end (Art. XVI); hazard-polygon avoidance.

## Options Considered

### Option A — `RoutingPort` ladder: ORS → self-hosted Valhalla/OSRM → straight-line+avoid heuristic (CHOSEN)
Hosted OpenRouteService by default (avoid-polygon supported); self-host **Valhalla/OSRM** for
no-rate-limit/offline; final fallback = great-circle path nudged around the hazard polygon (Turf).
**Pros:** free; offline-capable (self-host/heuristic); honors Art. XVI; flag-driven (`FEATURE_ROUTING`).
**Cons:** heuristic fallback is approximate (clearly labeled).
**Source:** ORS docs; Valhalla/OSRM OSS; CONFIGURATION `FEATURE_ROUTING`.

### Option B — Hosted ORS only
**Pros:** simplest. **Cons:** rate-limited, online-only — fails the offline/air-gapped acceptance test (Art. XVI). Rejected as sole option.

### Option C — Commercial routing (Google/Mapbox Directions)
**Pros:** robust. **Cons:** paid + ToS + online — violates free-world-data + offline (Art. XI/XVI). Rejected.

## Decision

**We will use Option A** — a `RoutingPort` with the ORS → Valhalla/OSRM → heuristic ladder, selected by
`FEATURE_ROUTING`. Routes always carry `avoids_hazard` and a freshness/quality label; the heuristic
fallback is marked "approximate".

## Consequences

**Positive:** routing works online, self-hosted, and fully offline; zero cost; consistent `EVAC_ROUTE` output.
**Negative:** maintaining a self-host option adds ops surface (documented, optional).
**Neutral:** shelter selection (nearest open SHELTER) is a deterministic post-step.
**Risks:** stale road network in self-host/offline → mitigated by freshness labeling + periodic OSM refresh.

## Y-Statement
> For responders needing safe evacuation routes anywhere, a tiered RoutingPort (ORS → self-host →
> heuristic) is a routing approach that never dead-ends and runs offline; unlike a single hosted/
> commercial router, it is free, air-gapped-capable, and degrades transparently.

## Links
- PRD FR-7 / EARS EV7; CONFIGURATION `FEATURE_ROUTING`; Constitution Art. XI, XVI; ADR-009 (redundancy).
- `../C4_ARCHITECTURE.md` redundancy ladders; `../DOMAIN_MODEL.md` (EVAC_ROUTE).

## Review
**Approved by:** human, 2026-06-27 · **Revisit:** S03 (confirm ORS avoid-polygon params; Valhalla image).
