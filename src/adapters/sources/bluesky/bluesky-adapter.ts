// BEACON — Bluesky vetted-social adapter (E4·T-179; adapter-contract §6, NewsIntelPort P6, Art. XIV).
// Bluesky public AppView post search → canonical NewsItem behind the shared redundancy ladder (live →
// last-known-good cache → recorded-mock → typed unavailable). Implements BOTH the framework
// SourceAdapterPort<NewsItem> (fetch/health) AND the outward NewsIntelPort, so the application depends
// only on the port, never on Bluesky internals.
//
// CORROBORATION-ONLY POSTURE (DATA_SOURCE_VERIFICATION §10 Bluesky row, CONSTITUTION Art. XIV): the AT
// Protocol post search (`app.bsky.feed.searchPosts`) is ToS-permitted — unlike X/Twitter (EXCLUDED by ToS
// policy, AGENTS.md §6/§14), Bluesky publishes an open API for exactly this use. Default mode is MOCK
// (a vetted-social source is never trusted-by-default; every mapped item is a fixed low-trust floor, never
// merged as fact — see bluesky-acl.ts).
//
// LIVE IS NOW AUTHENTICATED — BYO-ACCOUNT (S2·Lane-A1; plan §0 decision 10): the keyless public AppView
// began 403-ing `searchPosts` from datacenter IPs, so `SOURCE_BLUESKY_MODE=live` REQUIRES
// `BLUESKY_IDENTIFIER` + `BLUESKY_APP_PASSWORD` and fails fast (CONFIG) without both — the same shape
// `resolveSourceConfig({requireKeyForLive})` produces for FIRMS, done explicitly here only because the
// resolver carries a single `keyEnv` and this rung needs two vars. With credentials the adapter talks to
// the operator's PDS through BlueskySessionClient (session create → refresh → re-create; see
// bluesky-session.ts); without them it stays on the keyless public AppView, which MOCK/CACHED never call.
// The demo's LIVE social source is `mastodon` (keyless) — this rung exists for whoever brings an account.
//
// Config-driven: mode/url/timeout from SOURCE_BLUESKY_* env. `Region.id` is repurposed as the Bluesky
// search query term (coverage is GLOBAL — Bluesky search has no geographic scoping, so a bbox would be a
// fiction; the outward `fetchNews(query)` is the natural query entry point and forwards `query` as
// `region.id` into the same `fetch(region)` ladder the framework port uses).
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
import { httpGetText, loadFixtureText, makeAdapterError, err, resolveSourceConfig } from '@/adapters/_shared/index.js';
import type { BlueskyPost } from './bluesky-acl.js';
import { blueskyMapper, parseBlueskyPosts } from './bluesky-acl.js';
import type { BlueskyCredentials } from './bluesky-session.js';
import { BlueskySessionClient, DEFAULT_BLUESKY_SERVICE_URL } from './bluesky-session.js';

const ADAPTER_ID = 'bluesky';
const SOURCE = 'Bluesky';
const LICENSE = 'Bluesky public API terms';
const DEFAULT_BASE_URL = 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts';
const SEARCH_METHOD_PATH = '/xrpc/app.bsky.feed.searchPosts';
const DEFAULT_QUERY = 'wildfire OR flood OR evacuation OR disaster';
const SEARCH_LIMIT = 25;
const MOCK_FIXTURE = 'posts.json';

// No real bbox applies to a keyword search; a world-covering sentinel keeps Region shape-valid while
// GLOBAL coverage (see `isCovered`) never actually consults it.
const WORLD_BBOX: readonly [number, number, number, number] = [-180, -90, 180, 90];

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface BlueskyAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  /** Present only on the BYO-account rung; absent ⇒ the keyless public AppView is used. */
  readonly session?: BlueskySessionClient;
}

export class BlueskyAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id = ADAPTER_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // public search spans all of Bluesky, no region gate
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly session: BlueskySessionClient | undefined;

  constructor(deps: BlueskyAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.session = deps.session;
  }

  /** Framework port: walk the full redundancy ladder. `region.id` is the Bluesky search query term. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<BlueskyPost, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: blueskyMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P6). An empty/blank query falls back to a broad disaster-corroboration search. */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const q = query.trim() === '' ? DEFAULT_QUERY : query.trim();
    const region: Region = { id: q, bbox: WORLD_BBOX };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `Bluesky unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const items = res.value.records.map((r) => r.entity);
    return domainOk({ data: items, freshness: makeFreshness(res.value.freshness) });
  }

  /** Authed rung when credentials were configured; otherwise the keyless public AppView, unchanged. */
  private async fetchLive(region: Region): Promise<readonly BlueskyPost[]> {
    const url = buildBlueskyUrl(this.config.url ?? DEFAULT_BASE_URL, region.id);
    const body =
      this.session !== undefined
        ? await this.session.getText(url)
        : await httpGetText(url, { timeoutMs: this.config.timeoutMs });
    return parseBlueskyPosts(body).posts;
  }

  private async loadMock(): Promise<readonly BlueskyPost[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseBlueskyPosts(res.value).posts;
  }
}

/** Pure URL builder for `app.bsky.feed.searchPosts` (exported for direct, deterministic unit testing). */
export function buildBlueskyUrl(base: string, query: string, limit: number = SEARCH_LIMIT): string {
  return `${base}?q=${encodeURIComponent(query)}&limit=${limit}`;
}

/**
 * Factory: resolve SOURCE_BLUESKY_* config from env and construct the adapter. Fail-fast on bad config.
 *
 * BYO-account rung: with `BLUESKY_IDENTIFIER` + `BLUESKY_APP_PASSWORD` the adapter searches through the
 * operator's PDS (`BLUESKY_SERVICE_URL`, default bsky.social) on an authenticated session; without them it
 * keeps the keyless public AppView base URL, which only MOCK/CACHED modes can now reach — LIVE without
 * credentials is a CONFIG failure at boot, never a 403 at fetch time.
 */
export function makeBlueskyAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<BlueskyAdapter> {
  const credentials = readCredentials(env);
  const service = (env.BLUESKY_SERVICE_URL ?? DEFAULT_BLUESKY_SERVICE_URL).replace(/\/+$/, '');
  const cfg = resolveSourceConfig({
    prefix: 'BLUESKY',
    env,
    defaultMode: 'MOCK',
    // Authed search is served by the operator's own PDS; the keyless AppView host is the fallback default.
    defaultUrl: credentials !== undefined ? `${service}${SEARCH_METHOD_PATH}` : DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  if (cfg.value.mode === 'LIVE' && credentials === undefined) {
    return err(
      makeAdapterError(
        'CONFIG',
        'BLUESKY: LIVE mode requires BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD to be set',
        { retryable: false },
      ),
    );
  }
  const session =
    credentials !== undefined
      ? new BlueskySessionClient({ credentials, serviceUrl: service, timeoutMs: cfg.value.timeoutMs })
      : undefined;
  return {
    ok: true,
    value: new BlueskyAdapter({ engine, config: cfg.value, ...(session !== undefined ? { session } : {}) }),
  };
}

/** Both vars or neither — a half-configured account is treated as no account (and fails LIVE fast). */
function readCredentials(env: Readonly<Record<string, string | undefined>>): BlueskyCredentials | undefined {
  const identifier = (env.BLUESKY_IDENTIFIER ?? '').trim();
  const appPassword = (env.BLUESKY_APP_PASSWORD ?? '').trim();
  if (identifier === '' || appPassword === '') return undefined;
  return { identifier, appPassword };
}
