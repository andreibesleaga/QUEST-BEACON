// BEACON — Caltrans District CCTV adapter (E11 "Live Views" · CW1; adapter-contract §6, CameraDirectoryPort
// P16, ADR-027). Caltrans CWWP2 per-district traffic-camera status JSON → canonical CameraFeed (kind
// TRAFFIC_CCTV) behind the shared redundancy ladder (live → last-known-good cache → recorded-mock →
// unavailable). Implements BOTH the framework SourceAdapterPort<CameraFeed> (fetch/health) AND the outward
// domain CameraDirectoryPort (fetchCameras → Sourced), so the application depends only on the port, never
// on Caltrans/CWWP2 internals.
//
// VERIFIED LIVE (2026-07-17, `curl -sS https://cwwp2.dot.ca.gov/data/d3/cctv/cctvStatusD03.json`): keyless,
// no ToS friction, decimal lat/lon + direct https view-links (see caltrans-cctv-acl.ts header for the full
// payload-shape note). District 3 covers Butte County — the BEACON CA flagship scenario area — alongside
// Sacramento/El Dorado/Placer/Yolo/Nevada/Colusa/Yuba/Sutter/Alameda. `__fixtures__/cameras.json` is a
// 12-camera trim of that live response (10 Butte County cameras + 1 no-stream-but-in-service + 1
// out-of-service, recorded 2026-07-17).
//
// Config-driven: endpoint/mode/timeout come from SOURCE_CALTRANS_CCTV_* env (keyless — Caltrans open data
// carries no API key). defaultMode is LIVE (per the feature-plan source table: no key, zero ToS friction —
// same "keyless → safe LIVE default, F5 degrades to mock on outage" reasoning as gdelt-adapter.ts).
//
// ONE DISTRICT PER FETCH: the CWWP2 endpoint is a static per-district file with NO server-side bbox/query
// capability (unlike NFHL/NIFC's ArcGIS envelope query or OpenCelliD's native BBOX param) — `buildUrl`
// therefore ignores the queried region entirely and always fetches the one configured district endpoint
// (default: district 3). Region-scoping instead happens CLIENT-SIDE after parsing: `fetchLive`/`loadMock`
// filter the already-geolocated rows down to the queried `region.bbox` before handing them to the shared
// mapper, so a caller asking for a small CA sub-area does not get the whole district's camera roster.
import { fileURLToPath } from 'node:url';
import type { CameraFeed, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type { Sourced } from '@/ports/infra.js';
import type { AreaQuery } from '@/ports/data-sources.js';
import type { CameraDirectoryPort } from '@/ports/cameras.js';
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
import type { CaltransCameraRow } from './caltrans-cctv-acl.js';
import { CALTRANS_CCTV_LICENSE, caltransCctvMapper, parseCaltransCameras } from './caltrans-cctv-acl.js';

const CALTRANS_CCTV_ID = 'caltrans-cctv';
const CALTRANS_CCTV_SOURCE = 'Caltrans District CCTV';
const DEFAULT_BASE_URL = 'https://cwwp2.dot.ca.gov/data/d3/cctv/cctvStatusD03.json';
const MOCK_FIXTURE = 'cameras.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 300; // traffic CCTV status refreshes fast (CWWP2: "5-min updates")

export interface CaltransCctvAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class CaltransCctvAdapter implements SourceAdapterPort<CameraFeed>, CameraDirectoryPort {
  readonly id = CALTRANS_CCTV_ID;
  // Real coverage is CA-only (the district endpoints are all within California), but the domain Region/
  // Coverage vocabulary is country-granular — declared COUNTRIES[US], mirroring nifc-adapter.ts/
  // nfhl-adapter.ts (both real-coverage-narrower-than-country US sources use the same COUNTRIES[US] shape).
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: ['US'] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: CaltransCctvAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped CameraFeed rows. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<CameraFeed>>> {
    return this.engine.run<CaltransCameraRow, CameraFeed>({
      adapterId: this.id,
      source: CALTRANS_CCTV_SOURCE,
      license: CALTRANS_CCTV_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: caltransCctvMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(region),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P16). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchCameras(query: AreaQuery): Promise<Result<Sourced<readonly CameraFeed[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox, iso: 'US' };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `Caltrans CCTV unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly CaltransCameraRow[]> {
    const json = await httpGetText(this.buildUrl(), { timeoutMs: this.config.timeoutMs });
    const parsed = parseCaltransCameras(json);
    if (parsed.skipped > 0) {
      console.warn(`caltrans-cctv: skipped ${parsed.skipped} unusable camera row(s) from live response`);
    }
    return parsed.rows.filter((row) => positionInBbox(row.position, region.bbox));
  }

  private async loadMock(region: Region): Promise<readonly CaltransCameraRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseCaltransCameras(res.value).rows.filter((row) => positionInBbox(row.position, region.bbox));
  }

  /** The CWWP2 per-district endpoint has no bbox/query capability — always fetch the one configured
   *  district file (default: district 3), regardless of the queried region (see module header). */
  private buildUrl(): string {
    return this.config.url ?? DEFAULT_BASE_URL;
  }
}

/** Axis-aligned point-in-bbox test ([minLon,minLat,maxLon,maxLat], WGS-84) — the client-side stand-in for
 *  the server-side spatial query Caltrans's per-district file cannot do (module header). */
function positionInBbox(position: Position, bbox: readonly [number, number, number, number]): boolean {
  const [lon, lat] = position;
  const [west, south, east, north] = bbox;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/** Factory: resolve SOURCE_CALTRANS_CCTV_* config from env. Fail-fast (CONFIG) on a bad mode. Keyless —
 *  no API key (Caltrans open data). */
export function makeCaltransCctvAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<CaltransCctvAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'CALTRANS_CCTV',
    env,
    defaultMode: 'LIVE',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new CaltransCctvAdapter({ engine, config: cfg.value }) };
}
