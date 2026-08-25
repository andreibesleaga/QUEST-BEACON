// BEACON — FIRMS adapter (E4·T-146…T-152; FIRMS exemplar, adapter-contract §6, HazardSourcePort P1).
// NASA FIRMS active-fire CSV → canonical HazardGeometry (HOTSPOT) behind the shared redundancy ladder
// (live → last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<HazardGeometry> (fetch/health) AND the outward domain HazardSourcePort
// (fetchHazards → Sourced), so the application depends only on the port, never on FIRMS internals.
//
// Config-driven: endpoint/mode/key/timeout come from SOURCE_FIRMS_* env (MAP_KEY is FIRMS_MAP_KEY).
// Honest limitation: FIRMS = thermal hotspots, NOT fire perimeters (see firms-acl.ts).
import { fileURLToPath } from 'node:url';
import type { HazardGeometry, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { HazardSourcePort, AreaQuery } from '@/ports/data-sources.js';
import type {
  AdapterResult,
  BreakerConfig,
  Coverage,
  FetchResult,
  Region,
  RedundancyEngine,
  SourceAdapterPort,
  SourceConfig,
  SourceMode,
  AdapterHealth,
} from '@/adapters/_shared/index.js';
import { httpGetText, loadFixtureText, resolveSourceConfig } from '@/adapters/_shared/index.js';
import type { FirmsRow } from './firms-acl.js';
import { firmsMapper, parseFirmsCsv } from './firms-acl.js';

const FIRMS_ID = 'firms';
const FIRMS_SOURCE = 'NASA FIRMS';
// DATA_SOURCE_VERIFICATION §1: NASA FIRMS is open data but carries an attribution request (not bare
// public domain) — keep the attribution ask visible in provenance/NOTICE (Art. XI).
const FIRMS_LICENSE = 'NASA open / attribution requested';
const DEFAULT_BASE_URL = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const DEFAULT_SATELLITE = 'VIIRS_SNPP_NRT';
const DEFAULT_DAY_RANGE = 1;
const MOCK_FIXTURE = 'hotspots.csv';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface FirmsAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly satellite?: string;
  readonly dayRange?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

/**
 * Is a raw detection inside the region's bbox? Non-numeric coordinates are DROPPED rather than kept: a row
 * whose position cannot be established cannot be shown to belong to this region, and the mapper would
 * reject it moments later anyway (`firmsMapper` throws PARSE on a bad lat/lon).
 */
function rowWithinBbox(row: FirmsRow, bbox: Region['bbox']): boolean {
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const [west, south, east, north] = bbox;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

export class FirmsAdapter implements SourceAdapterPort<HazardGeometry>, HazardSourcePort {
  readonly id = FIRMS_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // satellite-derived: every country, no gaps
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly satellite: string;
  private readonly dayRange: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: FirmsAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.satellite = deps.satellite ?? DEFAULT_SATELLITE;
    this.dayRange = deps.dayRange ?? DEFAULT_DAY_RANGE;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped HazardGeometry. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<HazardGeometry>>> {
    return this.engine.run<FirmsRow, HazardGeometry>({
      adapterId: this.id,
      source: FIRMS_SOURCE,
      license: FIRMS_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: firmsMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(region),
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
      return domainErr(new DomainError('NOT_FOUND', `FIRMS unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly FirmsRow[]> {
    const csv = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    return parseFirmsCsv(csv);
  }

  /**
   * The offline rungs must answer the SAME QUESTION the live rung answers: "what is burning in THIS
   * region?" The live URL asks that literally — the bbox is in the path (`buildUrl`) — but the fixture is a
   * flat file of Californian detections, so an unfiltered mock rung answers a different question and hands
   * the caller another region's fires.
   *
   * That was invisible while firms was enabled only for `us-ca`, whose bbox contains every fixture row. It
   * stopped being invisible the moment firms became a per-region guarantee (every zone gets one always-live
   * wildfire source): Romania's map acquired hotspots at 38.9°N,-122.6°E — the Californian coast — labelled
   * as Romanian hazards. Wrong geography presented as fact is precisely the failure the provenance and
   * freshness machinery exists to prevent, and no amount of correct labelling redeems it.
   *
   * Filtering here rather than in the shared engine because only an adapter knows where its own entity
   * carries its coordinates; `RedundancyEngine` is generic over the raw row type and cannot look inside it.
   * A region that legitimately has no fixture detections now yields an HONEST EMPTY slice — which the COP
   * already renders as "no data for this region", never as a dead end (Art. XVI).
   */
  private async loadMock(region: Region): Promise<readonly FirmsRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseFirmsCsv(res.value).filter((row) => rowWithinBbox(row, region.bbox));
  }

  /** FIRMS area/csv endpoint: /{base}/{MAP_KEY}/{satellite}/{west,south,east,north}/{dayRange}. */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const key = this.config.apiKey ?? '';
    const [west, south, east, north] = region.bbox;
    return `${base}/${key}/${this.satellite}/${west},${south},${east},${north}/${this.dayRange}`;
  }
}

/** Factory: resolve SOURCE_FIRMS_* config from env and construct the adapter. Fail-fast on bad config. */
export function makeFirmsAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<FirmsAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'FIRMS',
    env,
    defaultMode: 'MOCK',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'FIRMS_MAP_KEY',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new FirmsAdapter({ engine, config: cfg.value }) };
}
