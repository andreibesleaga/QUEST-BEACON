// BEACON — src/domain public barrel (E1·T-084). The domain layer's single import surface.
// Pure TS only: this layer imports NO framework/HTTP/DB (F9, enforced by eslint + depcruise + the
// tests/architecture/f9-domain-purity fitness test). Re-exports every entity, value object, and primitive.

// Primitives & shared kernel
export * from './errors.js';
export * from './shared/result.js';
export * from './shared/guard.js';

// Value objects
export * from './value-objects/ids.js';
export * from './value-objects/geo.js';
export * from './value-objects/freshness.js';

// Entities — hazard & environment (cluster 1)
export * from './region.js';
export * from './incident.js';
export * from './hazard-geometry.js';
export * from './gauge.js';
export * from './flood-zone.js';
export * from './camera-feed.js';
export * from './infrastructure-node.js';
export * from './exposure.js';
export * from './prediction.js';

// Entities — intel, sources & alerting (cluster 2)
export * from './public-report.js';
export * from './source-record.js';
export * from './citation.js';
export * from './sitrep.js';
export * from './alert.js';
export * from './threshold-rule.js';

// Entities — logistics, identity & audit (cluster 3)
export * from './resource.js';
export * from './resource-task.js';
export * from './shelter.js';
export * from './evac-route.js';
export * from './app-user.js';
export * from './audit-event.js';
