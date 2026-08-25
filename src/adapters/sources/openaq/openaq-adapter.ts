// BEACON — OpenAQ adapter (S2 Lane A4; adapter-contract §6, AirQualityPort P17, ADR-009, Art. XVI).
// OpenAQ v3 → canonical AirQualityReading behind the shared redundancy ladder (live → last-known-good
// cache → recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<AirQualityReading>
// (fetch/health) AND the outward domain AirQualityPort (fetchAirQuality → Sourced), so the application
// depends only on the port, never on OpenAQ internals.
//
// Config-driven: endpoint/mode/key/timeout from SOURCE_OPENAQ_* env (raw-env convention, no EnvSchema
// entry); the key is `OPENAQ_API_KEY` and IS required for LIVE (v3 401s without it — verified), so the
// factory fail-fasts rather than letting every fetch degrade silently.
//
// Two-stage bounded fan-out (see openaq-acl.ts "WHY TWO CALLS"): 1 × `/v3/locations?bbox=` then at most
// `maxLocations` × `/v3/locations/{id}/latest`, joined in the ACL.
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { AirQualityPort, AirQualityReading } from '@/ports/air-quality.js';
import type { AreaQuery } from '@/ports/data-sources.js';
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
import type { OpenAqRow } from './openaq-acl.js';
import { joinOpenAqLatest, locationIdsOf, openAqMapper, parseOpenAqLocations, OPENAQ_PM25_PARAMETER_ID } from './openaq-acl.js';

const OPENAQ_ID = 'openaq';
const OPENAQ_SOURCE = 'OpenAQ';
// OpenAQ aggregates other networks; each location carries its own upstream licence (`Location.licenses[]`,
// typically CC BY 4.0) with `attributionRequired`. The aggregate ask is kept visible (Art. XI).
const OPENAQ_LICENSE = 'OpenAQ aggregate — per-location open licences (attribution required)';
const DEFAULT_BASE_URL = 'https://api.openaq.org/v3';
const MOCK_LOCATIONS_FIXTURE = 'locations.json';
const MOCK_LATEST_FIXTURE = 'latest.json';
/** Bounded stage-2 fan-out: a continental bbox can hold thousands of stations on a FREE community API. */
const DEFAULT_MAX_LOCATIONS = 5;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface OpenAqAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  readonly maxLocations?: number;
  readonly parameterId?: number;
}

export class OpenAqAdapter implements SourceAdapterPort<AirQualityReading>, AirQualityPort {
  readonly id = OPENAQ_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // aggregator of national networks worldwide
  readonly mode: SourceMode;
  /** Sensors/values dropped by the LAST fetch's ACL parse+join (data-hygiene trace). */
  skippedLastParse = 0;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly maxLocations: number;
  private readonly parameterId: number;

  constructor(deps: OpenAqAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.maxLocations = deps.maxLocations ?? DEFAULT_MAX_LOCATIONS;
    this.parameterId = deps.parameterId ?? OPENAQ_PM25_PARAMETER_ID;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped AirQualityReadings. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<AirQualityReading>>> {
    return this.engine.run<OpenAqRow, AirQualityReading>({
      adapterId: this.id,
      source: OPENAQ_SOURCE,
      license: OPENAQ_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: openAqMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P17). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchAirQuality(query: AreaQuery): Promise<Result<Sourced<readonly AirQualityReading[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `OpenAQ unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly OpenAqRow[]> {
    const headers = this.headers();
    const opts = { timeoutMs: this.config.timeoutMs, headers };
    const index = parseOpenAqLocations(await httpGetText(this.locationsUrl(region), opts));
    const latestTexts: string[] = [];
    for (const id of locationIdsOf(index).slice(0, this.maxLocations)) {
      latestTexts.push(await httpGetText(this.latestUrl(id), opts));
    }
    return this.join(index, latestTexts);
  }

  private async loadMock(): Promise<readonly OpenAqRow[]> {
    const locations = await loadFixtureText(this.fixturesDir, MOCK_LOCATIONS_FIXTURE);
    if (!locations.ok) throw locations.error;
    const latest = await loadFixtureText(this.fixturesDir, MOCK_LATEST_FIXTURE);
    if (!latest.ok) throw latest.error;
    return this.join(parseOpenAqLocations(locations.value), [latest.value]);
  }

  private join(index: ReturnType<typeof parseOpenAqLocations>, latestTexts: readonly string[]): readonly OpenAqRow[] {
    const parsed = joinOpenAqLatest(index, latestTexts);
    this.skippedLastParse = parsed.skipped;
    return parsed.rows;
  }

  /** v3 auth header, verified live (a missing key returns HTTP 401 with an explicit message). */
  private headers(): Readonly<Record<string, string>> {
    const key = this.config.apiKey;
    return key === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'X-API-Key': key };
  }

  /** `bbox` is Min X, Min Y, Max X, Max Y (lon/lat) — the SAME order as BEACON's BBox. No transpose. */
  private locationsUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    return `${base}/locations?bbox=${west},${south},${east},${north}&parameters_id=${this.parameterId}&limit=${this.maxLocations}`;
  }

  private latestUrl(locationId: string): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    return `${base}/locations/${locationId}/latest`;
  }
}

/** Factory: resolve SOURCE_OPENAQ_* config + OPENAQ_API_KEY from env. Fail-fast on LIVE without a key. */
export function makeOpenAqAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<OpenAqAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'OPENAQ',
    env,
    defaultMode: 'MOCK',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'OPENAQ_API_KEY',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new OpenAqAdapter({ engine, config: cfg.value }) };
}
