// BEACON — NWPS adapter (E4·T-155; adapter-contract §6, FloodGaugePort P2). NOAA NWPS
// (api.water.noaa.gov/nwps/v1) river gauges → canonical Gauge behind the shared redundancy ladder (live →
// cache → recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<Gauge> AND the
// outward FloodGaugePort, so the application depends only on the port, never on NWPS internals.
//
// DATA_SOURCE_VERIFICATION §2: verified tier LIVE (US public domain, no auth). Config-driven: endpoint/
// mode/timeout from SOURCE_NWPS_* env; nothing hardcoded.
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
import type { NwpsGauge } from './nwps-acl.js';
import { nwpsMapper, parseNwpsGauges } from './nwps-acl.js';

const NWPS_ID = 'nwps';
const NWPS_SOURCE = 'NOAA NWPS';
const NWPS_LICENSE = 'Public Domain (US Gov)';
const DEFAULT_BASE_URL = 'https://api.water.noaa.gov/nwps/v1';
const MOCK_FIXTURE = 'gauges.json';
const US_BBOX = [-180, 15, -60, 72] as const;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface NwpsAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class NwpsAdapter implements SourceAdapterPort<Gauge>, FloodGaugePort {
  readonly id = NWPS_ID;
  readonly coverage: Coverage = { kind: 'BBOX', bbox: US_BBOX };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: NwpsAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<Gauge>>> {
    return this.engine.run<NwpsGauge, Gauge>({
      adapterId: this.id,
      source: NWPS_SOURCE,
      license: NWPS_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: nwpsMapper,
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
        new DomainError('NOT_FOUND', `NWPS unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly NwpsGauge[]> {
    const json = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    return parseNwpsGauges(json);
  }

  private async loadMock(): Promise<readonly NwpsGauge[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseNwpsGauges(res.value);
  }

  /** NWPS gauges endpoint filtered by bbox: /{base}/gauges?bbox.xmin&ymin&xmax&ymax. */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    return `${base}/gauges?bbox.xmin=${west}&bbox.ymin=${south}&bbox.xmax=${east}&bbox.ymax=${north}`;
  }
}

/** Factory: resolve SOURCE_NWPS_* config from env. Fail-fast on bad config. */
export function makeNwpsAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<NwpsAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'NWPS',
    env,
    defaultMode: 'MOCK',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new NwpsAdapter({ engine, config: cfg.value }) };
}
