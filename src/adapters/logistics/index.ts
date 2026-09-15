// BEACON — Logistics adapter barrel (FR-8; EV9). Resources/shelters + tasking lifecycle, in two stores
// behind ONE port: the in-memory default (offline/air-gapped) and the durable Postgres twin selected by
// FEATURE_STORE=postgres. Both are held to the same behaviour by logistics-contract.test-suite.ts.
export {
  makeLogisticsAdapter,
  type LogisticsSeed,
  type LogisticsAdapter,
  type LogisticsOptions,
} from './memory-logistics.js';
export { makePgLogisticsStore, type PgLogisticsOptions } from './pg-logistics.js';
export {
  DEFAULT_CAPACITY_MATCH_DIRECTION,
  hasSpareCapacity,
  rankShelters,
  type CapacityMatchDirection,
} from './shelter-ranking.js';
