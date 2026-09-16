// BEACON — USGS Water adapter (E4·T-156; adapter-contract §6, FloodGaugePort P2). USGS Water Services
// gauge observations → canonical Gauge behind the shared redundancy ladder (live → cache → recorded-mock →
// unavailable). Implements BOTH the framework SourceAdapterPort<Gauge> AND the outward FloodGaugePort.
//
// DATA_SOURCE_VERIFICATION §2 + Key-Findings #1: verified tier LIVE (US public domain, no auth). The
// DEFAULT endpoint is now the new OGC API host `api.waterdata.usgs.gov`; the legacy `waterservices.usgs.gov`
// IV host is DECOMMISSIONING (Q1 2027, degradation ≥ Aug 2026) — do NOT default to it. Config-driven:
// endpoint/mode/timeout from SOURCE_USGS_WATER_* env (swap the host via SOURCE_USGS_WATER_URL).
//
// ⚠ MIGRATION STATE (documented-partial): the default HOST is migrated to OGC, but the live query-string
// construction (buildUrl) and the anti-corruption layer (usgs-water-acl.ts) still target the legacy IV
// JSON shape, because DATA_SOURCE_VERIFICATION does not record the OGC response field names — and the
// verified-schema mandate forbids guessing them. The recorded mock fixture is therefore the legacy IV
// shape too, so MOCK/CACHED demo paths are correct. Wiring the OGC query params + OGC response mapping is
// a follow-up that requires a verified OGC schema; until then the manifest ships this source as MOCK.
import { fileURLToPath } from 'node:url';
import type { Gauge, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { FloodGaugePort, AreaQuery } from '@/ports/data-sources.js';
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
import type { UsgsTimeSeries } from './usgs-water-acl.js';
import { usgsWaterMapper, parseUsgsTimeSeries } from './usgs-water-acl.js';

const USGS_ID = 'usgs-water';
const USGS_SOURCE = 'USGS Water Services';
const USGS_LICENSE = 'Public Domain (US Gov)';
// New OGC API host is the default (legacy waterservices.usgs.gov decommissions Q1 2027). Override with
// SOURCE_USGS_WATER_URL. NOTE: buildUrl below still appends legacy IV query params (documented-partial
// migration — see the file header); a full OGC live path needs the verified OGC query/response schema.
const DEFAULT_BASE_URL = 'https://api.waterdata.usgs.gov';
const DEFAULT_PARAM_CD = '00065'; // gauge height, feet
const MOCK_FIXTURE = 'instantaneous.json';
const US_BBOX = [-180, 15, -60, 72] as const;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface UsgsWaterAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly parameterCd?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class UsgsWaterAdapter implements SourceAdapterPort<Gauge>, FloodGaugePort {
  readonly id = USGS_ID;
  readonly coverage: Coverage = { kind: 'BBOX', bbox: US_BBOX };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly parameterCd: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: UsgsWaterAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.parameterCd = deps.parameterCd ?? DEFAULT_PARAM_CD;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<Gauge>>> {
    return this.engine.run<UsgsTimeSeries, Gauge>({
      adapterId: this.id,
      source: USGS_SOURCE,
      license: USGS_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: usgsWaterMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P2). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchGauges(query: AreaQuery): Promise<Result<Sourced<readonly Gauge[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `USGS unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly UsgsTimeSeries[]> {
    const json = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    return parseUsgsTimeSeries(json);
  }

  private async loadMock(): Promise<readonly UsgsTimeSeries[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseUsgsTimeSeries(res.value);
  }

  /**
   * Build the request URL. ⚠ Documented-partial OGC migration: the default base is the OGC host, but
   * these query params (`format=json&bBox=…&parameterCd=…`) are the LEGACY IV shape. A live OGC call
   * needs OGC-native params + response mapping (verified OGC schema pending). MOCK/CACHED are unaffected.
   */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    return `${base}?format=json&bBox=${west},${south},${east},${north}&parameterCd=${this.parameterCd}`;
  }
}

/** Factory: resolve SOURCE_USGS_WATER_* config from env. Fail-fast on bad config. */
export function makeUsgsWaterAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<UsgsWaterAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'USGS_WATER',
    env,
    defaultMode: 'MOCK',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new UsgsWaterAdapter({ engine, config: cfg.value }) };
}
