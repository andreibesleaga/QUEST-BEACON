// BEACON — AirNow adapter (S2 Lane A4; adapter-contract §6, AirQualityPort P17, ADR-009, Art. XVI).
// US EPA AirNow "Hourly AQ Obs" → canonical AirQualityReading behind the shared redundancy ladder
// (live → last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<AirQualityReading> (fetch/health) AND the outward domain AirQualityPort
// (fetchAirQuality → Sourced), so the application depends only on the port, never on AirNow internals.
//
// Config-driven: endpoint/mode/timeout from SOURCE_AIRNOW_* env (raw-env convention, no EnvSchema entry).
// `AIRNOW_API_KEY` is read when present but is NOT required for LIVE: the Hourly AQ Obs FILE PRODUCT this
// adapter consumes is keyless (see airnow-acl.ts SOURCE VERIFICATION). That is deliberate — it means the
// LIVE rung works on a machine where the key was never issued, instead of silently failing closed.
//
// The published file is nationwide (~4.4k monitors); the query is a bbox. Spatial narrowing therefore
// happens HERE, at parse time, against the region's own bbox — never by trusting the caller to filter.
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
import type { AirNowRow } from './airnow-acl.js';
import { airNowMapper, parseAirNow } from './airnow-acl.js';

const AIRNOW_ID = 'airnow';
const AIRNOW_SOURCE = 'US EPA AirNow';
// AirNow data are US Government works, but EPA asks that AirNow be credited and that the preliminary
// status be stated — kept visible in provenance/NOTICE (Art. XI).
const AIRNOW_LICENSE = 'US EPA AirNow — public domain (US Gov); attribution requested; preliminary data';
const DEFAULT_BASE_URL = 'https://files.airnowtech.org/airnow';
const MOCK_FIXTURE = 'hourly-aq-obs.csv';
// The hour file lands ~:35 past the hour; two hours back is the newest hour that is reliably complete.
const DEFAULT_LAG_HOURS = 2;
// North America (US + the parts of CA/MX that report into AirNow). BBOX, not COUNTRIES: a region that
// carries no `iso` would otherwise be judged NOT_COVERED purely for lacking a field.
const AIRNOW_BBOX = [-172, 14, -50, 72] as const;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 3600; // one publication cycle

export interface AirNowAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  readonly lagHours?: number;
  readonly nowIso?: () => string; // injectable clock — the LIVE url is hour-addressed (deterministic tests)
}

export class AirNowAdapter implements SourceAdapterPort<AirQualityReading>, AirQualityPort {
  readonly id = AIRNOW_ID;
  readonly coverage: Coverage = { kind: 'BBOX', bbox: AIRNOW_BBOX };
  readonly mode: SourceMode;
  /** Site records dropped by the LAST fetch's ACL parse (out of bbox / no readable PM channel). */
  skippedLastParse = 0;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly lagHours: number;
  private readonly nowIso: () => string;

  constructor(deps: AirNowAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.lagHours = deps.lagHours ?? DEFAULT_LAG_HOURS;
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString());
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped AirQualityReadings. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<AirQualityReading>>> {
    return this.engine.run<AirNowRow, AirQualityReading>({
      adapterId: this.id,
      source: AIRNOW_SOURCE,
      license: AIRNOW_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: airNowMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(region),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P17). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchAirQuality(query: AreaQuery): Promise<Result<Sourced<readonly AirQualityReading[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `AirNow unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly AirNowRow[]> {
    const csv = await httpGetText(this.buildUrl(), { timeoutMs: this.config.timeoutMs });
    return this.parse(csv, region);
  }

  private async loadMock(region: Region): Promise<readonly AirNowRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return this.parse(res.value, region);
  }

  private parse(text: string, region: Region): readonly AirNowRow[] {
    const [west, south, east, north] = region.bbox;
    const parsed = parseAirNow(text, (lon, lat) => lon >= west && lon <= east && lat >= south && lat <= north);
    this.skippedLastParse = parsed.skipped;
    return parsed.rows;
  }

  /** `{base}/{YYYY}/{YYYYMMDD}/HourlyAQObs_{YYYYMMDDHH}.dat` — UTC-addressed, `lagHours` behind now. */
  private buildUrl(): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const at = new Date(Date.parse(this.nowIso()) - this.lagHours * 3600_000);
    const y = String(at.getUTCFullYear());
    const ymd = `${y}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
    return `${base}/${y}/${ymd}/HourlyAQObs_${ymd}${pad(at.getUTCHours())}.dat`;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Factory: resolve SOURCE_AIRNOW_* config from env. `AIRNOW_API_KEY` is carried when set but NOT required
 * for LIVE — the Hourly AQ Obs file product is keyless (airnow-acl.ts SOURCE VERIFICATION).
 */
export function makeAirNowAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<AirNowAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'AIRNOW',
    env,
    defaultMode: 'MOCK',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'AIRNOW_API_KEY',
    requireKeyForLive: false,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new AirNowAdapter({ engine, config: cfg.value }) };
}
