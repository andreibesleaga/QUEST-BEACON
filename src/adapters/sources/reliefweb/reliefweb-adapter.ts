// BEACON — ReliefWeb adapter (E4·T-189; adapter-contract §6, NewsIntelPort P6). UN OCHA ReliefWeb v2
// `/reports` search -> canonical NewsItem behind the shared redundancy ladder (live -> last-known-good
// cache -> recorded-mock -> typed unavailable). Implements BOTH the framework SourceAdapterPort<NewsItem>
// AND the outward NewsIntelPort, so the application depends only on the port, never on ReliefWeb internals.
//
// DATA_SOURCE_VERIFICATION §5 (2026-06-29): v1 is 410 Gone -- **v2 only**. Since 2025-11-01 `appname` must
// be a PRE-APPROVED/registered name (RELIEFWEB_APPNAME) -- LIVE mode fails fast (CONFIG) without one
// (config-gated live, adapter-contract §5). Config-driven: mode/url/timeout/appname from
// SOURCE_RELIEFWEB_* + RELIEFWEB_APPNAME env; default URL overridable via SOURCE_RELIEFWEB_URL.
// Default mode **CACHED** (task brief): ReliefWeb is a verified LIVE-capable source, but appname approval
// is an external gate outside this repo's control, so an un-registered deployment still serves a usable
// (degraded, last-known-good/mock) COP out of the box; a deployment with an approved appname flips to LIVE.
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
import type { ReliefWebRow } from './reliefweb-acl.js';
import { parseReliefWeb, reliefWebMapper } from './reliefweb-acl.js';

const ADAPTER_ID = 'reliefweb';
const SOURCE = 'UN OCHA ReliefWeb';
const LICENSE = 'UN OCHA terms (attribution)';
const DEFAULT_BASE_URL = 'https://api.reliefweb.int/v2/reports';
const MOCK_FIXTURE = 'reports.json';
const DEFAULT_LIMIT = 20;
const DEFAULT_QUERY = ''; // framework fetch() (no query context): list the latest reports, unfiltered

// GLOBAL humanitarian coverage (DATA_SOURCE_VERIFICATION §5) -- ReliefWeb has no bbox concept; `region`
// only matters for the coverage gate (GLOBAL always passes) and the shared last-known-good cache key.
const GLOBAL_REGION: Region = { id: 'global', bbox: [-180, -90, 180, 90] };

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface ReliefWebAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class ReliefWebAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id = ADAPTER_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: ReliefWebAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped NewsItems. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.run(region, DEFAULT_QUERY);
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /**
   * Outward domain port (P6). `query` is threaded straight to the upstream `query[value]` search param
   * (ReliefWeb is search-based, unlike the MeteoAlarm-RO exemplar's single feed-pull) -- an empty query
   * lists the latest reports.
   *
   * Honest limitation: the shared last-known-good cache is keyed by region id, not by query text (the
   * shared RedundancyEngine has no query dimension), so distinct queries share one cache slot in CACHED/
   * degraded-LIVE mode. The MeteoAlarm-RO exemplar makes the same simplification the opposite way (one
   * feed pull, client-side filtering) -- both are honest about serving a "recent reports" slice, not a
   * query-partitioned cache.
   */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const res = await this.run(GLOBAL_REGION, query);
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `ReliefWeb unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private run(region: Region, query: string): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<ReliefWebRow, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: reliefWebMapper,
      fetchLive: () => this.fetchLive(query),
      loadMockRaw: () => this.loadMock(),
    });
  }

  private async fetchLive(query: string): Promise<readonly ReliefWebRow[]> {
    const text = await httpGetText(this.buildUrl(query), { timeoutMs: this.config.timeoutMs });
    return parseReliefWeb(text).rows;
  }

  private async loadMock(): Promise<readonly ReliefWebRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseReliefWeb(res.value).rows;
  }

  /** v2 `/reports` search: appname (registered) + optional query[value] + limit + profile=list. */
  private buildUrl(query: string): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const appname = this.config.apiKey ?? '';
    const params = new URLSearchParams();
    params.set('appname', appname);
    if (query.trim() !== '') params.set('query[value]', query.trim());
    params.set('limit', String(DEFAULT_LIMIT));
    params.set('profile', 'list');
    return `${base}?${params.toString()}`;
  }
}

/**
 * Factory: resolve SOURCE_RELIEFWEB_* config from env. Fail-fast (CONFIG) when LIVE mode is requested
 * without RELIEFWEB_APPNAME (registered-appname gate, DATA_SOURCE_VERIFICATION §5).
 */
export function makeReliefWebAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<ReliefWebAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'RELIEFWEB',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'RELIEFWEB_APPNAME',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new ReliefWebAdapter({ engine, config: cfg.value }) };
}
