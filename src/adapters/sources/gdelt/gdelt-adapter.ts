// BEACON — GDELT adapter (E4·T-157; adapter-contract §6, NewsIntelPort P6). GDELT DOC 2.0 ArtList JSON ->
// canonical NewsItem behind the shared redundancy ladder (live -> last-known-good cache -> recorded-mock ->
// typed unavailable). Implements BOTH the framework SourceAdapterPort<NewsItem> (fetch/health) AND the
// outward domain NewsIntelPort (fetchNews -> Sourced), so the application depends only on the port, never
// on GDELT internals.
//
// DATA_SOURCE_VERIFICATION §5/§10.4: verified tier LIVE, keyless, global, open, ~15-min updates, throttles
// (429) on rapid poll — the engine's circuit breaker + bounded retry/backoff absorb that (adapter-contract
// §3.1.2); a sustained outage degrades to the recorded mock, never a dead-end (Art. XVI).
// Config-driven: mode/url/timeout come from SOURCE_GDELT_* env (keyless — no API key required).
import { fileURLToPath } from 'node:url';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Result } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { NewsIntelPort, NewsItem } from '@/ports/intel.js';
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
import type { GdeltArticle } from './gdelt-acl.js';
import { gdeltMapper, parseGdeltResponse } from './gdelt-acl.js';

const ADAPTER_ID = 'gdelt';
const SOURCE = 'GDELT Project';
const LICENSE = 'GDELT open';
const DEFAULT_BASE_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const DEFAULT_MAX_RECORDS = 25;
const MOCK_FIXTURE = 'articles.json';
// A blank outward query still needs a non-empty GDELT search term; this is a broad emergency-relevant
// default, not a hardcoded region/endpoint (12-factor: url/mode/timeout remain fully env-driven).
const DEFAULT_QUERY = 'wildfire OR flood OR disaster';
// GDELT is GLOBAL coverage with no bbox/country gate; `region.id` here carries the free-text search
// query (the actual upstream parameter), not a geographic filter — mirrors how FIRMS uses region.bbox.
const GLOBAL_BBOX: readonly [number, number, number, number] = [-180, -90, 180, 90];

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface GdeltAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly maxRecords?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class GdeltAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id = ADAPTER_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // GDELT indexes global open-web news, no gaps
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly maxRecords: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: GdeltAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.maxRecords = deps.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped NewsItems. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<GdeltArticle, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: gdeltMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P6). `query` is the GDELT DOC 2.0 search term; blank falls back to DEFAULT_QUERY. */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const region: Region = { id: query.trim() || DEFAULT_QUERY, bbox: GLOBAL_BBOX };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `GDELT unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly GdeltArticle[]> {
    const text = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    return parseGdeltResponse(text).articles;
  }

  private async loadMock(): Promise<readonly GdeltArticle[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseGdeltResponse(res.value).articles;
  }

  /** GDELT DOC 2.0 ArtList endpoint: ?query=<free text>&mode=ArtList&format=json&maxrecords=<n>. */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const query = encodeURIComponent(region.id);
    return `${base}?query=${query}&mode=ArtList&format=json&maxrecords=${this.maxRecords}`;
  }
}

/** Factory: resolve SOURCE_GDELT_* config from env and construct the adapter. Fail-fast on bad config. */
export function makeGdeltAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<GdeltAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'GDELT',
    env,
    defaultMode: 'LIVE', // keyless — safe to default LIVE (F5 degrades to mock on outage/throttle)
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new GdeltAdapter({ engine, config: cfg.value }) };
}
