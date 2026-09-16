// BEACON — redundancy acceptance harness (E9·T-437; Art. XVI / F5–F7). Drives the REAL RedundancyEngine
// (src/adapters/_shared) against a golden-dataset scenario, so the three acceptance tests exercise the
// production ladder (coverage → live+breaker → last-known-good cache → recorded-mock → typed unavailable)
// rather than a re-implementation. Non-test file (no *.test.ts). Hazards are the payload; an identity
// mapper keeps the ACL trivial so the test asserts the LADDER, not a specific source's parsing.
import { RedundancyEngine } from '@/adapters/_shared/index.js';
import type {
  AntiCorruptionMapper,
  BreakerConfig,
  Coverage,
  RedundancySpec,
  Region,
  SourceMode,
} from '@/adapters/_shared/index.js';
import type { HazardGeometry } from '@/domain/hazard-geometry.js';
import { FakeCache } from '../_harness/index.js';
import { fixedNowIso, makeSeqUuidGen } from '../_harness/clock.js';
import type { LoadedScenario } from '../_harness/index.js';

/** Identity ACL: the raw row already IS the canonical entity (keeps the test focused on the ladder). */
export function identityHazardMapper(): AntiCorruptionMapper<HazardGeometry, HazardGeometry> {
  return { toCanonical: (raw) => raw };
}

const FAST_BREAKER: BreakerConfig = {
  failureThreshold: 5,
  cooldownSec: 30,
  maxRetries: 0, // single attempt — keep the down-path test fast and deterministic
  timeoutMs: 1000,
};

export interface SpecOptions {
  readonly mode?: SourceMode;
  readonly coverage?: Coverage;
  readonly region?: Region;
  readonly fetchLive?: (region: Region) => Promise<readonly HazardGeometry[]>;
  readonly loadMockRaw?: () => Promise<readonly HazardGeometry[]>;
}

/** Build a hazard RedundancySpec from a scenario, overriding the rungs a given acceptance test needs. */
export function hazardSpec(
  scenario: LoadedScenario,
  options: SpecOptions = {},
): RedundancySpec<HazardGeometry, HazardGeometry> {
  const region: Region = options.region ?? { id: scenario.region.id, bbox: scenario.region.bbox };
  const spec: RedundancySpec<HazardGeometry, HazardGeometry> = {
    adapterId: 'firms-adapter',
    source: 'NASA FIRMS',
    license: 'NASA open data',
    mode: options.mode ?? scenario.mode,
    coverage: options.coverage ?? { kind: 'GLOBAL' },
    region,
    cacheTtlSec: 3600,
    breaker: FAST_BREAKER,
    mapper: identityHazardMapper(),
    loadMockRaw: options.loadMockRaw ?? (() => Promise.resolve(scenario.hazards)),
    ...(options.fetchLive ? { fetchLive: options.fetchLive } : {}),
  };
  return spec;
}

/** A RedundancyEngine wired to a fresh in-memory cache + deterministic clock/id (reproducible provenance). */
export function makeHarness(): { engine: RedundancyEngine; cache: FakeCache } {
  const cache = new FakeCache();
  const engine = new RedundancyEngine({ cache, nowIso: fixedNowIso, idGen: makeSeqUuidGen() });
  return { engine, cache };
}
