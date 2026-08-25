// BEACON — WorldPop adapter (E4·T-worldpop; adapter-contract §6, PopulationPort P12). WorldPop "stats"
// API (dataset=wpgppop, gridded modeled population) → canonical PopulationEstimate behind the shared
// redundancy ladder (live → last-known-good cache → recorded-mock → unavailable). Implements BOTH the
// framework SourceAdapterPort<PopulationEstimate> (fetch/health) AND the outward domain PopulationPort
// (estimatePopulation → Sourced), so the application depends only on the port, never on WorldPop internals.
//
// DATA_SOURCE_VERIFICATION.md (population row, ~line 85): free, CC BY 4.0, GLOBAL coverage, modeled
// population grids → verdict CACHED. WorldPop grids are MODELED, not measured/real-time, so the honest
// default is CACHED (Art. XVI — degradation is always labeled, never a dead-end). Config-driven:
// endpoint/mode/timeout from SOURCE_WORLDPOP_* env. No API key is required (keyless public stats API).
//
// VERIFIED LIVE (2026-07-15, curl against https://api.worldpop.org):
//   The documented/observed default behavior is ASYNC — a GET to the stats endpoint with a `geojson`
//   Polygon returns a task handle immediately, and the caller must poll `GET /v1/tasks/{taskid}` until
//   `status:"finished"`. Verified round-trip:
//     submit -> curl '.../v1/services/stats?dataset=wpgppop&year=2020&geojson=<Polygon>'
//            -> {"status":"created","taskid":"37be02d5-92ea-58da-9b5f-f3a8b090939f", ...}
//     poll   -> curl '.../v1/tasks/37be02d5-92ea-58da-9b5f-f3a8b090939f'
//            -> {"status":"finished","data":{"total_population":103437.78}, ...}
//   The API ALSO accepts (verified live) a `runasync=false` query param that runs the SAME job
//   synchronously in one HTTP round-trip:
//     curl '.../v1/services/stats?dataset=wpgppop&year=2020&runasync=false&geojson=<Butte-County-ish
//           Polygon [-121.9,39.4,-121.35,39.85]>'
//     -> {"status":"started","data":{"total_population":215182.79}, ...}   (recorded verbatim as the
//        MOCK_FIXTURE below — a real recorded live response, not hand-crafted)
//   The live rung below therefore uses `runasync=false` so `fetchLive` stays ONE resilient-http call
//   (adapter-contract §3.1 — no adapter-owned polling loop inside a single fetch); this is real observed
//   API behavior, documented here rather than guessed. The bbox is sent as a closed GeoJSON Polygon built
//   from the four corners of the queried Region.bbox (WGS-84).
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { BBox } from '@/domain/value-objects/geo.js';
import type { Sourced } from '@/ports/infra.js';
import type { PopulationPort, PopulationEstimate } from '@/ports/infrastructure-sources.js';
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
import type { WorldPopRaw } from './worldpop-acl.js';
import { worldPopMapper, parseWorldPopResponse } from './worldpop-acl.js';

const WORLDPOP_ID = 'worldpop';
const WORLDPOP_SOURCE = 'WorldPop';
const WORLDPOP_LICENSE = 'CC BY 4.0';
const DEFAULT_BASE_URL = 'https://api.worldpop.org/v1/services/stats';
const DEFAULT_DATASET = 'wpgppop';
const DEFAULT_YEAR = 2020;
const MOCK_FIXTURE = 'population.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// Modeled population grids change rarely (annual releases) — a much longer TTL than fast-moving hazards.
const DEFAULT_CACHE_TTL_SEC = 21600;

export interface WorldPopAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly dataset?: string;
  readonly year?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class WorldPopAdapter implements SourceAdapterPort<PopulationEstimate>, PopulationPort {
  readonly id = WORLDPOP_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // WorldPop grids cover every country
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly dataset: string;
  private readonly year: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: WorldPopAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.dataset = deps.dataset ?? DEFAULT_DATASET;
    this.year = deps.year ?? DEFAULT_YEAR;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning a provenance-stamped PopulationEstimate. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<PopulationEstimate>>> {
    return this.engine.run<WorldPopRaw, PopulationEstimate>({
      adapterId: this.id,
      source: WORLDPOP_SOURCE,
      license: WORLDPOP_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: worldPopMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(region),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P12). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async estimatePopulation(area: BBox): Promise<Result<Sourced<PopulationEstimate>, DomainError>> {
    const region: Region = { id: 'query', bbox: area };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `WorldPop unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const entity = res.value.records[0]?.entity;
    if (entity === undefined) {
      return domainErr(new DomainError('NOT_FOUND', 'WorldPop: no population estimate returned'));
    }
    return domainOk({ data: entity, freshness: makeFreshness(res.value.freshness) });
  }

  /** Live rung: WorldPop stats endpoint in synchronous mode (`runasync=false` — verified live, file header). */
  private async fetchLive(region: Region): Promise<readonly WorldPopRaw[]> {
    const text = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    const body = parseWorldPopResponse(text);
    return [{ ...body, bbox: region.bbox }];
  }

  /** Mock rung: the recorded fixture is the wire body only; the queried bbox is stitched on here. */
  private async loadMock(region: Region): Promise<readonly WorldPopRaw[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    const body = parseWorldPopResponse(res.value);
    return [{ ...body, bbox: region.bbox }];
  }

  /**
   * WorldPop stats endpoint: dataset + year + `runasync=false` + a closed GeoJSON Polygon built from the
   * queried bbox's four corners (WGS-84). The API does not accept a raw bbox param — geojson is required.
   */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const params = new URLSearchParams({
      dataset: this.dataset,
      year: String(this.year),
      runasync: 'false',
      geojson: JSON.stringify(bboxToPolygonGeoJson(region.bbox)),
    });
    return `${base}?${params.toString()}`;
  }
}

interface Polygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
}

/** [minLon,minLat,maxLon,maxLat] → a closed GeoJSON Polygon ring (5 points, WGS-84, deterministic). */
function bboxToPolygonGeoJson(bbox: BBox): Polygon {
  const [west, south, east, north] = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

/** Factory: resolve SOURCE_WORLDPOP_* config from env. Fail-fast on bad config. No API key required. */
export function makeWorldPopAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<WorldPopAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'WORLDPOP',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new WorldPopAdapter({ engine, config: cfg.value }) };
}
