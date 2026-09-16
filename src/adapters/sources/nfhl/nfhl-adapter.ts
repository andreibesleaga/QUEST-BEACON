// BEACON — NFHL adapter (E4, NFHL exemplar; adapter-contract §6). FEMA National Flood Hazard Layer
// (NFHL) MapServer flood-zone query → canonical FloodZone behind the shared redundancy ladder (live →
// last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<FloodZone> (fetch/health) AND the outward FloodZonePort (fetchZones → Sourced), so
// the application depends only on the port, never on NFHL/Esri internals.
//
// DATA_SOURCE_VERIFICATION §row "FEMA NFHL": verified tier CACHED — confirmed live 2026-06-29
// (JSON/GeoJSON queries), but the MapServer is SLOW UNDER LOAD, so this adapter defaults to CACHED
// (nightly cache to DB), not LIVE, unlike FIRMS/GDACS. Config-driven: endpoint/mode/timeout come from
// SOURCE_NFHL_* env (keyless — NFHL is open US public-domain data, no API key).
//
// Endpoint: layer 28 of the public NFHL MapServer is the effective Flood Hazard Zone polygon layer (the
// FLD_ZONE attribute this adapter reads). This session's sandbox has no outbound network access, so the
// live shape could not be re-verified against a fresh response; the query params below follow the Esri
// MapServer `query` REST spec and DATA_SOURCE_VERIFICATION's confirmed base URL — re-verify layer index
// against a live response before flipping SOURCE_NFHL_MODE=LIVE in an environment with egress.
import { fileURLToPath } from 'node:url';
import type { FloodZone, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
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
import type { NfhlZoneRow } from './nfhl-acl.js';
import { nfhlMapper, parseNfhlZones } from './nfhl-acl.js';

const NFHL_ID = 'nfhl';
const NFHL_SOURCE = 'FEMA NFHL';
const NFHL_LICENSE = 'US public domain (FEMA)';
const DEFAULT_BASE_URL =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const DEFAULT_RESULT_RECORD_COUNT = 5; // small, bounded page — MapServer is slow under load (DSV)
const MOCK_FIXTURE = 'zones.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

/**
 * Outward port for flood-zone source adapters. There is no existing P-port for regulatory flood zones
 * (the P1 HazardSourcePort covers observed HazardGeometry only) — this local port mirrors that shape/
 * contract (adapter-contract §1): a Sourced envelope, never a raw throw, so the application can depend
 * on this port without knowing NFHL exists.
 */
export interface FloodZonePort {
  fetchZones(query: AreaQuery): Promise<Result<Sourced<readonly FloodZone[]>, DomainError>>;
}

export interface NfhlAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  readonly resultRecordCount?: number;
}

export class NfhlAdapter implements SourceAdapterPort<FloodZone>, FloodZonePort {
  readonly id = NFHL_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: ['US'] }; // NFHL only maps US floodplains
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly resultRecordCount: number;

  constructor(deps: NfhlAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.resultRecordCount = deps.resultRecordCount ?? DEFAULT_RESULT_RECORD_COUNT;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped FloodZone rows. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<FloodZone>>> {
    return this.engine.run<NfhlZoneRow, FloodZone>({
      adapterId: this.id,
      source: NFHL_SOURCE,
      license: NFHL_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: nfhlMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (local FloodZonePort). Adapts a FetchResult to the Sourced envelope. */
  async fetchZones(query: AreaQuery): Promise<Result<Sourced<readonly FloodZone[]>, DomainError>> {
    // AreaQuery carries no iso; NFHL is US-only (coverage COUNTRIES[US]), so it is supplied here rather
    // than left for the caller to know about (mirrors nifc-adapter's fetchHazards, the other COUNTRIES[US]
    // outward-port exemplar).
    const res = await this.fetch({ id: 'query', bbox: query.bbox, iso: 'US' });
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `NFHL unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly NfhlZoneRow[]> {
    const json = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    return parseNfhlZones(json).rows;
  }

  private async loadMock(): Promise<readonly NfhlZoneRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseNfhlZones(res.value).rows;
  }

  /** NFHL MapServer layer-28 query: envelope geometry filter, FLD_ZONE only, GeoJSON output. */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    const params = new URLSearchParams({
      where: '1=1',
      geometry: `${west},${south},${east},${north}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outFields: 'FLD_ZONE',
      f: 'geojson',
      resultRecordCount: String(this.resultRecordCount),
    });
    return `${base}?${params.toString()}`;
  }
}

/** Factory: resolve SOURCE_NFHL_* config from env. Fail-fast (CONFIG) on a bad mode. Keyless — no API key. */
export function makeNfhlAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<NfhlAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'NFHL',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new NfhlAdapter({ engine, config: cfg.value }) };
}
