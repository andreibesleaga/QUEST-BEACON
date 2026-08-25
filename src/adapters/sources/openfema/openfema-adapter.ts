// BEACON — OpenFEMA adapter (S2·Lane-A2; adapter-contract §6, NewsIntelPort P6; Art. XVI). FEMA's open
// `DisasterDeclarationsSummaries` dataset → canonical NewsItem (official declaration notice) behind the
// shared redundancy ladder (live → last-known-good cache → recorded-mock → typed unavailable).
// Implements BOTH the framework SourceAdapterPort<NewsItem> AND the outward domain NewsIntelPort.
//
// SOURCE (live-verified 2026-08-08 by real curl, HTTP 200, KEYLESS — see openfema-acl.ts header for the
// recorded response): `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries`, OData-style query
// `$top` / `$orderby` / `$format`. US public domain. FEMA's published guidance is a 1000-record page cap
// and a request to page rather than bulk-scrape; the default `$top` below is far under it.
//
// VERSIONING (the trap this row exists to document, per DATA_SOURCE_VERIFICATION §7): OpenFEMA versions
// PER DATASET (v1/v2/v3 coexist) — there is NO API-wide v1 cutoff, and individual dataset v1's retire on
// their own dated schedules. The version is therefore part of the configurable endpoint (`SOURCE_OPENFEMA_URL`),
// not a constant buried in a URL builder, so a retirement is a config change and not a code change.
//
// SCOPE: US only (`coverage: COUNTRIES ['US']`) — a US federal declaration has no meaning elsewhere, and
// the COUNTRIES gate makes a non-US region skip this adapter rather than mislabel it (OP4).
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
import type { FemaDeclaration } from './openfema-acl.js';
import { femaMapper, parseFemaDeclarations } from './openfema-acl.js';

const ADAPTER_ID = 'openfema';
const SOURCE = 'OpenFEMA (FEMA Disaster Declarations)';
const LICENSE = 'US public domain';
const DEFAULT_BASE_URL = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries';
const MOCK_FIXTURE = 'declarations.json';
// Newest-first page size. FEMA's documented page cap is 1000; a COP needs the most recent declarations,
// and a small page also bounds one fetch's latency/host load.
const DEFAULT_TOP = 50;
// The whole-US region this adapter fetches under. OpenFEMA has no bbox parameter, so ONE stable region id
// keeps the last-known-good cache single-keyed regardless of which bbox the caller asks about (the same
// pattern as census's CA_COUNTIES_REGION).
const US_REGION: Region = { id: 'us-declarations', bbox: [-179.15, 18.91, -66.94, 71.39], iso: 'US' };

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// Declarations are published in batches over hours/days — a long TTL, like the other slow official feeds.
const DEFAULT_CACHE_TTL_SEC = 3600;

export interface OpenFemaAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly top?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class OpenFemaAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id = ADAPTER_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: ['US'] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly top: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: OpenFemaAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.top = deps.top ?? DEFAULT_TOP;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped NewsItems. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<FemaDeclaration, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: femaMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P6). `query` optionally filters the declaration set; empty = all. */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const res = await this.fetch(US_REGION);
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `OpenFEMA unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const items = res.value.records.map((r) => r.entity);
    return domainOk({ data: filterNews(items, query), freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(): Promise<readonly FemaDeclaration[]> {
    const json = await httpGetText(this.buildUrl(), {
      timeoutMs: this.config.timeoutMs,
      headers: { Accept: 'application/json' },
    });
    return parseFemaDeclarations(json).declarations;
  }

  private async loadMock(): Promise<readonly FemaDeclaration[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseFemaDeclarations(res.value).declarations;
  }

  /** OpenFEMA v2: /{base}?$top={n}&$orderby=declarationDate desc&$format=json (verified live). */
  private buildUrl(): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const query = `$top=${this.top}&$orderby=${encodeURIComponent('declarationDate desc')}&$format=json`;
    return `${base}?${query}`;
  }
}

/** Case-insensitive substring filter over title+summary; an empty/blank query returns all items. */
function filterNews(items: readonly NewsItem[], query: string): readonly NewsItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items.filter((i) => `${i.title} ${i.summary ?? ''}`.toLowerCase().includes(q));
}

/** Factory: resolve SOURCE_OPENFEMA_* config from env and construct the adapter. Fail-fast (CONFIG). */
export function makeOpenFemaAdapter(engine: RedundancyEngine, env: Env = process.env): AdapterResult<OpenFemaAdapter> {
  // Keyless by design — no `keyEnv`/`requireKeyForLive`, so LIVE can never fail for a missing secret.
  const cfg = resolveSourceConfig({ prefix: 'OPENFEMA', env, defaultMode: 'CACHED', defaultUrl: DEFAULT_BASE_URL });
  if (!cfg.ok) return cfg;
  return ok(new OpenFemaAdapter({ engine, config: cfg.value }));
}
