// BEACON — Routing adapter barrel (FR-7; ADR-016). The in-memory heuristic rung of the routing ladder,
// plus the optional ORS road-routing rung (W4a).
export { makeRoutingAdapter, type RoutingAdapterDeps } from './memory-routing.js';
export { makeOrsRoutingAdapter, type OrsRoutingAdapterDeps } from './ors-routing.js';
