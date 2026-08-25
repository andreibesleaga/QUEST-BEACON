// BEACON — NASA EONET adapter (S2·Lane-A2; adapter-contract §6, HazardSourcePort P1; Art. XVI). NASA's
// curated Earth Observatory Natural Event Tracker feed → canonical HazardGeometry (event centroid) behind
// the shared redundancy ladder (live → last-known-good cache → recorded-mock → typed unavailable).
// Implements BOTH the framework SourceAdapterPort<HazardGeometry> AND the outward domain HazardSourcePort,
// so the application depends only on the port, never on EONET internals.
//
// SOURCE (live-verified 2026-08-08 by real curl, HTTP 200, KEYLESS — see eonet-acl.ts header for the
// recorded response): `https://eonet.gsfc.nasa.gov/api/v3/events`, query `status=open&limit=<n>`.
// No API key, no registration, no published rate limit (politeness: capped `limit`, 900 s cache TTL,
// circuit breaker). NASA open data with an attribution request — kept visible in provenance/NOTICE.
//
// ROLE: secondary corroboration to `gdelt`/`agency-rss` and a second opinion alongside GDACS. EONET is a
// CURATED feed (a human/automated editor promotes upstream reports into events), so it lags satellite
// detection — it corroborates, it does not lead. Its geometry is an event CENTROID, never a footprint:
// `live-seed.ts` HAZARD_FOOTPRINT_SOURCES therefore does NOT list `eonet`, so it is cited on the SitRep
// path and never painted as a hazard extent on the map (F-06/F-48 class).
import { fileURLToPath } from 'node:url';
import type { HazardGeometry, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { AreaQuery, HazardSourcePort } from '@/ports/data-sources.js';
import type {
  AdapterHealth,
  AdapterResult,
  BreakerConfig,
  Coverage,
  Env,
  FetchResult,
  RedundancyEngine,
  Region,
  SourceAdapterPort,
  SourceConfig,
  SourceMode,
} from '@/adapters/_shared/index.js';
import { httpGetText, loadFixtureText, ok, resolveSourceConfig } from '@/adapters/_shared/index.js';
import type { EonetEvent } from './eonet-acl.js';
import { eonetMapper, parseEonetEvents } from './eonet-acl.js';

const ADAPTER_ID = 'eonet';
const SOURCE = 'NASA EONET v3';
// DATA_SOURCE_VERIFICATION: NASA open data carries an attribution REQUEST (not bare public domain) —
// same treatment as FIRMS, so the ask stays visible in every provenance stamp (Art. XI).
const LICENSE = 'NASA open / attribution requested';
const DEFAULT_BASE_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
const MOCK_FIXTURE = 'events.json';
// Per-fetch event cap: EONET has no published rate limit, so the adapter bounds its own request size
// rather than assuming the host will. 50 open events comfortably covers the global wildfire set.
const DEFAULT_LIMIT = 50;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface EonetAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly limit?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class EonetAdapter implements SourceAdapterPort<HazardGeometry>, HazardSourcePort {
  readonly id = ADAPTER_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // curated from global reporters — every country
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly limit: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: EonetAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.limit = deps.limit ?? DEFAULT_LIMIT;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped HazardGeometry. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<HazardGeometry>>> {
    return this.engine.run<EonetEvent, HazardGeometry>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: eonetMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P1). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchHazards(query: AreaQuery): Promise<Result<Sourced<readonly HazardGeometry[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `EONET unavailable (${res.error.kind}): ${res.error.message}`));
    }
    // EONET has NO bbox query parameter, so the whole open-event set is fetched and clipped HERE, by the
    // caller's bbox — an event outside the query area is never handed to the application labelled as
    // in-area. Clipping is a plain deterministic containment test, not a spatial approximation.
    const data = res.value.records.map((r) => r.entity).filter((h) => inBBox(h, query.bbox));
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(): Promise<readonly EonetEvent[]> {
    const json = await httpGetText(this.buildUrl(), { timeoutMs: this.config.timeoutMs });
    return parseEonetEvents(json).events;
  }

  private async loadMock(): Promise<readonly EonetEvent[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseEonetEvents(res.value).events;
  }

  /** EONET v3: /{base}?status=open&limit={n} (keyless; verified live 2026-08-08). */
  private buildUrl(): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    return `${base}?status=open&limit=${this.limit}`;
  }
}

/**
 * Inclusive point-in-bbox test over an EONET centroid. The ACL only ever emits `Point` geometry, and the
 * narrowing below is the enforcement rather than a cast: any other geometry kind is excluded from the
 * result instead of being coerced into a position (Art. XVI — no silent reinterpretation).
 */
function inBBox(hazard: HazardGeometry, bbox: readonly [number, number, number, number]): boolean {
  if (hazard.geometry.type !== 'Point') return false;
  const [lon, lat] = hazard.geometry.coordinates;
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/** Factory: resolve SOURCE_EONET_* config from env and construct the adapter. Fail-fast (CONFIG). */
export function makeEonetAdapter(engine: RedundancyEngine, env: Env = process.env): AdapterResult<EonetAdapter> {
  // Keyless by design — no `keyEnv`/`requireKeyForLive`, so LIVE mode can never fail for a missing secret.
  const cfg = resolveSourceConfig({ prefix: 'EONET', env, defaultMode: 'CACHED', defaultUrl: DEFAULT_BASE_URL });
  if (!cfg.ok) return cfg;
  return ok(new EonetAdapter({ engine, config: cfg.value }));
}
