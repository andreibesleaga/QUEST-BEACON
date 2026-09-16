// BEACON — NASA LANCE NRT flood adapter (S2·Lane-A2; adapter-contract §6, NewsIntelPort P6; Art. XVI).
// NASA's near-real-time OBSERVED flood-water product (MCDWD_L3_NRT) → canonical NewsItem availability
// advisories behind the shared redundancy ladder (live → last-known-good cache → recorded-mock → typed
// unavailable). Implements BOTH the framework SourceAdapterPort<NewsItem> AND the outward NewsIntelPort.
//
// SOURCE (live-verified 2026-08-08 with the project's real EARTHDATA_TOKEN, HTTP 200 — see
// lanceflood-acl.ts header for the exact request and recorded response):
//   `https://nrt3.modaps.eosdis.nasa.gov/api/v2/content/details/allData/61/MCDWD_L3_NRT/Recent`
//   `?fields=all&formats=json`, Bearer token in the `Authorization` header.
//
// AUTH: an Earthdata Login (EDL) download token is REQUIRED for the live rung — `EARTHDATA_TOKEN`, free
// via urs.earthdata.nasa.gov. The factory fail-fasts if LIVE is selected without it (adapter-contract §5),
// so a token-less deployment degrades to CACHED/MOCK rather than silently returning nothing.
//
// 🔴 WHAT THIS ADAPTER DOES AND DOES NOT CLAIM: it reports that NASA has published an observed-flood
// product for a tile/day, with the link and the freshness. It does NOT decode the raster and therefore
// emits NO flood geometry — see the binding rationale in lanceflood-acl.ts. Every NewsItem summary says
// so in words, so the limitation travels with the data instead of living only in a comment.
//
// SCOPING: the listing is global (2144 entries at probe), so `fetch(region)` selects only the granules
// whose 10°×10° tile overlaps the region's bbox, newest composite day first, capped at `maxItems`. That
// keeps one fetch's mapped output proportional to the region rather than to the planet.
//
// POLITENESS: no published rate limit for the NRT content API. Bounded output, a 6-hour cache TTL (the
// product is a DAILY composite — polling it faster buys nothing) and the shared circuit breaker.
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { NewsIntelPort, NewsItem } from '@/ports/intel.js';
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
import type { LanceTileGranule } from './lanceflood-acl.js';
import { lanceMapper, parseLanceGranules, tileIntersects } from './lanceflood-acl.js';

const ADAPTER_ID = 'lanceflood';
const SOURCE = 'NASA LANCE MODIS NRT flood (MCDWD_L3_NRT)';
// NASA open data with an attribution request — identical treatment to FIRMS/EONET so the ask stays
// visible in every provenance stamp (Art. XI).
const LICENSE = 'NASA open / attribution requested';
const DEFAULT_BASE_URL =
  'https://nrt3.modaps.eosdis.nasa.gov/api/v2/content/details/allData/61/MCDWD_L3_NRT/Recent';
const MOCK_FIXTURE = 'granules.json';
// Per-fetch cap on mapped advisories. A region rarely spans more than a handful of 10° tiles; this bounds
// the pathological case (a whole-world query) without truncating any realistic region.
const DEFAULT_MAX_ITEMS = 24;
// The whole-world region the outward NewsIntelPort fetches under (the port carries no bbox). One stable
// region id keeps the last-known-good cache single-keyed (same pattern as census/openfema/caphub).
const WORLD_REGION: Region = { id: 'lanceflood-world', bbox: [-180, -90, 180, 90] };

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 4, cooldownSec: 300, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 21600; // daily composite — a 6-hour TTL is generous, not stale

export interface LanceFloodAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly maxItems?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class LanceFloodAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id = ADAPTER_ID;
  // GLOBAL: the product's published coverage is 80°N–60°S, which the tile-overlap selection enforces
  // exactly — a region outside it simply selects zero tiles and the slice degrades honestly (Art. XVI),
  // rather than a hand-typed bbox pretending to be the product's true footprint.
  readonly coverage: Coverage = { kind: 'GLOBAL' };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly maxItems: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: LanceFloodAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.maxItems = deps.maxItems ?? DEFAULT_MAX_ITEMS;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped NewsItems. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<LanceTileGranule, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: lanceMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(region),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P6). `query` optionally filters the advisory set; empty = all. */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const res = await this.fetch(WORLD_REGION);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `LANCE flood unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const items = res.value.records.map((r) => r.entity);
    return domainOk({
      data: filterNews(items, query),
      freshness: makeFreshness(res.value.freshness),
    });
  }

  private async fetchLive(region: Region): Promise<readonly LanceTileGranule[]> {
    const json = await httpGetText(this.buildUrl(), {
      timeoutMs: this.config.timeoutMs,
      headers: { Authorization: `Bearer ${this.config.apiKey ?? ''}`, Accept: 'application/json' },
    });
    return this.select(parseLanceGranules(json).granules, region);
  }

  private async loadMock(region: Region): Promise<readonly LanceTileGranule[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return this.select(parseLanceGranules(res.value).granules, region);
  }

  /** Region-overlapping tiles only, NEWEST composite day first, capped — deterministic tie-break by tile. */
  private select(
    granules: readonly LanceTileGranule[],
    region: Region,
  ): readonly LanceTileGranule[] {
    return granules
      .filter((g) => tileIntersects(g.h, g.v, region.bbox))
      .slice()
      .sort((a, b) => b.dayIso.localeCompare(a.dayIso) || a.h - b.h || a.v - b.v)
      .slice(0, this.maxItems);
  }

  /** LANCE NRT content API: /{base}?fields=all&formats=json (Bearer EARTHDATA_TOKEN; verified live). */
  private buildUrl(): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    return `${base}?fields=all&formats=json`;
  }
}

/** Case-insensitive substring filter over title+summary; an empty/blank query returns all items. */
function filterNews(items: readonly NewsItem[], query: string): readonly NewsItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items.filter((i) => `${i.title} ${i.summary ?? ''}`.toLowerCase().includes(q));
}

/** Factory: resolve SOURCE_LANCEFLOOD_* config + EARTHDATA_TOKEN from env. Fail-fast (CONFIG). */
export function makeLanceFloodAdapter(
  engine: RedundancyEngine,
  env: Env = process.env,
): AdapterResult<LanceFloodAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'LANCEFLOOD',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'EARTHDATA_TOKEN',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return ok(new LanceFloodAdapter({ engine, config: cfg.value }));
}
