// BEACON — Sensor.Community adapter (S2 Lane A4; adapter-contract §6, AirQualityPort P17, ADR-009,
// Art. XVI). Citizen low-cost PM network → canonical AirQualityReading behind the shared redundancy ladder
// (live → last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<AirQualityReading> (fetch/health) AND the outward domain AirQualityPort
// (fetchAirQuality → Sourced), so the application depends only on the port, never on Sensor.Community.
//
// KEYLESS: this network requires no API key — the LIVE rung works out of the box (no `requireKeyForLive`).
// It does require a contact User-Agent (see the ACL header), sent on every request.
//
// Endpoint/mode/timeout come from SOURCE_SENSORCOMMUNITY_* env (raw-env convention, no EnvSchema entry).
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
import type { SensorCommunityRow } from './sensorcommunity-acl.js';
import { parseSensorCommunity, sensorCommunityMapper } from './sensorcommunity-acl.js';

const SC_ID = 'sensorcommunity';
const SC_SOURCE = 'Sensor.Community';
// ODbL 1.0 §4.3 makes the attribution notice a LICENCE OBLIGATION. It therefore travels ON the data, in
// SourceRecord.license, so a record can never be rendered/exported without it (Art. XI), and is mirrored
// verbatim in NOTICE.
const SC_LICENSE = 'ODbL 1.0 (database) / DbCL 1.0 (contents) — "Data: Sensor.Community contributors"';
const DEFAULT_BASE_URL = 'https://data.sensor.community/airrohr/v1/filter';
// Mandatory per the project's own API docs (2022-11-04): requests must identify a contactable client.
const USER_AGENT = 'BEACON/1.0 (+https://github.com/IEEE-Response-Quest; emergency COP)';
const MOCK_FIXTURE = 'box.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// The filter endpoint serves the last FIVE MINUTES only, so a long TTL would serve stale air as "cached".
const DEFAULT_CACHE_TTL_SEC = 300;

export interface SensorCommunityAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  readonly userAgent?: string;
}

export class SensorCommunityAdapter implements SourceAdapterPort<AirQualityReading>, AirQualityPort {
  readonly id = SC_ID;
  // GLOBAL by construction (anyone anywhere may run a station), but density is overwhelmingly European —
  // an honest coverage claim is "we will answer for any bbox", with the emptiness of a sparse bbox visible
  // as an empty (not fabricated) result rather than a NOT_COVERED lie.
  readonly coverage: Coverage = { kind: 'GLOBAL' };
  readonly mode: SourceMode;
  /** Malformed/non-PM upstream channels dropped by the LAST fetch's ACL parse (data-hygiene trace). */
  skippedLastParse = 0;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly userAgent: string;

  constructor(deps: SensorCommunityAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.userAgent = deps.userAgent ?? USER_AGENT;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped AirQualityReadings. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<AirQualityReading>>> {
    return this.engine.run<SensorCommunityRow, AirQualityReading>({
      adapterId: this.id,
      source: SC_SOURCE,
      license: SC_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: sensorCommunityMapper,
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
      return domainErr(
        new DomainError('NOT_FOUND', `Sensor.Community unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly SensorCommunityRow[]> {
    const text = await httpGetText(this.buildUrl(region), {
      timeoutMs: this.config.timeoutMs,
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    });
    return this.parse(text);
  }

  private async loadMock(): Promise<readonly SensorCommunityRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return this.parse(res.value);
  }

  private parse(text: string): readonly SensorCommunityRow[] {
    const parsed = parseSensorCommunity(text);
    this.skippedLastParse = parsed.skipped;
    return parsed.rows;
  }

  /**
   * `/filter/box={lat1,lon1,lat2,lon2}` — LAT FIRST, the transpose of BEACON's BBox
   * `[west,south,east,north]`. The order is the one documented by the project's own API wiki.
   */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    return `${base}/box=${south},${west},${north},${east}`;
  }
}

/** Factory: resolve SOURCE_SENSORCOMMUNITY_* config from env. Keyless — LIVE needs no key. */
export function makeSensorCommunityAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<SensorCommunityAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'SENSORCOMMUNITY',
    env,
    defaultMode: 'MOCK',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new SensorCommunityAdapter({ engine, config: cfg.value }) };
}
