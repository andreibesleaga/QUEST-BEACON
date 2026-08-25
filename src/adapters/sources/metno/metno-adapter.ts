// BEACON — MET Norway Locationforecast adapter (S2·Lane A3; adapter-contract §6, WeatherSourcePort P3).
// api.met.no Locationforecast 2.0 `compact` → canonical WeatherObservation behind the shared redundancy
// ladder (live → last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<WeatherObservation> (fetch/health) AND the outward domain WeatherSourcePort
// (fetchWeather → Sourced), so the application depends only on the port, never on met.no internals.
//
// DATA_SOURCE_VERIFICATION §3 (weather ladder row): met.no Locationforecast 2.0 is free — including
// commercial use — under CC BY 4.0 / NLOD, global coverage, with a **mandatory identifying contact
// User-Agent**. Verified LIVE 2026-08-08 from this repo (see metno-acl.ts header for the recorded response).
// It is the EU/global alternative to Open-Meteo in the weather ladder (Art. XVI), not a warning authority.
//
// LICENCE OBLIGATION, NOT AN OPTION — the User-Agent: MET Norway's terms of service require every client to
// identify itself with a contact (project + e-mail/URL) in the User-Agent header, and reserve the right to
// block anonymous or generic agents. BEACON therefore treats `METNO_USER_AGENT` as this source's REQUIRED
// credential: `resolveSourceConfig({ keyEnv: 'METNO_USER_AGENT', requireKeyForLive: true })` makes the
// factory FAIL FAST (CONFIG) if LIVE mode is selected without one, so the app can never quietly hammer
// api.met.no unidentified. CACHED/MOCK need no User-Agent (they make no request).
//
// Config-driven: mode/url/timeout from SOURCE_METNO_* env, contact UA from METNO_USER_AGENT (12-factor;
// nothing hardcoded).
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { AreaQuery, WeatherObservation, WeatherSourcePort } from '@/ports/data-sources.js';
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
import type { MetnoRaw } from './metno-acl.js';
import { metnoMapper, parseMetnoForecast } from './metno-acl.js';

const METNO_ID = 'metno';
const METNO_SOURCE = 'MET Norway Locationforecast';
// Declared verbatim by MET Norway for their free API data (DATA_SOURCE_VERIFICATION §3 weather-ladder row).
const METNO_LICENSE = 'CC BY 4.0 / NLOD (MET Norway)';
const DEFAULT_BASE_URL = 'https://api.met.no';
const MOCK_FIXTURE = 'locationforecast.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// met.no publishes an `Expires` header ~30 min out and asks clients not to re-poll sooner; 900 s keeps the
// last-known-good rung comfortably inside that guidance while staying as fresh as the rest of the ladder.
const DEFAULT_CACHE_TTL_SEC = 900;

export interface MetnoAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class MetnoAdapter implements SourceAdapterPort<WeatherObservation>, WeatherSourcePort {
  readonly id = METNO_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // global NWP model ⇒ every region (EU/RO/worldwide)
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: MetnoAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped WeatherObservations. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<WeatherObservation>>> {
    return this.engine.run<MetnoRaw, WeatherObservation>({
      adapterId: this.id,
      source: METNO_SOURCE,
      license: METNO_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: metnoMapper,
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
      return domainErr(new DomainError('NOT_FOUND', `met.no unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly MetnoRaw[]> {
    const text = await httpGetText(this.buildUrl(region.bbox), {
      timeoutMs: this.config.timeoutMs,
      headers: { 'User-Agent': this.config.apiKey ?? '' }, // licence obligation — see module header
    });
    return parseMetnoForecast(text).rows;
  }

  private async loadMock(): Promise<readonly MetnoRaw[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseMetnoForecast(res.value).rows;
  }

  /**
   * Locationforecast 2.0 is a POINT API — it takes lat/lon, never a bbox — so the bbox CENTRE is queried
   * (same convention as the Open-Meteo adapter, keeping the two weather rungs directly comparable).
   * met.no asks for ≤4 decimals of coordinate precision (finer values defeat their cache) — honoured here.
   */
  private buildUrl(bbox: Region['bbox']): string {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const lat = round4((minLat + maxLat) / 2);
    const lon = round4((minLon + maxLon) / 2);
    const base = this.config.url ?? DEFAULT_BASE_URL;
    return `${base}/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
  }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Factory: resolve SOURCE_METNO_* config from env. Fail-fast (CONFIG) on a bad mode, or on LIVE mode
 * without `METNO_USER_AGENT` — MET Norway's terms REQUIRE an identifying contact User-Agent, so a LIVE
 * met.no with no contact string is a licence violation, not a degraded mode (module header).
 */
export function makeMetnoAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<MetnoAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'METNO',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'METNO_USER_AGENT',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new MetnoAdapter({ engine, config: cfg.value }) };
}
