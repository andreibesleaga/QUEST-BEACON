// BEACON — NIFC/WFIGS adapter (E4·T-17x; adapter-contract §6, HazardSourcePort P1, DATA_SOURCE_VERIFICATION
// §1). Official interagency fire PERIMETERS (WFIGS_Interagency_Perimeters_Current, ArcGIS REST/GeoJSON) →
// canonical HazardGeometry (kind PERIMETER) behind the shared redundancy ladder (live → last-known-good
// cache → recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<HazardGeometry>
// (fetch/health) AND the outward domain HazardSourcePort (fetchHazards → Sourced), so the application
// depends only on the port, never on ArcGIS/NIFC internals.
//
// Config-driven: endpoint/mode/timeout come from SOURCE_NIFC_* env. Keyless public endpoint — no API key.
// Coverage is US-only (unlike FIRMS/GDACS's GLOBAL): NIFC/WFIGS is the US interagency perimeter system.
// defaultMode is CACHED (not LIVE/MOCK) — a rate/kindness default toward the shared ArcGIS Hub service;
// an operator opts into LIVE explicitly via SOURCE_NIFC_MODE.
// Honest limitation: NIFC/WFIGS perimeters lag active fire growth (poly_DateCurrent may be hours/days
// stale) — this closes the "FIRMS ≠ perimeters" gap but is itself not real-time (see nifc-acl.ts).
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
import type { NifcFeature } from './nifc-acl.js';
import { nifcMapper, parseNifcFeatures } from './nifc-acl.js';

const NIFC_ID = 'nifc';
const NIFC_SOURCE = 'NIFC/WFIGS';
// DATA_SOURCE_VERIFICATION §1: NIFC row — "Free / US public domain". Bare public domain (no attribution
// ask), unlike FIRMS.
const NIFC_LICENSE = 'US public domain (NIFC/WFIGS)';
const DEFAULT_BASE_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';
const DEFAULT_RESULT_RECORD_COUNT = 10;
const MOCK_FIXTURE = 'perimeters.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface NifcAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly resultRecordCount?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class NifcAdapter implements SourceAdapterPort<HazardGeometry>, HazardSourcePort {
  readonly id = NIFC_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: ['US'] }; // WFIGS interagency perimeters: US only
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly resultRecordCount: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: NifcAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.resultRecordCount = deps.resultRecordCount ?? DEFAULT_RESULT_RECORD_COUNT;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped HazardGeometry. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<HazardGeometry>>> {
    return this.engine.run<NifcFeature, HazardGeometry>({
      adapterId: this.id,
      source: NIFC_SOURCE,
      license: NIFC_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: nifcMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P1). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchHazards(query: AreaQuery): Promise<Result<Sourced<readonly HazardGeometry[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox, iso: 'US' };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `NIFC unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly NifcFeature[]> {
    const json = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    // Malformed features are skipped+counted at parse (never abort the whole fetch over one bad geometry).
    const parsed = parseNifcFeatures(json);
    if (parsed.skipped > 0) {
      console.warn(`nifc: skipped ${parsed.skipped} malformed feature(s) from live response`);
    }
    return parsed.features;
  }

  private async loadMock(): Promise<readonly NifcFeature[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseNifcFeatures(res.value).features;
  }

  /** WFIGS ArcGIS REST query: envelope geometry filter over the region bbox, GeoJSON output. */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'poly_IncidentName,poly_DateCurrent',
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

/** Factory: resolve SOURCE_NIFC_* config from env and construct the adapter. Fail-fast on bad config. */
export function makeNifcAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<NifcAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'NIFC',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new NifcAdapter({ engine, config: cfg.value }) };
}
