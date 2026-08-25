// BEACON — Shared adapter framework public surface (E4 Part A). The seams every Part-B source adapter
// plugs into: implement SourceAdapterPort<T>, provide an AntiCorruptionMapper + live fetch + mock loader,
// and delegate resilience/provenance to a RedundancyEngine. Nothing here leaks a raw upstream format.
export * from './contract.js';
export * from './errors.js';
export { mapRows } from './anti-corruption.js';
export { httpGetText, statusError } from './resilient-http.js';
export type { HttpOptions } from './resilient-http.js';
export { ManagedBreaker, mapState, classify } from './circuit-breaker.js';
export type { BreakerConfig } from './circuit-breaker.js';
export { isCovered } from './coverage.js';
export { cacheKey, readLastGood, writeLastGood } from './last-known-good-cache.js';
export { loadFixtureText, loadFixtureJson } from './recorded-mock.js';
export { stampProvenance, newestFreshness, buildFetchResult } from './provenance.js';
export type { ProvenanceInput } from './provenance.js';
export { resolveSourceConfig } from './source-config.js';
export type { Env, SourceConfig, SourceConfigInput } from './source-config.js';
export {
  validateManifest,
  findEntry,
  breakerFromEntry,
  cacheTtlFromEntry,
} from './manifest.js';
export type { Manifest, ManifestEntry } from './manifest.js';
export { RedundancyEngine } from './redundancy.js';
export type { RedundancySpec, RedundancyEngineDeps } from './redundancy.js';
