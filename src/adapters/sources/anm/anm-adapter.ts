// BEACON — ANM (Romania national meteorological service) adapter (S2·Lane A3; adapter-contract §6,
// WeatherSourcePort P3). `meteoromania.ro/wp-json/meteoapi/v2/starea-vremii` station observations →
// canonical WeatherObservation behind the shared redundancy ladder (live → last-known-good cache →
// recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<WeatherObservation>
// (fetch/health) AND the outward domain WeatherSourcePort (fetchWeather → Sourced), so the application
// depends only on the port, never on ANM internals.
//
// WHY: RO-specific ground-truth corroboration alongside the two model rungs (Open-Meteo, met.no) and the
// official-warning rung (`meteoalarm-ro`) — a national-service station network, not a global model.
// Keyless: ANM's meteoapi needs no token (DATA_SOURCE_VERIFICATION §10.1, live-verified 2026-07-02).
//
// ⚠ HONEST LIVE STATUS (verified 2026-08-08, this repo): `www.meteoromania.ro` was NOT reachable from this
// build environment — TCP/443 resets the TLS handshake for every client tried (curl default, browser UA,
// TLS 1.2 and 1.3, plain HTTP times out), while other .ro hosts fetched fine in the same run. That is
// host-side filtering (datacenter/geo), not a dead endpoint: the audit live-verified it on 2026-07-02 and
// the Internet Archive holds 200-responses through mid-2026. So this adapter ships:
//   • LIVE-CAPABLE and KEYLESS — no credential gate, the live rung is fully implemented;
//   • defaultMode CACHED — the honest default for a host we could not reach at build time (Art. XVI);
//   • with a REAL recorded response as its mock rung (provenance in anm-acl.ts header).
// TO GO LIVE: from a network that can reach the host, run
//   curl -sS "https://www.meteoromania.ro/wp-json/meteoapi/v2/starea-vremii" | head -c 400
// and, if it returns the FeatureCollection, set `SOURCE_ANM_MODE=live` (nothing else changes). If it still
// fails, leave it CACHED — do not claim a live RO weather rung that the demo network cannot serve.
//
// Config-driven: mode/url/timeout from SOURCE_ANM_* env (12-factor; nothing hardcoded).
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
import type { AnmRaw } from './anm-acl.js';
import { anmMapper, parseAnmObservations } from './anm-acl.js';

const ANM_ID = 'anm';
const ANM_SOURCE = 'ANM Meteo România';
// ANM publishes these feeds openly with no declared licence text; BEACON records the attribution ask it can
// honour honestly (institutional credit) rather than inventing a licence label (Art. XI, NOTICE).
const ANM_LICENSE = 'ANM (Administrația Națională de Meteorologie, România) — free public feed, attribution requested';
const DEFAULT_BASE_URL = 'https://www.meteoromania.ro';
const OBSERVATIONS_PATH = '/wp-json/meteoapi/v2/starea-vremii';
const MOCK_FIXTURE = 'starea-vremii.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// ANM publishes station observations on the synoptic hour; a 1 h last-known-good window matches that
// cadence without ever serving a value older than the next publication.
const DEFAULT_CACHE_TTL_SEC = 3600;
const RO_ISO = 'RO';

export interface AnmAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class AnmAdapter implements SourceAdapterPort<WeatherObservation>, WeatherSourcePort {
  // ANM is Romania's NATIONAL service: its station network is unconditionally RO-only, never derived from
  // the caller's bbox. COUNTRIES coverage makes a query outside RO return NOT_COVERED instead of nothing.
  readonly id = ANM_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: [RO_ISO] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: AnmAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped WeatherObservations. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<WeatherObservation>>> {
    return this.engine.run<AnmRaw, WeatherObservation>({
      adapterId: this.id,
      source: ANM_SOURCE,
      license: ANM_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: anmMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P3). ANM's coverage is unconditionally national — see the coverage note above. */
  async fetchWeather(query: AreaQuery): Promise<Result<Sourced<readonly WeatherObservation[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox, iso: RO_ISO });
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `ANM unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  /**
   * The feed is a NATIONAL snapshot — it takes no bbox/station parameter — so the whole station set is
   * fetched and the caller's bbox is a coverage gate, not a query filter. Stated plainly so nobody later
   * "adds the missing bbox param" that ANM does not implement.
   */
  private async fetchLive(): Promise<readonly AnmRaw[]> {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const text = await httpGetText(`${base}${OBSERVATIONS_PATH}`, { timeoutMs: this.config.timeoutMs });
    return parseAnmObservations(text).rows;
  }

  private async loadMock(): Promise<readonly AnmRaw[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseAnmObservations(res.value).rows;
  }
}

/**
 * Factory: resolve SOURCE_ANM_* config from env. Keyless — ANM's meteoapi requires no credential, so there
 * is deliberately no `keyEnv`/`requireKeyForLive` here. defaultMode CACHED per the honest live status in the
 * module header; `SOURCE_ANM_MODE=live` is the single switch once the host is reachable.
 */
export function makeAnmAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<AnmAdapter> {
  const cfg = resolveSourceConfig({ prefix: 'ANM', env, defaultMode: 'CACHED', defaultUrl: DEFAULT_BASE_URL });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new AnmAdapter({ engine, config: cfg.value }) };
}
