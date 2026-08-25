// BEACON — persistence adapter public surface (E3). The only import point for the composition root
// (src/main) — repositories, client, region registry, seed. Schema/mappers stay internal to the ACL.
export type { Db } from './client';
export { getDb, makeDb } from './client';
export {
  makeRepository,
  toDomainError,
  tryResult,
} from './repository';
export type { RepositoryOps } from './repository';
export {
  makeAlertRepository,
  makeCitationRepository,
  makeExposureRepository,
  makeHazardGeometryRepository,
  makeIncidentRepository,
  makeRegionRepository,
  makeSourceRecordRepository,
  makeThresholdRuleRepository,
} from './repositories';
export type {
  ExposureRepository,
  HazardGeometryRepository,
  ThresholdRuleFilter,
} from './repositories';
export {
  loadRegionRegistry,
  parseRegionRegistry,
} from './region-registry';
export type { LoadedRegion, RegionRegistry } from './region-registry';
export {
  allShelters,
  loadShelterRegistry,
  parseShelterRegistry,
} from './shelter-registry';
export type { ShelterRegistry, ShelterRegionGroup } from './shelter-registry';
export { makePgSitRepHistoryStore } from './sitrep-history';
export type {
  PgSitRepHistoryOptions,
  PgSitRepHistoryStore,
  SitRepHistoryRecord,
} from './sitrep-history';
export { makePgEvacRouteStore } from './evac-route-store';
export type { PgEvacRouteStore } from './evac-route-store';
export { buildSeed, seed } from './seed';
export type { SeedData } from './seed';
