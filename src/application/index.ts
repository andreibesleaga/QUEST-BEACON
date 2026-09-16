// BEACON — src/application public barrel (E5). Use-cases import PORTS + DOMAIN only; the layer boundary
// (no adapters/framework) is enforced by eslint + depcruise (F9/ADR-001). This is the API/composition
// root's single import surface for the deterministic engine + AI orchestration.
export * from './risk-intersection/risk-intersection.js';
export * from './priority-ranking/priority-ranking.js';
export * from './threshold-evaluation/threshold-evaluation.js';
export * from './prediction-projection/prediction-projection.js';
export * from './escalation-trend/escalation-trend.js';
export * from './evac-routing/evac-routing.js';
export * from './sitrep-synthesis/sitrep-synthesis.js';
export * from './interaction/command-router.js';
export * from './shared/config.js';
export * from './shared/geo.js';
