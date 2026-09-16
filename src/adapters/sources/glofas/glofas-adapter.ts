// BEACON — GloFAS adapter (WP A11; adapter-contract §6, FloodGaugePort P2). Copernicus GloFAS (Global
// Flood Awareness System) reporting points → canonical Gauge behind the shared redundancy ladder (live →
// last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<Gauge> AND the outward FloodGaugePort, so the application depends only on the port,
// never on GloFAS internals. This is the RO/global flood rung beside NWPS (US river gauges).
//
// ── WP A11: STRICT-WMS MIGRATION (live-probed 2026-09-10; full evidence in glofas-wms.ts)
// The previous default endpoint (the `glofas-forecasting/wms` JSON façade on
// global-flood.emergency.copernicus.eu) is DECOMMISSIONED — it 301s into the site's React SPA — so the
// adapter was permanently non-live. It now speaks the real OGC WMS 1.3.0 service at
// `https://ows.globalfloods.eu/glofas-ows/ows.py`, which answers GetFeatureInfo with HTTP 200 and real
// reporting-point data, over plain HTTPS, WITH NO CREDENTIALS: the account gate assumed by the old
// `requireKeyForLive` does not exist on this service, so no key is required or sent (GLOFAS_CDS_KEY is
// no longer read; it belonged to the CDS/EWDS download API, not to this WMS).
//
// ── WHY A WATCH-POINT LIST AND NOT A BBOX SWEEP (the load-bearing protocol limit)
// WMS GetFeatureInfo is a CLICK protocol: measured on the live service, it returns AT MOST ONE point per
// call whatever FEATURE_COUNT says, ignores the BUFFER/RADIUS tolerance extensions, and only hits within
// a fixed ~0.02° of the clicked coordinate; there is no WFS and no JSON GetMap. A 3×3 probe grid over
// Romania/Bangladesh at four canvas sizes returned 0–1 points out of 9 requests, and covering a region at
// GloFAS's 0.05° point spacing would need tens of thousands of requests. So the honest live design is to
// interrogate a CONFIGURED list of reporting-point coordinates (`SOURCE_GLOFAS_POINTS`, 12-factor, nothing
// hardcoded) — one bounded request per point, filtered to the requested region. With no configured point
// in a region the LIVE rung has nothing to ask for, and the adapter degrades to cache/mock WITHOUT
// charging the circuit breaker: that is a configuration gap, not an upstream outage.
//
// Honest limitation to surface in the UI/docs: GloFAS live coverage is exactly the operator-configured
// point list — it is not a sweep of every reporting point in view.
import { fileURLToPath } from 'node:url';
import type { Gauge, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { FloodGaugePort, AreaQuery } from '@/ports/data-sources.js';
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
import {
  err,
  httpGetText,
  loadFixtureText,
  makeAdapterError,
  ok,
  resolveSourceConfig,
} from '@/adapters/_shared/index.js';
import type { GlofasReportingPoint } from './glofas-acl.js';
import { glofasMapper, parseGlofasFeatureInfo } from './glofas-acl.js';
import { buildGlofasFeatureInfoUrl } from './glofas-wms.js';

const GLOFAS_ID = 'glofas';
const GLOFAS_SOURCE = 'Copernicus GloFAS';
const GLOFAS_LICENSE = 'Copernicus open (free, attribution)';

/** The real OGC WMS 1.3.0 endpoint (GetCapabilities verified 200/text/xml, 2026-09-10). */
const DEFAULT_BASE_URL = 'https://ows.globalfloods.eu/glofas-ows/ows.py';
/** The queryable layer that carries TODAY's global reporting points (GetCapabilities queryable="1"). */
const DEFAULT_LAYER = 'RPG_U_GLOFAS_3_3';

/**
 * Recorded live GetFeatureInfo responses (2026-09-10) — the mock rung replays REAL upstream payloads,
 * parsed by the same ACL as the live rung. The set is deliberately mixed: a Romanian Siret point (the RO
 * demo region), an active Medium alert, and two inactive points that carry the rising and stagnant
 * tendency glyphs, so the offline path exercises every branch the live path can take.
 */
const MOCK_FIXTURES = [
  'getfeatureinfo-romania-siret.html',
  'getfeatureinfo-medium.html',
  'getfeatureinfo-inactive-rising.html',
  'getfeatureinfo-stagnant.html',
] as const;

/**
 * Courtesy cap on one live fetch. Each watch point costs one request against a free public service, so a
 * mis-sized `SOURCE_GLOFAS_POINTS` must not turn one COP refresh into a flood of requests.
 */
const MAX_LIVE_POINTS_PER_FETCH = 12;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

/** One GloFAS reporting point BEACON is configured to interrogate. */
export interface GlofasWatchPoint {
  readonly lon: number;
  readonly lat: number;
}

export interface GlofasAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  /** Reporting points the LIVE rung interrogates (from SOURCE_GLOFAS_POINTS). */
  readonly watchPoints?: readonly GlofasWatchPoint[];
  /** Queryable WMS layer (from SOURCE_GLOFAS_LAYER). */
  readonly layer?: string;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class GlofasAdapter implements SourceAdapterPort<Gauge>, FloodGaugePort {
  readonly id = GLOFAS_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // GloFAS is a global flood forecast
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly watchPoints: readonly GlofasWatchPoint[];
  private readonly layer: string;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: GlofasAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.watchPoints = deps.watchPoints ?? [];
    this.layer = deps.layer ?? DEFAULT_LAYER;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<Gauge>>> {
    const points = glofasPointsInRegion(this.watchPoints, region.bbox).slice(
      0,
      MAX_LIVE_POINTS_PER_FETCH,
    );
    return this.engine.run<GlofasReportingPoint, Gauge>({
      adapterId: this.id,
      source: GLOFAS_SOURCE,
      license: GLOFAS_LICENSE,
      // A LIVE adapter with nothing to interrogate here enters the ladder at CACHED: the breaker records
      // upstream health, and a configuration gap is not an upstream failure.
      mode: this.mode === 'LIVE' && points.length === 0 ? 'CACHED' : this.mode,
      // Name the gap: the live log otherwise reads "cache was cold" for a region that simply has no
      // configured reporting point, which looks like an outage and is not one.
      ...(this.mode === 'LIVE' && points.length === 0
        ? {
            cachedReason: `no SOURCE_GLOFAS_POINTS reporting point lies inside region '${region.id}' (mode=LIVE, ${this.watchPoints.length} configured)`,
          }
        : {}),
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: glofasMapper,
      fetchLive: () => this.fetchLive(points),
      // The mock rung is region-scoped for the SAME reason the live rung is. GloFAS is a global service,
      // so the recorded responses deliberately span continents; replaying all of them for every region put
      // gauges from Tibet, Alaska and Tennessee on the Romanian COP whenever the live rung was down.
      // The degraded rung is precisely when an operator most needs the picture to be trustworthy, and a
      // gauge outside the region is not a degraded reading — it is a wrong one. Art. XVI licenses
      // degrading and labelling; it never licenses answering a different question.
      loadMockRaw: () => this.loadMock(region.bbox),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P2). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchGauges(query: AreaQuery): Promise<Result<Sourced<readonly Gauge[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `GloFAS unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  /**
   * Interrogate each configured reporting point with one WMS 1.3.0 GetFeatureInfo. Sequential on purpose:
   * a free public service should see one request at a time, and a transport failure then surfaces on the
   * first point instead of after N parallel timeouts. Any failure propagates so the ladder degrades to
   * last-known-good rather than publishing a partial picture as if it were the whole one.
   */
  private async fetchLive(
    points: readonly GlofasWatchPoint[],
  ): Promise<readonly GlofasReportingPoint[]> {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const out: GlofasReportingPoint[] = [];
    for (const point of points) {
      const url = buildGlofasFeatureInfoUrl({ baseUrl: base, layer: this.layer, ...point });
      const html = await httpGetText(url, { timeoutMs: this.config.timeoutMs });
      out.push(...parseGlofasFeatureInfo(html)); // "No content" (no point hit) contributes nothing
    }
    return out;
  }

  /**
   * Replay the recorded live responses — one reporting point each, parsed by the same ACL as LIVE, then
   * KEPT ONLY IF THE POINT FALLS INSIDE THE REGION. A recorded point with no coordinates is dropped: it
   * cannot be placed on a map, and a gauge whose location is unknown is not a gauge an operator can act on.
   */
  private async loadMock(
    bbox: readonly [number, number, number, number],
  ): Promise<readonly GlofasReportingPoint[]> {
    const out: GlofasReportingPoint[] = [];
    for (const name of MOCK_FIXTURES) {
      const res = await loadFixtureText(this.fixturesDir, name);
      if (!res.ok) throw res.error;
      out.push(...parseGlofasFeatureInfo(res.value));
    }
    const [west, south, east, north] = bbox;
    return out.filter(
      (p) =>
        p.lon !== undefined &&
        p.lat !== undefined &&
        p.lon >= west &&
        p.lon <= east &&
        p.lat >= south &&
        p.lat <= north,
    );
  }
}

/**
 * Parse `SOURCE_GLOFAS_POINTS` — a `;`-separated list of `lon,lat` reporting-point coordinates, e.g.
 * `27.9457,45.4353;25.0,44.4`. Unset/empty means "no live watch points" (the LIVE rung then degrades to
 * cache/mock). A malformed or out-of-range entry FAILS FAST rather than silently interrogating a wrong
 * pixel — GloFAS's hit tolerance is ~0.02°, so a bad coordinate returns another river's forecast.
 *
 * Coordinates come from the GloFAS reporting-point catalogue (the point's "Longitude/Latitude [Deg]" in
 * the viewer, or the JRC reporting-points dataset); they are stable station locations.
 */
export function parseGlofasWatchPoints(
  raw: string | undefined,
): AdapterResult<readonly GlofasWatchPoint[]> {
  const entries = (raw ?? '')
    .split(';')
    .map((e) => e.trim())
    .filter((e) => e !== '');
  const points: GlofasWatchPoint[] = [];
  for (const entry of entries) {
    const point = parsePoint(entry);
    if (point === undefined) {
      return err(
        makeAdapterError(
          'CONFIG',
          `SOURCE_GLOFAS_POINTS entry must be 'lon,lat' within EPSG:4326, got '${entry}'`,
        ),
      );
    }
    points.push(point);
  }
  return ok(points);
}

/** Keep the watch points inside a `[west, south, east, north]` region bbox (edges inclusive). */
export function glofasPointsInRegion(
  points: readonly GlofasWatchPoint[],
  bbox: readonly [number, number, number, number],
): readonly GlofasWatchPoint[] {
  const [west, south, east, north] = bbox;
  return points.filter((p) => p.lon >= west && p.lon <= east && p.lat >= south && p.lat <= north);
}

function parsePoint(entry: string): GlofasWatchPoint | undefined {
  const parts = entry.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 2) return undefined;
  const [lon, lat] = parts as [number, number];
  const valid =
    Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
  return valid ? { lon, lat } : undefined;
}

/**
 * Factory: resolve the GloFAS config from env (12-factor; nothing hardcoded). Default mode stays CACHED —
 * per the honesty law, LIVE is flipped by an operator on recorded evidence at deploy time, never here.
 * No API key is read: the strict-WMS endpoint is keyless (verified live 2026-09-10).
 */
export function makeGlofasAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<GlofasAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'GLOFAS',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  const points = parseGlofasWatchPoints(env.SOURCE_GLOFAS_POINTS);
  if (!points.ok) return points;
  return ok(
    new GlofasAdapter({
      engine,
      config: cfg.value,
      watchPoints: points.value,
      layer: env.SOURCE_GLOFAS_LAYER ?? DEFAULT_LAYER,
    }),
  );
}
