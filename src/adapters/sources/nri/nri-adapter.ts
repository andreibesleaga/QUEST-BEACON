// BEACON — FEMA National Risk Index adapter (S2·Lane-A2; adapter-contract §6, PopulationPort P12;
// Art. XVI). FEMA's NRI county table → canonical PopulationEstimate behind the shared redundancy ladder
// (live → last-known-good cache → recorded-mock → typed unavailable). Implements BOTH the framework
// SourceAdapterPort<PopulationEstimate> AND the outward domain PopulationPort.
//
// SOURCE (live-verified 2026-08-08 by real curl, HTTP 200, KEYLESS — see nri-acl.ts header for the exact
// request and recorded response): FEMA's published ArcGIS FeatureServer
// `https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/
//  FeatureServer/0/query` (layer `NRI_Counties_Prod`, `maxRecordCount` 2000, formats JSON/geoJSON/PBF).
// US public domain. Server-side envelope filtering means one fetch returns only the counties that
// actually intersect the region — no client-side scan of 3143 counties.
//
// 🔴 SCOPE NOTE (repeated here on purpose): this adapter emits the NRI table's VERBATIM 2020-Census
// `POPULATION` column, on the Population port. It does NOT emit NRI risk indices — BEACON has no
// risk-context port, and an unrouted claim is worse than an absent one. The full rationale, and what a
// future risk layer would need, is in nri-acl.ts.
//
// WHY CACHED BY DEFAULT: the NRI is a periodically-released baseline table (annual-ish), not a live
// feed. CACHED with a 6-hour TTL is the honest default; LIVE is a keyless one-env-var flip.
import { fileURLToPath } from 'node:url';
import type { BBox, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { PopulationEstimate, PopulationPort } from '@/ports/infrastructure-sources.js';
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
import type { NriFeature } from './nri-acl.js';
import { bboxCenter, nriMapper, parseNriCounties, pointInBBox } from './nri-acl.js';

const ADAPTER_ID = 'nri';
const SOURCE = 'FEMA National Risk Index (county table)';
const LICENSE = 'US public domain';
const DEFAULT_BASE_URL =
  'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query';
const MOCK_FIXTURE = 'counties.json';
// The attribute set requested. Population/identity fields are EMITTED; the risk fields are parsed and
// preserved for the documented future risk-context layer (see nri-acl.ts) but are not mapped today.
const OUT_FIELDS =
  'NRI_ID,STATE,STATEABBRV,COUNTY,COUNTYTYPE,STCOFIPS,POPULATION,BUILDVALUE,RISK_SCORE,RISK_RATNG,WFIR_RISKS,WFIR_RISKR';
// Well under the layer's published `maxRecordCount` of 2000 — no realistic region has this many counties.
const DEFAULT_MAX_COUNTIES = 500;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 21600; // baseline table, not a live feed

export interface NriAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly maxCounties?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class NriAdapter implements SourceAdapterPort<PopulationEstimate>, PopulationPort {
  readonly id = ADAPTER_ID;
  // The NRI covers US states, DC, and the US territories — a US-only table, so a non-US region gets an
  // honest NOT_COVERED rather than an empty-but-labelled slice (OP4).
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: ['US'] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly maxCounties: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: NriAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.maxCounties = deps.maxCounties ?? DEFAULT_MAX_COUNTIES;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning per-county PopulationEstimates. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<PopulationEstimate>>> {
    return this.engine.run<NriFeature, PopulationEstimate>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: nriMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /**
   * Outward domain port (P12). Sums the WHOLE-COUNTY populations of the counties whose centroid falls
   * inside `area` — the identical, already-reviewed semantic `census` uses. It is a county-granularity
   * envelope figure, NOT a clipped per-bbox population, and it is labelled as such wherever it surfaces.
   */
  async estimatePopulation(area: BBox): Promise<Result<Sourced<PopulationEstimate>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: area, iso: 'US' });
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `FEMA NRI unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const count = res.value.records
      .filter((r) => pointInBBox(bboxCenter(r.entity.area), area))
      .reduce((sum, r) => sum + r.entity.count, 0);
    return domainOk({ data: { area, count }, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly NriFeature[]> {
    const json = await httpGetText(this.buildUrl(region), {
      timeoutMs: this.config.timeoutMs,
      headers: { Accept: 'application/json' },
    });
    return parseNriCounties(json).features;
  }

  private async loadMock(): Promise<readonly NriFeature[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseNriCounties(res.value).features;
  }

  /** ArcGIS FeatureServer query: envelope-intersects, centroid-only, WGS-84 out (verified live). */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    const params = new URLSearchParams({
      where: '1=1',
      outFields: OUT_FIELDS,
      geometry: `${west},${south},${east},${north}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      returnGeometry: 'false',
      returnCentroid: 'true',
      outSR: '4326',
      resultRecordCount: String(this.maxCounties),
      f: 'json',
    });
    return `${base}?${params.toString()}`;
  }
}

/** Factory: resolve SOURCE_NRI_* config from env and construct the adapter. Fail-fast (CONFIG). */
export function makeNriAdapter(engine: RedundancyEngine, env: Env = process.env): AdapterResult<NriAdapter> {
  // Keyless by design — no `keyEnv`/`requireKeyForLive`, so LIVE can never fail for a missing secret.
  const cfg = resolveSourceConfig({ prefix: 'NRI', env, defaultMode: 'CACHED', defaultUrl: DEFAULT_BASE_URL });
  if (!cfg.ok) return cfg;
  return ok(new NriAdapter({ engine, config: cfg.value }));
}
