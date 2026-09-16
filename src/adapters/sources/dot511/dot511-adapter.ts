// BEACON — 511 DOT adapter (E11 "Live Views" · CW1; adapter-contract §6, CameraDirectoryPort P16, ADR-027,
// LIVE_VIEWS_FEATURE_PLAN §3.3 dot511 row). State 511 traveler-info `get/cameras` API → canonical
// CameraFeed (kind TRAFFIC_CCTV) behind the shared redundancy ladder (live → last-known-good cache →
// recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<CameraFeed> (fetch/health)
// AND the outward domain CameraDirectoryPort (fetchCameras → Sourced), so the application depends only on
// the port, never on 511 internals.
//
// STATE-GENERIC BY DESIGN: the same apiary-style API shape (Id/Source/Roadway/Direction/Latitude/Longitude/
// Location/Views[]) is documented to run on many states' 511 systems (GA/NY/UT/ID/AZ/LA/...), so the base
// URL is config (`SOURCE_DOT511_URL`, defaulting to the verified GA pilot endpoint) and the developer key
// is config (`DOT511_API_KEY`) — a different deployment simply points at its own state's endpoint+key with
// zero code change. DATA_SOURCE_VERIFICATION verdict: CACHED default (a keyed, periodically-refreshed
// camera directory, not a push feed) — an operator opts into LIVE explicitly via SOURCE_DOT511_MODE.
//
// The upstream `get/cameras` call has NO bbox query parameter (it always returns the full state camera
// list), so `fetchCameras` fetches once (region-agnostic beyond the coverage gate) and filters the mapped
// cameras to the caller's query bbox client-side (same pattern as census-adapter.ts's estimatePopulation,
// which sums county centroids inside the query bbox after one fixed-scope fetch).
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
import type { Dot511RawCamera } from './dot511-acl.js';
import { dot511Mapper, parseDot511Cameras } from './dot511-acl.js';

const DOT511_ID = 'dot511';
const DOT511_SOURCE = '511 DOT (state traveler info)';
const DOT511_LICENSE = 'State DOT open data (developer key)';
// Verified GA pilot endpoint (LIVE_VIEWS_FEATURE_PLAN §3.3) — the default `SOURCE_DOT511_URL`. A per-state
// deployment overrides this to its own state's 511 `get/cameras` endpoint.
const DEFAULT_BASE_URL = 'https://511ga.org/api/v2/get/cameras';
/**
 * What the configured host actually covers (2026-09-14). A 511 `get/cameras` deployment answers for ONE
 * state, so a query about another state must not reach it: on the Georgia default, a California region
 * asked the Georgia host on every cycle, took an HTTP 400 for a key that host had never issued, degraded to
 * the Georgia fixture and clipped it away — noise in the deploy log, nothing on the map. A host this table
 * does not know keeps the US-wide declaration (the operator pointed `SOURCE_DOT511_URL` at their state).
 */
const HOST_COVERAGE: Readonly<Record<string, Coverage>> = {
  '511ga.org': { kind: 'BBOX', bbox: [-85.61, 30.36, -80.84, 35.0] }, // Georgia
};
const US_WIDE: Coverage = { kind: 'COUNTRIES', iso: ['US'] }; // per-state 511 systems, US-only overall

/** The coverage the configured `get/cameras` host can honestly claim. */
export function coverageForHost(url: string | undefined): Coverage {
  try {
    return HOST_COVERAGE[new URL(url ?? DEFAULT_BASE_URL).hostname] ?? US_WIDE;
  } catch {
    return US_WIDE;
  }
}
const MOCK_FIXTURE = 'cameras.json';
// The fixed internal query region: "all known cameras for the configured state" — independent of the
// caller's bbox (mirrors census-adapter.ts's CA_COUNTIES_REGION). A stable id keeps the last-known-good
// cache single-keyed regardless of which bbox fetchCameras is asked about.
const STATE_CAMERAS_REGION: Region = {
  id: 'dot511-state-cameras',
  bbox: [-180, -90, 180, 90],
  iso: 'US',
};

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface Dot511AdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class Dot511Adapter implements SourceAdapterPort<CameraFeed>, CameraDirectoryPort {
  readonly id = DOT511_ID;
  readonly coverage: Coverage;
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: Dot511AdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.coverage = coverageForHost(deps.config.url);
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped CameraFeed. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<CameraFeed>>> {
    return this.engine.run<Dot511RawCamera, CameraFeed>({
      adapterId: this.id,
      source: DOT511_SOURCE,
      license: DOT511_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: dot511Mapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /**
   * Outward domain port (P16). Fetches the full configured-state camera list, then keeps only the cameras
   * whose position lies inside `query.bbox` (point-in-bbox — the upstream API has no bbox parameter). No
   * matching camera ⇒ an empty list (never an error — a query bbox legitimately outside this state's
   * coverage is a valid, if uninteresting, answer).
   */
  async fetchCameras(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly CameraFeed[]>, DomainError>> {
    // The caller's bbox is what the coverage gate judges (the fetch itself is state-wide, see above): a
    // query outside the configured state's coverage sends nothing and answers the empty list it would
    // have answered after the clip — without the request.
    const res = await this.fetch({ ...STATE_CAMERAS_REGION, bbox: query.bbox });
    if (!res.ok && res.error.kind === 'NOT_COVERED') {
      return domainOk({ data: [], freshness: makeFreshness(new Date().toISOString()) });
    }
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `511 DOT unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const data = res.value.records
      .map((r) => r.entity)
      .filter((c) => pointInBBox(c.position, query.bbox));
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  // Note: the live query has no bbox/region parameter (511 `get/cameras` always returns the full
  // configured-state list), so the shared RedundancySpec.fetchLive `region` argument is not needed here
  // (mirrors census-adapter.ts's fixed-scope fetchLive()).
  private async fetchLive(): Promise<readonly Dot511RawCamera[]> {
    const json = await httpGetText(this.buildUrl(), { timeoutMs: this.config.timeoutMs });
    const parsed = parseDot511Cameras(json);
    if (parsed.skipped > 0) {
      console.warn(
        `dot511: skipped ${parsed.skipped} camera(s) (malformed or no enabled https view)`,
      );
    }
    return parsed.rows;
  }

  private async loadMock(): Promise<readonly Dot511RawCamera[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseDot511Cameras(res.value).rows;
  }

  /** 511 `get/cameras`: `?key=<developer key>&format=json`, no bbox/region parameter. */
  private buildUrl(): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const key = this.config.apiKey ?? '';
    return `${base}?key=${encodeURIComponent(key)}&format=json`;
  }
}

/** Point-in-bbox membership test (inclusive bounds) — scopes the state-wide camera list to a query bbox. */
function pointInBBox(point: readonly [number, number], bbox: AreaQuery['bbox']): boolean {
  const [lon, lat] = point;
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/** Factory: resolve SOURCE_DOT511_* config from env and construct the adapter. Fail-fast on bad config. */
export function makeDot511Adapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<Dot511Adapter> {
  const cfg = resolveSourceConfig({
    prefix: 'DOT511',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'DOT511_API_KEY',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new Dot511Adapter({ engine, config: cfg.value }) };
}
