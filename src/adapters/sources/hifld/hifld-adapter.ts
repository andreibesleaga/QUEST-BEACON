// BEACON — HIFLD lifelines adapter (S2·Lane A3; adapter-contract §6, InfrastructurePort P4). HIFLD
// critical-infrastructure lifeline layers, served by FEMA Region 9's public ArcGIS FeatureServer, →
// canonical InfrastructureNode behind the shared redundancy ladder (live → last-known-good cache →
// recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<InfrastructureNode>
// (fetch/health) AND the outward domain InfrastructurePort (fetchNodes → Sourced).
//
// WHY: complements `osm-overpass` for US lifeline attributes OSM does not carry. Overpass can only give
// BEACON hospitals, power substations and communication masts from crowd tags; HIFLD adds NURSING HOMES,
// ELECTRIC POWER GENERATION PLANTS and NATIONAL SHELTER SYSTEM FACILITIES, which have no OSM equivalent
// worth trusting for exposure. DATA_SOURCE_VERIFICATION §4 "HIFLD (Next / archived)" row: free, US public
// domain, US-only, verdict CACHED.
//
// ⚠ WHAT IS AND IS NOT REACHABLE (verified live 2026-08-08 — full evidence in hifld-acl.ts header):
// the HIFLD Open portal is closed and the old `Hospitals_gdb` service is dead ("Invalid URL"); FEMA Region
// 9's public 2019 HIFLD lifeline package IS reachable and answers real bbox GeoJSON queries. This adapter
// uses that, and is honest about the consequence: the data is a **2019 static snapshot**, so its default
// mode is CACHED — not because the wire path is missing (it is implemented and keyless), but because
// calling a 2019 package "LIVE" would be a false freshness claim (Art. XVI: degradation is always labelled).
// `SOURCE_HIFLD_MODE=live` re-pulls from the service; the data behind it does not get any newer.
//
// Config-driven: mode/url/timeout from SOURCE_HIFLD_* env (12-factor; nothing hardcoded). Keyless.
import { fileURLToPath } from 'node:url';
import type { InfrastructureNode, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { InfrastructurePort } from '@/ports/infrastructure-sources.js';
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
import type { HifldLayer, HifldRaw } from './hifld-acl.js';
import { HIFLD_LAYERS, hifldMapper, parseHifldLayer } from './hifld-acl.js';

const HIFLD_ID = 'hifld';
const HIFLD_SOURCE = 'HIFLD lifelines (FEMA Region 9 public 2019 package)';
const HIFLD_LICENSE = 'US public domain (HIFLD / FEMA)';
const DEFAULT_BASE_URL =
  'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Critical_Infrastructure_Map_Service/FeatureServer';
const US_ISO = 'US';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// A 2019 static package: the last-known-good window can be long without ever hiding a fresher value.
const DEFAULT_CACHE_TTL_SEC = 86400;
// Bounded per-layer page size. HIFLD layers are national, so an unbounded bbox query could return tens of
// thousands of features; a cap keeps one fetch predictable and is stated rather than discovered later.
const DEFAULT_MAX_FEATURES_PER_LAYER = 200;

export interface HifldAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly layers?: readonly HifldLayer[];
  readonly maxFeaturesPerLayer?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class HifldAdapter implements SourceAdapterPort<InfrastructureNode>, InfrastructurePort {
  // HIFLD is a US homeland-infrastructure programme: national coverage, never derived from the query bbox.
  readonly id = HIFLD_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: [US_ISO] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly layers: readonly HifldLayer[];
  private readonly maxFeaturesPerLayer: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: HifldAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.layers = deps.layers ?? HIFLD_LAYERS;
    this.maxFeaturesPerLayer = deps.maxFeaturesPerLayer ?? DEFAULT_MAX_FEATURES_PER_LAYER;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped InfrastructureNodes. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<InfrastructureNode>>> {
    return this.engine.run<HifldRaw, InfrastructureNode>({
      adapterId: this.id,
      source: HIFLD_SOURCE,
      license: HIFLD_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: hifldMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P4). HIFLD's coverage is unconditionally national — see the coverage note above. */
  async fetchNodes(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly InfrastructureNode[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox, iso: US_ISO });
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `HIFLD unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  /**
   * One ArcGIS layer = one asset class = one GET, so a five-class fetch is five bounded, sequential
   * requests — NOT a polling loop (adapter-contract §3.1). They run in sequence rather than in parallel to
   * stay a polite client of a shared public FEMA service. A layer that fails throws, and the whole fetch
   * degrades to cache/mock: a partial infrastructure picture silently missing hospitals would be worse than
   * a labelled degraded one (Art. XVI).
   */
  private async fetchLive(region: Region): Promise<readonly HifldRaw[]> {
    const rows: HifldRaw[] = [];
    for (const layer of this.layers) {
      const text = await httpGetText(this.buildUrl(layer, region), {
        timeoutMs: this.config.timeoutMs,
      });
      rows.push(...parseHifldLayer(text, layer).rows);
    }
    return rows;
  }

  /** Mock rung: one recorded body per layer, mirroring the live rung's one-GET-per-layer shape exactly. */
  private async loadMock(): Promise<readonly HifldRaw[]> {
    const rows: HifldRaw[] = [];
    for (const layer of this.layers) {
      const res = await loadFixtureText(this.fixturesDir, `lifelines-${layer.layerId}.geojson`);
      if (!res.ok) throw res.error;
      rows.push(...parseHifldLayer(res.value, layer).rows);
    }
    return rows;
  }

  /** ArcGIS FeatureServer bbox query: /{base}/{layer}/query?geometry=…&geometryType=esriGeometryEnvelope. */
  private buildUrl(layer: HifldLayer, region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    const params = new URLSearchParams({
      where: '1=1',
      geometry: `${west},${south},${east},${north}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      outSR: '4326', // ask for WGS-84 back; the service's native SR is Web Mercator
      f: 'geojson',
      resultRecordCount: String(this.maxFeaturesPerLayer),
    });
    return `${base}/${layer.layerId}/query?${params.toString()}`;
  }
}

/**
 * Factory: resolve SOURCE_HIFLD_* config from env. Keyless — the FEMA Region 9 service is public, so there
 * is deliberately no `keyEnv`/`requireKeyForLive`. defaultMode CACHED because the reachable data is a 2019
 * static package (module header), not because the live rung is missing.
 */
export function makeHifldAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<HifldAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'HIFLD',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    // Five sequential ArcGIS layer queries; each one gets this budget, so keep it above the 8 s shared
    // default — ArcGIS spatial queries on national layers are routinely slower than a flat file GET.
    defaultTimeoutMs: 15000,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new HifldAdapter({ engine, config: cfg.value }) };
}
