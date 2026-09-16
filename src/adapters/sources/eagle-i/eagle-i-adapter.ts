// BEACON — EAGLE-I adapter (E4·T-166; adapter-contract §6, OutagePort P5). DOE/ORNL EAGLE-I county-level
// power-outage records → canonical OutageRecord behind the shared redundancy ladder (cached-default →
// last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<OutageRecord> (fetch/health) AND the outward domain OutagePort (fetchOutages →
// Sourced), so the application depends only on the port, never on EAGLE-I internals.
//
// Config-driven: mode/url/timeout come from SOURCE_EAGLE_I_* env (adapter-contract §5, 12-factor).
//
// HONEST LIMITATION — live gating (DATA_SOURCE_VERIFICATION.md §4 EAGLE-I row): the true near-real-time
// EAGLE-I feed is GOV-OPERATIONAL — DOE/ORNL do not publish a public near-real-time endpoint. The public,
// no-login path is the HISTORICAL dataset (15-min cadence, ~mid-2022-era end-of-window in the open
// release). Because that public path is a bulk-download dataset, not a live bbox-queryable API, this
// adapter's default mode is CACHED (serving the recorded historical fixture — see __fixtures__/outages.json
// for full provenance). LIVE mode is config-gated: it refuses to start unless the operator overrides
// SOURCE_EAGLE_I_URL away from the (non-functional-as-a-live-API) default — i.e. "when the client [a
// government/utility partner] has [operational] access" and supplies their own endpoint. This is honest
// about what BEACON can offer out of the box vs. what a real deployment with EAGLE-I access could wire in.
//
// HONEST LIMITATION — coverage: EAGLE-I is US-only and COUNTY-granular (see eagle-i-acl.ts header). This
// adapter always stamps `iso: 'US'` on the Region it builds for the outward port (AreaQuery carries no ISO
// field) because EAGLE-I's coverage is unconditionally national — never derived from the caller's bbox.
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { OutagePort, OutageRecord } from '@/ports/infrastructure-sources.js';
import type { AreaQuery } from '@/ports/data-sources.js';
import type {
  AdapterResult,
  BreakerConfig,
  Coverage,
  FetchResult,
  Region,
  RedundancyEngine,
  SourceAdapterPort,
  SourceConfig,
  SourceMode,
  AdapterHealth,
} from '@/adapters/_shared/index.js';
import {
  err,
  httpGetText,
  loadFixtureText,
  makeAdapterError,
  resolveSourceConfig,
} from '@/adapters/_shared/index.js';
import type { EagleIRawRecord } from './eagle-i-acl.js';
import { eagleIMapper, parseEagleIRecords } from './eagle-i-acl.js';

const EAGLE_I_ID = 'eagle-i';
const EAGLE_I_SOURCE = 'DOE/ORNL EAGLE-I';
const EAGLE_I_LICENSE = 'US public domain (DOE/ORNL EAGLE-I)';
// Public, no-login browse portal for the historical dataset (documentation default — see module header;
// LIVE mode refuses to run against this default, it exists only to give CACHED/MOCK a sensible URL to show).
const DEFAULT_BASE_URL = 'https://openenergyhub.ornl.gov/explore/dataset/eaglei_outages_2014/';
const MOCK_FIXTURE = 'outages.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;
const US_ISO = 'US';

export interface EagleIAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class EagleIAdapter implements SourceAdapterPort<OutageRecord>, OutagePort {
  readonly id = EAGLE_I_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: [US_ISO] }; // EAGLE-I is US-only (county-granular)
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: EagleIAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped OutageRecord. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<OutageRecord>>> {
    return this.engine.run<EagleIRawRecord, OutageRecord>({
      adapterId: this.id,
      source: EAGLE_I_SOURCE,
      license: EAGLE_I_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: eagleIMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P5). EAGLE-I coverage is unconditionally national — see module header. */
  async fetchOutages(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly OutageRecord[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox, iso: US_ISO };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `EAGLE-I unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly EagleIRawRecord[]> {
    // Best-effort bbox filter convention; the real contract is whatever operational endpoint the client
    // supplies via SOURCE_EAGLE_I_URL (not re-verified live in this environment — audit §4 EAGLE-I row).
    const text = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    return parseEagleIRecords(text).rows;
  }

  private async loadMock(): Promise<readonly EagleIRawRecord[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseEagleIRecords(res.value).rows;
  }

  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    return `${base}?bbox=${west},${south},${east},${north}`;
  }
}

/**
 * Factory: resolve SOURCE_EAGLE_I_* config from env and construct the adapter. Fail-fast on bad config.
 * defaultMode is CACHED (serves the recorded historical fixture). LIVE mode additionally requires the
 * operator to override SOURCE_EAGLE_I_URL away from the documentation default — the public historical
 * dataset is not itself a live bbox-queryable API; a real LIVE feed needs a gov/utility-client-supplied
 * operational endpoint (module header, DATA_SOURCE_VERIFICATION.md §4 EAGLE-I row).
 */
export function makeEagleIAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<EagleIAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'EAGLE_I',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  if (cfg.value.mode === 'LIVE' && cfg.value.url === DEFAULT_BASE_URL) {
    return err(
      makeAdapterError(
        'CONFIG',
        'EAGLE_I: LIVE mode requires SOURCE_EAGLE_I_URL set to a gov/utility-client-supplied operational ' +
          'endpoint (the public dataset URL is a historical/bulk browse portal, not a live feed)',
        { retryable: false },
      ),
    );
  }
  return { ok: true, value: new EagleIAdapter({ engine, config: cfg.value }) };
}
