// BEACON — OSM Overpass adapter (E4·osm-overpass; adapter-contract §6, InfrastructurePort P4). This is
// the FIRST implementation of InfrastructurePort: Overpass API node elements (hospitals, fire stations,
// power substations, communication masts) -> canonical InfrastructureNode behind the shared redundancy
// ladder (live -> last-known-good cache -> recorded-mock -> unavailable). Implements BOTH the framework
// SourceAdapterPort<InfrastructureNode> (fetch/health) AND the outward domain InfrastructurePort
// (fetchNodes -> Sourced), so the application depends only on the port, never on Overpass internals.
//
// DATA_SOURCE_VERIFICATION §4 (OSM Overpass row): free but RATE-LIMITED public instances, GLOBAL
// coverage, ODbL (attribution required) -> defaultMode is CACHED (not LIVE/MOCK like FIRMS/GDACS): the
// upstream is live-capable but must be cached aggressively rather than hit on every request. Config-driven:
// endpoint/mode/timeout from SOURCE_OSM_OVERPASS_* env (prefix OSM_OVERPASS); no API key required
// (Overpass is keyless).
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
  Region,
  RedundancyEngine,
  SourceAdapterPort,
  SourceConfig,
  SourceMode,
} from '@/adapters/_shared/index.js';
import { httpGetText, loadFixtureText, resolveSourceConfig } from '@/adapters/_shared/index.js';
import type { OsmOverpassElement } from './osm-overpass-acl.js';
import { osmOverpassMapper, parseOverpassElements } from './osm-overpass-acl.js';

const OSM_ID = 'osm-overpass';
const OSM_SOURCE = 'OSM Overpass';
// ODbL requires attribution + share-alike (DATA_SOURCE_VERIFICATION §4). This exact string is stamped
// into every SourceRecord.license this adapter produces, so the ODbL attribution ask stays visible
// wherever provenance is rendered (UI/NOTICE), never buried.
const OSM_LICENSE = '© OpenStreetMap contributors (ODbL)';
const DEFAULT_BASE_URL = 'https://overpass-api.de/api/interpreter';
const MOCK_FIXTURE = 'elements.json';
const QUERY_TIMEOUT_SEC = 25;

// Node-only filters (lean demo). Each is a defensible, documented tag set (see osm-overpass-acl.ts header
// for the reasoning behind exactly these four types + why fire_station is fetched but not mapped):
//   amenity=hospital                          -> candidate HOSPITAL
//   amenity=fire_station                       -> fetched for coverage awareness; ACL skips it (no honest type)
//   power=substation                           -> candidate POWER
//   man_made=mast + tower:type=communication   -> candidate CELL (explicit comms tower)
//   man_made=mast + any "communication" key    -> candidate CELL (OSM wiki Key:communication convention)
const NODE_FILTERS = [
  '["amenity"="hospital"]',
  '["amenity"="fire_station"]',
  '["power"="substation"]',
  '["man_made"="mast"]["tower:type"="communication"]',
  '["man_made"="mast"]["communication"]',
] as const;

/** Build the Overpass QL body for a bbox. Overpass bbox order is (south,west,north,east) — NOT the
 * domain BBox order [minLon,minLat,maxLon,maxLat] — so the axes are swapped here, once, in one place. */
export function buildOverpassQuery(bbox: Region['bbox']): string {
  const [west, south, east, north] = bbox;
  const bboxStr = `${south},${west},${north},${east}`;
  const clauses = NODE_FILTERS.map((filter) => `node${filter}(${bboxStr});`).join('');
  return `[out:json][timeout:${QUERY_TIMEOUT_SEC}];(${clauses});out body;`;
}

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// Rate-limited upstream (DATA_SOURCE_VERIFICATION §4) -> cache aggressively; longer TTL than FIRMS/GDACS.
const DEFAULT_CACHE_TTL_SEC = 3600;

export interface OsmOverpassAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class OsmOverpassAdapter implements SourceAdapterPort<InfrastructureNode>, InfrastructurePort {
  readonly id = OSM_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // public Overpass instances mirror the whole OSM planet
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: OsmOverpassAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped InfrastructureNode. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<InfrastructureNode>>> {
    return this.engine.run<OsmOverpassElement, InfrastructureNode>({
      adapterId: this.id,
      source: OSM_SOURCE,
      license: OSM_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: osmOverpassMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P4). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchNodes(query: AreaQuery): Promise<Result<Sourced<readonly InfrastructureNode[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `OSM Overpass unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly OsmOverpassElement[]> {
    const json = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    return parseOverpassElements(json);
  }

  private async loadMock(): Promise<readonly OsmOverpassElement[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseOverpassElements(res.value);
  }

  /** GET {base}?data=<urlencoded Overpass QL>. */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    return `${base}?data=${encodeURIComponent(buildOverpassQuery(region.bbox))}`;
  }
}

/** Factory: resolve SOURCE_OSM_OVERPASS_* config from env and construct the adapter. Fail-fast on bad config.
 * defaultMode CACHED (never LIVE/MOCK by default) — rate-limited upstream, cache aggressively (Art. XVI). */
export function makeOsmOverpassAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<OsmOverpassAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'OSM_OVERPASS',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new OsmOverpassAdapter({ engine, config: cfg.value }) };
}
