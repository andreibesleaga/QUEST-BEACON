// BEACON — NWS adapter (E4·T-153; adapter-contract §6, WeatherSourcePort P3). NOAA NWS api.weather.gov
// station observations → canonical WeatherObservation behind the shared redundancy ladder (live → cache →
// recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<WeatherObservation> AND
// the outward WeatherSourcePort, so the application depends only on the port, never on NWS internals.
//
// DATA_SOURCE_VERIFICATION §3: verified tier LIVE (US public domain; User-Agent required). Config-driven:
// endpoint/mode/timeout from SOURCE_NWS_* env; the mandatory contact User-Agent from NWS_USER_AGENT.
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { WeatherSourcePort, AreaQuery, WeatherObservation } from '@/ports/data-sources.js';
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
import type { NwsFeature } from './nws-acl.js';
import { nwsMapper, parseNwsObservations } from './nws-acl.js';

const NWS_ID = 'nws';
const NWS_SOURCE = 'NOAA NWS';
const NWS_LICENSE = 'Public Domain (US Gov)';
const DEFAULT_BASE_URL = 'https://api.weather.gov';
const DEFAULT_STATION = 'KSAC'; // Sacramento Executive — CA flagship default; override via SOURCE_NWS_STATION
const DEFAULT_USER_AGENT = '(BEACON emergency COP, contact@beacon.example)';
const MOCK_FIXTURE = 'observations.json';
// US public-domain coverage (CONUS + AK/HI/territories); a non-US region → NOT_COVERED (OP4).
const US_BBOX = [-180, 15, -60, 72] as const;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface NwsAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly station?: string;
  readonly userAgent?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class NwsAdapter implements SourceAdapterPort<WeatherObservation>, WeatherSourcePort {
  readonly id = NWS_ID;
  readonly coverage: Coverage = { kind: 'BBOX', bbox: US_BBOX };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly station: string;
  private readonly userAgent: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: NwsAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.station = deps.station ?? DEFAULT_STATION;
    this.userAgent = deps.userAgent ?? DEFAULT_USER_AGENT;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<WeatherObservation>>> {
    return this.engine.run<NwsFeature, WeatherObservation>({
      adapterId: this.id,
      source: NWS_SOURCE,
      license: NWS_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: nwsMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P3). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchWeather(query: AreaQuery): Promise<Result<Sourced<readonly WeatherObservation[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `NWS unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(): Promise<readonly NwsFeature[]> {
    const headers = { 'User-Agent': this.userAgent, Accept: 'application/geo+json' };
    const json = await httpGetText(this.buildUrl(), { timeoutMs: this.config.timeoutMs, headers });
    return parseNwsObservations(json);
  }

  private async loadMock(): Promise<readonly NwsFeature[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseNwsObservations(res.value);
  }

  /** NWS latest-observation endpoint: /{base}/stations/{station}/observations/latest. */
  private buildUrl(): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    return `${base}/stations/${this.station}/observations/latest`;
  }
}

/** Factory: resolve SOURCE_NWS_* config + NWS_USER_AGENT from env. Fail-fast on bad config. */
export function makeNwsAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<NwsAdapter> {
  const cfg = resolveSourceConfig({ prefix: 'NWS', env, defaultMode: 'MOCK', defaultUrl: DEFAULT_BASE_URL });
  if (!cfg.ok) return cfg;
  const station = env.SOURCE_NWS_STATION;
  const userAgent = env.NWS_USER_AGENT;
  return {
    ok: true,
    value: new NwsAdapter({
      engine,
      config: cfg.value,
      ...(station !== undefined ? { station } : {}),
      ...(userAgent !== undefined ? { userAgent } : {}),
    }),
  };
}
