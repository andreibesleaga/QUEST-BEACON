// BEACON — OpenCelliD adapter (E4·T-13x; adapter-contract §6, TelecomPort P13). OpenCelliD area cell-tower
// DB → canonical TelecomCoverage behind the shared redundancy ladder (live → last-known-good cache →
// recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<TelecomCoverage> (fetch/
// health) AND the outward domain TelecomPort (fetchCoverage → Sourced), so the application depends only on
// the port, never on OpenCelliD internals.
//
// DATA_SOURCE_VERIFICATION §4 OpenCelliD row: free key, CC BY-SA, crowdsourced gaps, verdict **CACHED**
// (not LIVE) — a keyed, periodically-refreshed crowdsourced tower census, not a real-time feed; the
// default mode reflects that honestly (see opencellid-acl.ts for the fuller honest-limitations note).
// Config-driven: endpoint/mode/key/timeout come from SOURCE_OPENCELLID_* env (key is OPENCELLID_API_KEY).
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { AreaQuery } from '@/ports/data-sources.js';
import type { TelecomCoverage, TelecomPort } from '@/ports/infrastructure-sources.js';
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
import type { OpenCelliDCell } from './opencellid-acl.js';
import { openCelliDMapper, parseOpenCelliDCells } from './opencellid-acl.js';

const OPENCELLID_ID = 'opencellid';
const OPENCELLID_SOURCE = 'OpenCelliD';
const OPENCELLID_LICENSE = 'CC BY-SA (OpenCelliD)';
const DEFAULT_BASE_URL = 'https://opencellid.org/cell/getInArea';
const DEFAULT_LIMIT = 20;
const MOCK_FIXTURE = 'cells.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface OpenCelliDAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly limit?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class OpenCelliDAdapter implements SourceAdapterPort<TelecomCoverage>, TelecomPort {
  readonly id = OPENCELLID_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // crowdsourced, worldwide contributor base (gaps honest-limitation)
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly limit: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: OpenCelliDAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.limit = deps.limit ?? DEFAULT_LIMIT;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped TelecomCoverage. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<TelecomCoverage>>> {
    return this.engine.run<OpenCelliDCell, TelecomCoverage>({
      adapterId: this.id,
      source: OPENCELLID_SOURCE,
      license: OPENCELLID_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: openCelliDMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P13). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchCoverage(query: AreaQuery): Promise<Result<Sourced<readonly TelecomCoverage[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `OpenCelliD unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly OpenCelliDCell[]> {
    const json = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    return parseOpenCelliDCells(json).rows;
  }

  private async loadMock(): Promise<readonly OpenCelliDCell[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseOpenCelliDCells(res.value).rows;
  }

  /**
   * OpenCelliD `cell/getInArea`: BBOX is `latmin,lonmin,latmax,lonmax` — the REVERSE axis order from the
   * BEACON internal `Region.bbox` (`[minLon,minLat,maxLon,maxLat]`, WGS-84). Converted here, at the edge,
   * so no other layer needs to know OpenCelliD's axis convention.
   */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const key = this.config.apiKey ?? '';
    const [west, south, east, north] = region.bbox;
    return `${base}?key=${encodeURIComponent(key)}&BBOX=${south},${west},${north},${east}&format=json&limit=${this.limit}`;
  }
}

/** Factory: resolve SOURCE_OPENCELLID_* config from env and construct the adapter. Fail-fast on bad config. */
export function makeOpenCelliDAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<OpenCelliDAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'OPENCELLID',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'OPENCELLID_API_KEY',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new OpenCelliDAdapter({ engine, config: cfg.value }) };
}
