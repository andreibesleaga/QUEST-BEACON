// BEACON — ALERTWildfire/ALERTCalifornia adapter (E11 "Live Views" · CW1; adapter-contract §6, ADR-027,
// CameraDirectoryPort). Fire-spotting PTZ cameras → canonical CameraFeed (kind FIRE_CAMERA) behind the
// shared redundancy ladder (live → last-known-good cache → recorded-mock → unavailable). Implements BOTH
// the framework SourceAdapterPort<CameraFeed> (fetch/health) AND the outward CameraDirectoryPort
// (fetchCameras → Sourced), so the application depends only on the port, never on ArcGIS/ALERT internals.
//
// SPIKE RESULT (2026-07-17): the ALERTWest OpenAPI (docs.alertwest.org/docs/OpenAPI/…) 404s and its api
// host is unreachable keyless → the honest, verified LIVE source is the KEYLESS ArcGIS Living Atlas
// "ALERTCalifornia Live Cameras" FeatureServer (item 0c1c1166688f4f2db938194799337be4; owner
// ALERTCaliforniaProcess; accessInformation "ALERTCalifornia | UC San Diego"; licenseInfo CC BY-NC-ND 4.0).
// THE VIEW-URL QUESTION is answered by the layer's own per-camera `cameraURL` attribute (verified
// camera-specific + host 200), so viewUrl is never a guess — see alertwildfire-acl.ts. 1,250 active
// cameras at capture time.
//
// Config-driven: endpoint/mode/timeout come from SOURCE_ALERTWILDFIRE_* env. Keyless. defaultMode is CACHED
// (plan Q3/§3.3 — live-capable but a kindness default toward the shared ArcGIS service; an operator opts
// into LIVE via SOURCE_ALERTWILDFIRE_MODE=LIVE). Honest limitation: CC BY-NC-ND is link-only — BEACON pins
// link out to the ALERT view page and never rehosts the imagery (Art. XII, advisory-not-fact).
import { fileURLToPath } from 'node:url';
import type { CameraFeed, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
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
import type { AlertCameraRow } from './alertwildfire-acl.js';
import { alertWildfireMapper, parseAlertCameras } from './alertwildfire-acl.js';

const ALERT_ID = 'alertwildfire';
const ALERT_SOURCE = 'ALERTCalifornia';
// Attribution string carried on every provenance record (mandatory credit — plan Q3/FR-CAM-3).
const ALERT_PROV_LICENSE =
  'CC BY-NC-ND 4.0 (imagery; link-only use) — ALERTCalifornia | UC San Diego';
const DEFAULT_BASE_URL =
  'https://services8.arcgis.com/X84q166Srnyl4JMV/arcgis/rest/services/ALERTCalifornia_Camera_Feed/FeatureServer/0/query';
const DEFAULT_RESULT_RECORD_COUNT = 200; // one page of the ~1,250-camera network; live query is bbox-scoped
const MOCK_FIXTURE = 'cameras.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface AlertWildfireAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly resultRecordCount?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class AlertWildfireAdapter implements SourceAdapterPort<CameraFeed>, CameraDirectoryPort {
  readonly id = ALERT_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: ['US'] }; // ALERTCalifornia network: US (CA + West)
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly resultRecordCount: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: AlertWildfireAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.resultRecordCount = deps.resultRecordCount ?? DEFAULT_RESULT_RECORD_COUNT;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped CameraFeed rows. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<CameraFeed>>> {
    return this.engine.run<AlertCameraRow, CameraFeed>({
      adapterId: this.id,
      source: ALERT_SOURCE,
      license: ALERT_PROV_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: alertWildfireMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /**
   * Outward domain port (CameraDirectoryPort, P16). Fetches the covered camera set, then keeps only the
   * cameras whose installation point lies inside `query.bbox` (MOCK serves the whole recorded network; the
   * LIVE query is already bbox-scoped server-side, so this post-filter is a cheap, mode-independent scope).
   */
  async fetchCameras(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly CameraFeed[]>, DomainError>> {
    // AreaQuery carries no iso; the ALERTCalifornia network is US-only (coverage COUNTRIES[US]), supplied
    // here rather than left for the caller (mirrors nifc/nfhl, the other COUNTRIES[US] outward ports).
    const res = await this.fetch({ id: 'query', bbox: query.bbox, iso: 'US' });
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `ALERTWildfire unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const data = res.value.records
      .map((r) => r.entity)
      .filter((c) => pointInBBox(c.position, query.bbox));
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly AlertCameraRow[]> {
    const json = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    const parsed = parseAlertCameras(json);
    if (parsed.skipped > 0) {
      console.warn(
        `alertwildfire: skipped ${parsed.skipped} malformed/urlless camera feature(s) from live response`,
      );
    }
    return parsed.rows;
  }

  private async loadMock(): Promise<readonly AlertCameraRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseAlertCameras(res.value).rows;
  }

  /** ALERTCalifornia FeatureServer query: envelope geometry filter over the region bbox, active cameras,
   *  GeoJSON output, only the fields the ACL reads (no over-fetch). */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    const params = new URLSearchParams({
      where: "isActive = 'active'",
      outFields: 'OBJECTID,cameraName,siteId,county,cameraURL,viewTime',
      f: 'geojson',
      resultRecordCount: String(this.resultRecordCount),
      geometry: `${west},${south},${east},${north}`,
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
    });
    return `${base}?${params.toString()}`;
  }
}

/** Inclusive point-in-bbox test — scopes the mapped camera set to a query bbox (mirrors census-acl). */
function pointInBBox(point: CameraFeed['position'], bbox: AreaQuery['bbox']): boolean {
  const [lon, lat] = point;
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/** Factory: resolve SOURCE_ALERTWILDFIRE_* config from env. Fail-fast (CONFIG) on a bad mode. Keyless. */
export function makeAlertWildfireAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<AlertWildfireAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'ALERTWILDFIRE',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new AlertWildfireAdapter({ engine, config: cfg.value }) };
}
