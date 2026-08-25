// BEACON — Open-Meteo adapter (E4·T-157; adapter-contract §6, WeatherSourcePort P3). Global model weather
// (api.open-meteo.com) → canonical WeatherObservation behind the shared redundancy ladder (live → cache →
// recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<WeatherObservation> AND the
// outward WeatherSourcePort, so the application depends only on the port, never on Open-Meteo internals.
//
// DATA_SOURCE_VERIFICATION §2: verified tier LIVE, keyless, CC BY 4.0, GLOBAL coverage — the non-US weather
// rung (RO/worldwide) beside NWS (US). Config-driven: endpoint/mode/timeout from SOURCE_OPEN_METEO_* env.
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
import type { OpenMeteoResponse } from './open-meteo-acl.js';
import { openMeteoMapper, parseOpenMeteo } from './open-meteo-acl.js';

const OM_ID = 'open-meteo';
const OM_SOURCE = 'Open-Meteo';
const OM_LICENSE = 'CC BY 4.0';
const DEFAULT_BASE_URL = 'https://api.open-meteo.com';
const MOCK_FIXTURE = 'current.json';
const CURRENT_VARS = 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface OpenMeteoAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class OpenMeteoAdapter implements SourceAdapterPort<WeatherObservation>, WeatherSourcePort {
  readonly id = OM_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // model weather ⇒ every region (RO/worldwide)
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: OpenMeteoAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<WeatherObservation>>> {
    return this.engine.run<OpenMeteoResponse, WeatherObservation>({
      adapterId: this.id,
      source: OM_SOURCE,
      license: OM_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: openMeteoMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P3): adapt a FetchResult to the Sourced envelope the application consumes. */
  async fetchWeather(query: AreaQuery): Promise<Result<Sourced<readonly WeatherObservation[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `Open-Meteo unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly OpenMeteoResponse[]> {
    const json = await httpGetText(this.buildUrl(region.bbox), { timeoutMs: this.config.timeoutMs });
    return parseOpenMeteo(json);
  }

  private async loadMock(): Promise<readonly OpenMeteoResponse[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseOpenMeteo(res.value);
  }

  /** Query the bbox centre: /v1/forecast?latitude&longitude&current=…&wind_speed_unit=ms&timezone=UTC. */
  private buildUrl(bbox: Region['bbox']): string {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const lat = (minLat + maxLat) / 2;
    const lon = (minLon + maxLon) / 2;
    const base = this.config.url ?? DEFAULT_BASE_URL;
    return `${base}/v1/forecast?latitude=${lat}&longitude=${lon}&current=${CURRENT_VARS}&wind_speed_unit=ms&timezone=UTC`;
  }
}

/** Factory: resolve SOURCE_OPEN_METEO_* config from env. Fail-fast (CONFIG) on a bad mode/url. */
export function makeOpenMeteoAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<OpenMeteoAdapter> {
  const cfg = resolveSourceConfig({ prefix: 'OPEN_METEO', env, defaultMode: 'MOCK', defaultUrl: DEFAULT_BASE_URL });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new OpenMeteoAdapter({ engine, config: cfg.value }) };
}
