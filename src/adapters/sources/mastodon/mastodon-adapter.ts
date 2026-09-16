// BEACON — Mastodon vetted-social adapter (S2·Lane-A1; adapter-contract §6, NewsIntelPort P6, Art. XIV).
// A public Mastodon instance's hashtag timeline (`GET {instance}/api/v1/timelines/tag/{tag}`) → canonical
// NewsItem behind the shared redundancy ladder (live → last-known-good cache → recorded-mock → typed
// unavailable). Implements BOTH the framework SourceAdapterPort<NewsItem> (fetch/health) AND the outward
// NewsIntelPort, so the application depends only on the port, never on Mastodon internals.
//
// WHY THIS IS THE DEMO'S LIVE SOCIAL SOURCE (LIVE_DEMO_DELIVERY_PLAN §0 decision 10): the instance API is
// KEYLESS, unauthenticated, documented (docs.joinmastodon.org) and explicitly public — no account, no app
// registration, no ToS-scraping (contrast X/Twitter, EXCLUDED by AGENTS.md §6/§14; contrast Bluesky, whose
// public AppView search began 403-ing datacenter IPs, which is why that rung now needs BYO credentials).
// So `defaultMode` is LIVE here — the ONE social rung that actually runs live in the demo.
//
// CORROBORATION-ONLY, exactly like the bluesky rung (Art. XIV): every item is stamped with the same fixed
// low-trust floor (SOCIAL / 0.35), is never auto-trusted, and is flagged for human corroboration rather
// than merged as fact. Aggregate/no-PII: the ACL never maps an account identifier (see mastodon-acl.ts).
//
// Config-driven (12-factor, nothing hardcoded): mode/timeout from SOURCE_MASTODON_*; the instance from
// `MASTODON_INSTANCE` (SOURCE_MASTODON_URL still wins, per the shared resolver's precedence) and the
// watched hashtags from `MASTODON_TAGS`. Coverage is GLOBAL: a hashtag timeline has no geographic scoping,
// so a bbox would be a fiction (the same honest call the bluesky adapter makes).
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
  Env,
  FetchResult,
  RedundancyEngine,
  Region,
  SourceAdapterPort,
  SourceConfig,
  SourceMode,
} from '@/adapters/_shared/index.js';
import {
  httpGetText,
  loadFixtureText,
  makeAdapterError,
  ok,
  err,
  resolveSourceConfig,
} from '@/adapters/_shared/index.js';
import type { MastodonStatus } from './mastodon-acl.js';
import {
  mastodonMapper,
  mergeStatuses,
  parseMastodonStatuses,
  parseMastodonTimelines,
} from './mastodon-acl.js';

const ADAPTER_ID = 'mastodon';
const SOURCE = 'Mastodon public timeline (vetted-social)';
// Public posts served by a Mastodon instance's own public API. Per-post copyright stays with the author;
// BEACON quotes them as corroboration-only signal, attributed and linked (NOTICE).
const LICENSE = 'Mastodon instance public API — public posts, corroboration-only';
const DEFAULT_INSTANCE = 'https://mastodon.social';
const DEFAULT_TAGS: readonly string[] = ['wildfire', 'flood'];
const DEFAULT_LIMIT = 20;
// The recorded fixture is STRUCTURALLY a real capture — a live keyless GET of
// mastodon.social/api/v1/timelines/tag/wildfire?limit=5 (HTTP 200, 2026-08-08) supplied its exact key set,
// nesting and HTML markup shapes — with every account, permalink, media reference and body text replaced
// by fictitious equivalents and the instants aligned to the deterministic test clock. Retaining five real
// people's posts, handles and avatars in a public repo is exactly the PII retention Art. XIV forbids, so
// the fixture keeps the SHAPE (which is what the ACL is tested against) and none of the persons.
const MOCK_FIXTURE = 'timeline.json';
/** Cache/region key used when the outward port is called with no query at all. */
const ALL_TAGS_REGION_ID = 'all-tags';

// No real bbox applies to a hashtag timeline; a world-covering sentinel keeps Region shape-valid while
// GLOBAL coverage (see `isCovered`) never actually consults it.
const WORLD_BBOX: readonly [number, number, number, number] = [-180, -90, 180, 90];

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface MastodonAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly tags?: readonly string[]; // watched hashtags; defaults to wildfire,flood
  readonly limit?: number; // statuses requested per tag
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class MastodonAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id = ADAPTER_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // hashtag timelines span the fediverse, no region gate
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly tags: readonly string[];
  private readonly limit: number;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: MastodonAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.tags = deps.tags !== undefined && deps.tags.length > 0 ? deps.tags : DEFAULT_TAGS;
    this.limit = deps.limit ?? DEFAULT_LIMIT;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder. `region.id` narrows the watchlist (see `selectTags`). */
  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<MastodonStatus, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: mastodonMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /**
   * Outward domain port (P6). A hashtag timeline is NOT a free-text search, so an arbitrary query can never
   * become an endpoint: the query only narrows the CONFIGURED watchlist when it names one of its tags
   * (`selectTags`). Anything else — a region id, a sentence, a blank — fetches the whole watchlist.
   */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const q = query.trim().toLowerCase();
    const region: Region = { id: q === '' ? ALL_TAGS_REGION_ID : q, bbox: WORLD_BBOX };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `Mastodon unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const items = res.value.records.map((r) => r.entity);
    return domainOk({ data: items, freshness: makeFreshness(res.value.freshness) });
  }

  /**
   * One GET per watched tag, merged newest-first. `Promise.allSettled` (not `all`) so a single tag whose
   * timeline is down cannot take the whole live rung with it (Art. XVI); only when EVERY tag fails does the
   * live rung throw and the ladder fall through to cache → recorded mock.
   */
  private async fetchLive(region: Region): Promise<readonly MastodonStatus[]> {
    const base = this.config.url ?? DEFAULT_INSTANCE;
    const tags = selectTags(region.id, this.tags);
    const settled = await Promise.allSettled(
      tags.map((tag) =>
        httpGetText(buildMastodonTagUrl(base, tag, this.limit), {
          timeoutMs: this.config.timeoutMs,
        }),
      ),
    );
    const bodies = settled.filter(isFulfilled).map((r) => r.value);
    if (bodies.length === 0) throw firstRejection(settled, tags.length);
    return mergeStatuses(parseMastodonTimelines(bodies), this.limit);
  }

  private async loadMock(): Promise<readonly MastodonStatus[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseMastodonStatuses(res.value).statuses;
  }
}

/** Pure URL builder for a hashtag timeline (exported for direct, deterministic unit testing). */
export function buildMastodonTagUrl(
  instance: string,
  tag: string,
  limit: number = DEFAULT_LIMIT,
): string {
  return `${trimTrailingSlash(instance)}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`;
}

/**
 * Which tags one fetch asks for. A caller-supplied id narrows the watchlist ONLY when it actually names a
 * configured tag; otherwise the whole watchlist is fetched. Deliberately NOT "use the id as the tag": a
 * region id (`us-ca`) or a free-text query is not a hashtag, and inventing one would fabricate an endpoint.
 */
export function selectTags(regionId: string, configured: readonly string[]): readonly string[] {
  const wanted = regionId.trim().toLowerCase();
  return configured.includes(wanted) ? [wanted] : configured;
}

/** Factory: resolve the MASTODON_ and SOURCE_MASTODON_ env config and construct the adapter. Fail-fast. */
export function makeMastodonAdapter(
  engine: RedundancyEngine,
  env: Env = process.env,
): AdapterResult<MastodonAdapter> {
  const instance = resolveInstance(env.MASTODON_INSTANCE);
  if (!instance.ok) return instance;
  const tags = resolveTags(env.MASTODON_TAGS);
  if (!tags.ok) return tags;
  const cfg = resolveSourceConfig({
    prefix: 'MASTODON',
    env,
    // Keyless LIVE by default — the demo's live social source (plan §0 decision 10). No key, no auth, so
    // there is deliberately no `keyEnv`/`requireKeyForLive` here (contrast FIRMS's MAP_KEY).
    defaultMode: 'LIVE',
    defaultUrl: instance.value,
  });
  if (!cfg.ok) return cfg;
  return ok(new MastodonAdapter({ engine, config: cfg.value, tags: tags.value }));
}

/** `MASTODON_INSTANCE` must be an absolute http(s) origin — a bad value fails the boot, never a fetch. */
function resolveInstance(raw: string | undefined): AdapterResult<string> {
  const value = trimTrailingSlash((raw ?? '').trim());
  if (value === '') return ok(DEFAULT_INSTANCE);
  if (!/^https?:\/\/[^\s/]+/.test(value)) {
    return err(
      makeAdapterError(
        'CONFIG',
        `MASTODON_INSTANCE must be an absolute http(s) URL: '${raw ?? ''}'`,
        {
          retryable: false,
        },
      ),
    );
  }
  return ok(value);
}

/**
 * `MASTODON_TAGS` is a comma-separated hashtag list. Hashtags are letters/digits/underscore only, so
 * anything else is dropped; a list that was SET but yields nothing usable is a CONFIG failure rather than a
 * silent fallback to the defaults (an operator who typed a watchlist must not silently get another one).
 */
function resolveTags(raw: string | undefined): AdapterResult<readonly string[]> {
  if (raw === undefined || raw.trim() === '') return ok(DEFAULT_TAGS);
  const tags = raw
    .split(',')
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter((t) => /^[\p{L}\p{N}_]+$/u.test(t));
  if (tags.length === 0) {
    return err(
      makeAdapterError('CONFIG', `MASTODON_TAGS contains no usable hashtag: '${raw}'`, {
        retryable: false,
      }),
    );
  }
  return ok(tags);
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function isFulfilled(r: PromiseSettledResult<string>): r is PromiseFulfilledResult<string> {
  return r.status === 'fulfilled';
}

/** Surface the first tag's real failure (a typed AdapterError from httpGetText) so the ladder classifies it. */
function firstRejection(
  settled: readonly PromiseSettledResult<string>[],
  tagCount: number,
): unknown {
  for (const r of settled) {
    if (r.status === 'rejected') return r.reason;
  }
  return makeAdapterError(
    'UPSTREAM_UNAVAILABLE',
    `${ADAPTER_ID}: no tag timeline fetched (${tagCount} tags)`,
  );
}
