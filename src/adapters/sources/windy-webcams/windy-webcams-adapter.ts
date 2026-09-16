// BEACON — Windy Webcams adapter (E11 "Live Views" · CW1 windy-webcams lane; CameraDirectoryPort P16).
// Windy Webcams API v3 global webcam directory → canonical CameraFeed behind the shared redundancy
// ladder (live → last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<CameraFeed> (fetch/health) AND the outward domain CameraDirectoryPort (fetchCameras
// → Sourced), so the application depends only on the port, never on Windy internals.
//
// LIVE_VIEWS_FEATURE_PLAN §3.3 windy-webcams row: free key (`WINDY_WEBCAMS_API_KEY`), GLOBAL (+RO)
// coverage, mode default CACHED→LIVE, mandatory "Webcams provided by windy.com" UI attribution (carried
// via CameraFeed.license — CW3 renders the badge). Config-driven: endpoint/mode/key/timeout come from
// SOURCE_WINDY_WEBCAMS_* env (key is WINDY_WEBCAMS_API_KEY); LIVE mode fails fast (CONFIG) without a key
// (clones the opencellid keyed exemplar — requireKeyForLive: true).
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { CameraFeed } from '@/domain/camera-feed.js';
import type { CameraDirectoryPort } from '@/ports/cameras.js';
import type { Sourced } from '@/ports/infra.js';
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
import type { WindyWebcamRaw } from './windy-webcams-acl.js';
import { parseWindyWebcams, windyWebcamsMapper } from './windy-webcams-acl.js';

const WINDY_WEBCAMS_ID = 'windy-webcams';
const WINDY_WEBCAMS_SOURCE = 'Windy Webcams';
const WINDY_WEBCAMS_LICENSE = 'Windy Webcams API ToS (link-only; attribution required)';
const DEFAULT_BASE_URL = 'https://api.windy.com/webcams/api/v3/webcams';
const DEFAULT_LIMIT = 50; // Windy v3 documented max per page
const MOCK_FIXTURE = 'webcams.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface WindyWebcamsAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly limit?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class WindyWebcamsAdapter implements SourceAdapterPort<CameraFeed>, CameraDirectoryPort {
  readonly id = WINDY_WEBCAMS_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // works for US + RO (and everywhere else Windy has webcams)
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly limit: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: WindyWebcamsAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.limit = deps.limit ?? DEFAULT_LIMIT;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped CameraFeed[]. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<CameraFeed>>> {
    return this.engine.run<WindyWebcamRaw, CameraFeed>({
      adapterId: this.id,
      source: WINDY_WEBCAMS_SOURCE,
      license: WINDY_WEBCAMS_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: windyWebcamsMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P16). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchCameras(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly CameraFeed[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `Windy Webcams unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly WindyWebcamRaw[]> {
    const headers = { 'x-windy-api-key': this.config.apiKey ?? '' };
    const json = await httpGetText(this.buildUrl(region), {
      timeoutMs: this.config.timeoutMs,
      headers,
    });
    return parseWindyWebcams(json).rows;
  }

  private async loadMock(): Promise<readonly WindyWebcamRaw[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseWindyWebcams(res.value).rows;
  }

  /**
   * Windy Webcams API v3 `GET /webcams`: `bbox` is `north_lat,east_lon,south_lat,west_lon` — a distinct
   * axis order from the BEACON internal `Region.bbox` (`[minLon,minLat,maxLon,maxLat]`, WGS-84). Converted
   * here, at the edge, so no other layer needs to know Windy's bbox convention. `include=location,urls`
   * is the minimal set the ACL needs (position + the windy.com detail page).
   */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    return `${base}?bbox=${north},${east},${south},${west}&include=location,urls&limit=${this.limit}`;
  }
}

/** Factory: resolve SOURCE_WINDY_WEBCAMS_* config from env and construct the adapter. Fail-fast on bad config. */
export function makeWindyWebcamsAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<WindyWebcamsAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'WINDY_WEBCAMS',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'WINDY_WEBCAMS_API_KEY',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new WindyWebcamsAdapter({ engine, config: cfg.value }) };
}
