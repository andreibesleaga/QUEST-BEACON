// BEACON — US Census / ACS adapter (E4·T-1xx; adapter-contract §6, PopulationPort P12). US Census
// Bureau ACS 5-year total-population-by-county → canonical PopulationEstimate behind the shared
// redundancy ladder (live → last-known-good cache → recorded-mock → unavailable). Implements BOTH the
// framework SourceAdapterPort<PopulationEstimate> (fetch/health) AND the outward domain PopulationPort
// (estimatePopulation → Sourced), so the application depends only on the port, never on Census internals.
//
// DATA_SOURCE_VERIFICATION §7 (~line 87): free key, US public domain, county demographics, survey lag,
// verdict CACHED. Config-driven: endpoint/mode/timeout from SOURCE_CENSUS_* env; key is CENSUS_API_KEY
// (LIVE requires it — Census now refuses keyless requests, see census-adapter.test.ts / fixture note).
//
// Scope/honest-limitation: the upstream query is fixed to CA counties (`in=state:06`) — a golden-path
// demo scope, same pattern as the meteoalarm-ro adapter's fixed Romania region. `estimatePopulation`
// fetches the full known-county set once (cached under one stable region id) and then sums the counties
// whose builtin centroid falls inside the caller's query bbox (see census-acl.ts for the point-in-bbox
// method and its documented approximations).
import { fileURLToPath } from 'node:url';
import type { BBox, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { PopulationPort, PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type {
  AdapterHealth,
  AdapterResult,
  BreakerConfig,
  Coverage,
  FetchResult,
  RedundancyEngine,
  Region,
  SourceAdapterPort,
  SourceConfig,
  SourceMode,
} from '@/adapters/_shared/index.js';
import { httpGetText, loadFixtureText, resolveSourceConfig } from '@/adapters/_shared/index.js';
import type { CensusRow } from './census-acl.js';
import { censusMapper, parseCensusAcsRows, bboxCenter, pointInBBox } from './census-acl.js';

const CENSUS_ID = 'census';
const CENSUS_SOURCE = 'US Census Bureau (ACS 5-year)';
const CENSUS_LICENSE = 'US public domain';
const DEFAULT_BASE_URL = 'https://api.census.gov/data/2022/acs/acs5';
const DEFAULT_STATE_FIPS = '06'; // California — golden-path demo scope
const MOCK_FIXTURE = 'acs.json';

// The fixed internal query region: "all known CA counties" — independent of the caller's bbox. A stable
// id keeps the last-known-good cache single-keyed regardless of which bbox estimatePopulation is asked
// about (the query-bbox scoping/summing happens AFTER this fetch, in estimatePopulation below).
const CA_COUNTIES_REGION: Region = {
  id: 'ca-counties',
  bbox: [-124.5, 32.5, -114.0, 42.1],
  iso: 'US',
};

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface CensusAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly stateFips?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class CensusAdapter implements SourceAdapterPort<PopulationEstimate>, PopulationPort {
  readonly id = CENSUS_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: ['US'] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly stateFips: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: CensusAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.stateFips = deps.stateFips ?? DEFAULT_STATE_FIPS;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped per-county estimates. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<PopulationEstimate>>> {
    return this.engine.run<CensusRow, PopulationEstimate>({
      adapterId: this.id,
      source: CENSUS_SOURCE,
      license: CENSUS_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: censusMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /**
   * Outward domain port (P12). Fetches the full known-county set, then sums the counties whose builtin
   * centroid lies inside `area` (point-in-bbox — see census-acl.ts). No matching county ⇒ count 0 (never
   * an error — a query bbox legitimately outside our tiny demo county set is a valid, if uninteresting,
   * answer).
   */
  async estimatePopulation(area: BBox): Promise<Result<Sourced<PopulationEstimate>, DomainError>> {
    const res = await this.fetch(CA_COUNTIES_REGION);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `Census unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const count = res.value.records
      .filter((r) => pointInBBox(bboxCenter(r.entity.area), area))
      .reduce((sum, r) => sum + r.entity.count, 0);
    const data: PopulationEstimate = { area, count };
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  // Note: the live query is fixed to `this.stateFips` — Census ACS5 has no bbox query parameter, so the
  // `region` the shared RedundancySpec.fetchLive contract passes in is not needed here.
  private async fetchLive(): Promise<readonly CensusRow[]> {
    const json = await httpGetText(this.buildUrl(), { timeoutMs: this.config.timeoutMs });
    return parseCensusAcsRows(json);
  }

  private async loadMock(): Promise<readonly CensusRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseCensusAcsRows(res.value);
  }

  /** Census ACS5 endpoint: /{base}?get=B01003_001E,NAME&for=county:*&in=state:{fips}[&key={KEY}]. */
  private buildUrl(): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const key = this.config.apiKey;
    const params = `get=B01003_001E,NAME&for=county:*&in=state:${this.stateFips}`;
    return key ? `${base}?${params}&key=${key}` : `${base}?${params}`;
  }
}

/** Factory: resolve SOURCE_CENSUS_* config from env and construct the adapter. Fail-fast on bad config. */
export function makeCensusAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<CensusAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'CENSUS',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'CENSUS_API_KEY',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new CensusAdapter({ engine, config: cfg.value }) };
}
