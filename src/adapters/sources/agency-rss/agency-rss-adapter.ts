// BEACON — Agency-RSS adapter (D-32/D-33, adapter-contract §6, NewsIntelPort P6). ONE adapter, N
// config-driven verified feeds (ReliefWeb/GDACS/EONET/FloodList/world wires + RO Digi24/ProTV/HotNews/
// Mediafax) → canonical NewsItem behind the shared redundancy ladder (live → last-known-good cache →
// recorded-mock → typed unavailable). Implements BOTH the framework SourceAdapterPort<NewsItem> AND the
// outward NewsIntelPort, so the application depends only on the port.
//
// DATA_SOURCE_VERIFICATION §10.4/§10.5: verified tier LIVE, keyless (every catalog feed is a plain public
// RSS/Atom URL — no API key), coverage GLOBAL. Config-driven, 12-factor (AGENTS.md §14): mode/timeout come
// from SOURCE_AGENCYRSS_* env (configPrefix AGENCYRSS); the feed URL LIST is a separate, adapter-specific
// pair of env vars — AGENCYRSS_FEEDS (worldwide set) and AGENCYRSS_FEEDS_RO (Romania set) — so adding/
// removing a feed is a config-only change (FR-10), never a code change.
//
// REGION RULE (deliberately simple + deterministic, documented per the task): AGENCYRSS_FEEDS_RO is used
// instead of AGENCYRSS_FEEDS when the request is "about Romania" — decided two ways depending on entry
// point:
//   - the framework `fetch(region)` method (used by main/composition when a Region is already known):
//     `region.iso === 'RO'` selects the RO set (falling back to the worldwide set if AGENCYRSS_FEEDS_RO
//     is unset/empty).
//   - the outward `fetchNews(query)` port method (no Region parameter): a whole-word, case-insensitive
//     match of /romania|\bro\b/ in the query string selects the RO set; anything else uses the worldwide
//     set. Both paths funnel into the same `selectFeeds` below, so the rule lives in exactly one place.
//
// LATENCY BOUND (documented per the task): fetchLive caps at the FIRST N=3 configured feeds per fetch
// (`MAX_FEEDS_PER_FETCH`) — fetching every catalog feed (10+) on every request would multiply tail
// latency by the slowest feed; 3 keeps one fetch bounded while still corroborating across sources. Feed
// ORDER in AGENCYRSS_FEEDS/_RO is therefore significant — operators list higher-priority feeds first.
// Individual feed failures are tolerated (Promise.allSettled): the fetch only fails when ALL selected
// feeds are unreachable, at which point the redundancy engine degrades to cache/mock (never a dead-end).
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
import {
  httpGetText,
  loadFixtureText,
  makeAdapterError,
  resolveSourceConfig,
} from '@/adapters/_shared/index.js';
import type { AgencyRssRawEntry } from './agency-rss-acl.js';
import { agencyRssMapper, parseAgencyRss } from './agency-rss-acl.js';

const ADAPTER_ID = 'agency-rss';
const SOURCE = 'Agency RSS aggregation';
// D-32/D-33: each configured feed carries its own publisher license (ReliefWeb CC BY-IGO-equivalent,
// GDACS public domain, national broadcaster RSS terms, …) — there is no single blanket license to state.
const LICENSE = 'per-feed (verified open feeds)';
const MOCK_FIXTURE = 'feed.xml';
const USER_AGENT = 'BEACON/1.0 (+https://github.com/IEEE-Response-Quest; emergency COP)';

const MAX_FEEDS_PER_FETCH = 3; // bound fetch latency (see module header)
const MAX_ITEMS = 25; // cap the merged, sorted result

const GLOBAL_REGION: Region = { id: 'global', bbox: [-180, -90, 180, 90] };
const RO_REGION: Region = { id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' };
const RO_QUERY_RE = /romania|\bro\b/i;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface AgencyRssAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  /** AGENCYRSS_FEEDS — the worldwide verified feed list (comma-separated URLs, already split/trimmed). */
  readonly feeds: readonly string[];
  /** AGENCYRSS_FEEDS_RO — the Romania feed list; empty/omitted falls back to `feeds` (see selectFeeds). */
  readonly feedsRo?: readonly string[];
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  readonly maxFeedsPerFetch?: number;
  readonly maxItems?: number;
}

export class AgencyRssAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id = ADAPTER_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly feeds: readonly string[];
  private readonly feedsRo: readonly string[];
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly maxFeedsPerFetch: number;
  private readonly maxItems: number;

  constructor(deps: AgencyRssAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.feeds = deps.feeds;
    this.feedsRo = deps.feedsRo ?? [];
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.maxFeedsPerFetch = deps.maxFeedsPerFetch ?? MAX_FEEDS_PER_FETCH;
    this.maxItems = deps.maxItems ?? MAX_ITEMS;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<AgencyRssRawEntry, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: agencyRssMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P6). `query` optionally filters title+summary; RO-shaped queries pick the RO feed set. */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const res = await this.fetch(regionForQuery(query));
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `agency-rss unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const items = res.value.records.map((r) => r.entity);
    return domainOk({
      data: filterNews(items, query),
      freshness: makeFreshness(res.value.freshness),
    });
  }

  /** AGENCYRSS_FEEDS_RO for a RO region (falling back to the worldwide set when unset/empty); else AGENCYRSS_FEEDS. */
  private selectFeeds(region: Region): readonly string[] {
    if (region.iso === 'RO' && this.feedsRo.length > 0) return this.feedsRo;
    return this.feeds;
  }

  private async fetchLive(region: Region): Promise<readonly AgencyRssRawEntry[]> {
    const feedUrls = this.selectFeeds(region).slice(0, this.maxFeedsPerFetch);
    if (feedUrls.length === 0) {
      throw makeAdapterError('CONFIG', 'agency-rss: no feeds configured (AGENCYRSS_FEEDS empty)', {
        retryable: false,
      });
    }
    const settled = await Promise.allSettled(feedUrls.map((url) => this.fetchOneFeed(url)));
    const entries: AgencyRssRawEntry[] = [];
    let anySucceeded = false;
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        anySucceeded = true;
        entries.push(...result.value);
      }
    }
    if (!anySucceeded) {
      throw makeAdapterError(
        'UPSTREAM_UNAVAILABLE',
        'agency-rss: all configured feeds unreachable',
        {
          retryable: true,
        },
      );
    }
    return sortByPublishedDesc(entries).slice(0, this.maxItems);
  }

  private async fetchOneFeed(url: string): Promise<readonly AgencyRssRawEntry[]> {
    const xml = await httpGetText(url, {
      timeoutMs: this.config.timeoutMs,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml',
      },
    });
    return parseAgencyRss(xml).entries;
  }

  private async loadMock(): Promise<readonly AgencyRssRawEntry[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return sortByPublishedDesc(parseAgencyRss(res.value).entries).slice(0, this.maxItems);
  }
}

/** The `query`-side half of the REGION RULE (see module header). Exported for direct, deterministic testing. */
export function regionForQuery(query: string): Region {
  return RO_QUERY_RE.test(query) ? RO_REGION : GLOBAL_REGION;
}

function sortByPublishedDesc(entries: readonly AgencyRssRawEntry[]): readonly AgencyRssRawEntry[] {
  return [...entries].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** Case-insensitive substring filter over title+summary; an empty/blank query returns all items. */
function filterNews(items: readonly NewsItem[], query: string): readonly NewsItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items.filter((i) => `${i.title} ${i.summary ?? ''}`.toLowerCase().includes(q));
}

/** Split AGENCYRSS_FEEDS/_RO ("url1,url2,…") into a trimmed, non-empty URL list. Exported for direct testing. */
export function parseFeedsEnv(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Factory: resolve SOURCE_AGENCYRSS_* config + the AGENCYRSS_FEEDS[_RO] lists from env. Fail-fast (CONFIG). */
export function makeAgencyRssAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<AgencyRssAdapter> {
  const cfg = resolveSourceConfig({ prefix: 'AGENCYRSS', env, defaultMode: 'LIVE' });
  if (!cfg.ok) return cfg;
  const feeds = parseFeedsEnv(env.AGENCYRSS_FEEDS);
  const feedsRo = parseFeedsEnv(env.AGENCYRSS_FEEDS_RO);
  return { ok: true, value: new AgencyRssAdapter({ engine, config: cfg.value, feeds, feedsRo }) };
}
