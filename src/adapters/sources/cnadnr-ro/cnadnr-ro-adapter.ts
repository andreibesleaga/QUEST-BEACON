// BEACON — CNADNR-RO adapter (CameraDirectoryPort P16; adapter-contract §6, E11 "Live Views" CW1). The
// hand-curated Romanian national-road-authority traffic-camera catalog -> canonical CameraFeed behind the
// shared redundancy ladder. Implements BOTH the framework SourceAdapterPort<CameraFeed> (fetch/health) AND
// the outward domain CameraDirectoryPort (fetchCameras -> Sourced), so the application depends only on the
// port, never on cnadnr.ro internals.
//
// MOCK-ONLY, config-gated (mirrors itu-adapter.ts): CNADNR/CNAIR "Trafic Live" has NO API — its camera
// pages (https://www.cnadnr.ro/ro/trafic-live/<location>) carry no machine-readable feed to poll, so there
// is no live rung to wire. The curated fixture (__fixtures__/cameras.json, hand-verified 2026-07-17) IS the
// catalog. `makeCnadnrRoAdapter` REJECTS SOURCE_CNADNR_RO_MODE=LIVE with a CONFIG error at boot (fail-fast,
// never a silent no-op or a scrape). CACHED is allowed and behaves like itu's: no live rung ever writes the
// last-known-good cache, so a cold cache falls straight through to the recorded mock (the curated catalog).
import { fileURLToPath } from 'node:url';
import type { CameraFeed, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { CameraDirectoryPort } from '@/ports/cameras.js';
import type { AreaQuery } from '@/ports/data-sources.js';
import type { BBox } from '@/domain/value-objects/geo.js';
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
import { loadFixtureText, resolveSourceConfig, makeAdapterError, err as adapterErr } from '@/adapters/_shared/index.js';
import type { CnadnrCameraRow } from './cnadnr-ro-acl.js';
import { cnadnrRoMapper, parseCnadnrRows } from './cnadnr-ro-acl.js';

const CNADNR_ID = 'cnadnr-ro';
const CNADNR_SOURCE = 'CNADNR/CNAIR Trafic Live';
const CNADNR_LICENSE = 'Official public agency pages (link-only)';
const MOCK_FIXTURE = 'cameras.json';

// Romania bbox (same rectangle used by meteoalarm-ro/nifc's RO test region) — used only to decide whether
// an inbound AreaQuery even plausibly falls inside CNADNR-RO's COUNTRIES=['RO'] coverage before we bother
// walking the ladder; the actual per-camera bbox filter happens after the fetch (see fetchCameras below).
const RO_BBOX: BBox = [20, 43, 30, 48];

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 3600; // curated catalog changes rarely; a longer TTL than live sources

export interface CnadnrRoAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class CnadnrRoAdapter implements SourceAdapterPort<CameraFeed>, CameraDirectoryPort {
  readonly id = CNADNR_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: ['RO'] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: CnadnrRoAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the redundancy ladder (no live rung — see class header). */
  fetch(region: Region): Promise<AdapterResult<FetchResult<CameraFeed>>> {
    return this.engine.run<CnadnrCameraRow, CameraFeed>({
      adapterId: this.id,
      source: CNADNR_SOURCE,
      license: CNADNR_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: cnadnrRoMapper,
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /**
   * Outward domain port (P16). Gates on whether `query.bbox` plausibly overlaps Romania (COUNTRIES=['RO']
   * coverage — a bbox with zero overlap fails NOT_COVERED, matching the honest "not available in this
   * region" contract, ADR-027/OP4), then bbox-filters the curated catalog down to cameras whose position
   * actually falls inside the requested query window (a hand-curated national catalog is small enough that
   * every consumer expects only the cameras relevant to its viewport, not the whole country every time).
   */
  async fetchCameras(query: AreaQuery): Promise<Result<Sourced<readonly CameraFeed[]>, DomainError>> {
    const region: Region = overlapsRomania(query.bbox)
      ? { id: 'query', bbox: query.bbox, iso: 'RO' }
      : { id: 'query', bbox: query.bbox };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `CNADNR-RO unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity).filter((c) => withinBbox(c.position, query.bbox));
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async loadMock(): Promise<readonly CnadnrCameraRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseCnadnrRows(res.value);
  }
}

/** Axis-aligned bbox overlap ([minLon,minLat,maxLon,maxLat]) between an inbound query and Romania. */
function overlapsRomania(bbox: BBox): boolean {
  return !(RO_BBOX[2] < bbox[0] || RO_BBOX[0] > bbox[2] || RO_BBOX[3] < bbox[1] || RO_BBOX[1] > bbox[3]);
}

/** True when a [lon,lat] position falls inside a [minLon,minLat,maxLon,maxLat] bbox (inclusive). */
function withinBbox(position: CameraFeed['position'], bbox: BBox): boolean {
  const [lon, lat] = position;
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/**
 * Factory: resolve SOURCE_CNADNR_RO_* config from env. Curated-catalog-only source — LIVE is rejected
 * fail-fast (CONFIG) because CNADNR/CNAIR "Trafic Live" has no machine-readable feed to poll (its pages
 * are link-only camera-view pages). Use MOCK (default) — the hand-curated, verified catalog.
 */
export function makeCnadnrRoAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<CnadnrRoAdapter> {
  const cfg = resolveSourceConfig({ prefix: 'CNADNR_RO', env, defaultMode: 'MOCK' });
  if (!cfg.ok) return cfg;
  if (cfg.value.mode === 'LIVE') {
    return adapterErr(
      makeAdapterError(
        'CONFIG',
        'CNADNR-RO: LIVE mode requires a machine-readable feed, but CNADNR/CNAIR "Trafic Live" publishes only link-only camera-view pages (no API, no lat/lon) — there is no live endpoint to poll. Use MOCK (default), the hand-curated verified catalog, until an official feed exists.',
        { retryable: false },
      ),
    );
  }
  return { ok: true, value: new CnadnrRoAdapter({ engine, config: cfg.value }) };
}
