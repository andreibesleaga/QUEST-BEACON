// BEACON test harness — public barrel (TEST_PLAN §4). One import surface for every cross-feature test:
// deterministic clock/id, typed entity builders (valid + invalid variants), in-memory fake ports, and
// the golden-dataset scenario loader. Non-test file (no *.test.ts) so vitest never runs it as a suite.
export * from './clock.js';

// Builders
export * from './builders/ids.js';
export * from './builders/hazard-env.js';
export * from './builders/intel-sources.js';
export * from './builders/logistics-identity.js';

// Fake ports
export { FakeCache, type FakeCacheOptions } from './fakes/fake-cache.js';
export { FakeRepository } from './fakes/fake-repository.js';
export { FakeSpatial } from './fakes/fake-spatial.js';
export { FakeEventBus, FakeQueue } from './fakes/fake-messaging.js';
export { FakeLLM, FakeVision, FakeCompliance } from './fakes/fake-intel.js';
export { FakeGovernanceLedger, FakeRetentionStore } from './fakes/fake-governance.js';
export type {
  FakeLLMOptions,
  FakeVisionOptions,
  FakeComplianceOptions,
} from './fakes/fake-intel.js';
export {
  FakeHazardSource,
  FakeFloodGauge,
  FakeInfrastructure,
  FakeWeatherSource,
} from './fakes/fake-sources.js';
export { FakeRouting, FakeAlertSink } from './fakes/fake-logistics.js';

// Fixtures / golden datasets
export * from './fixtures/load-scenario.js';
