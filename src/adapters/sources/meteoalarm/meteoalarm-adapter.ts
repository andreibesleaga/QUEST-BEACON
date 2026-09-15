// BEACON — MeteoAlarm generic country adapter (B3.1; adapter-contract §6, NewsIntelPort P6). ONE adapter,
// N config-driven country feeds: MeteoAlarm publishes an identical legacy-Atom feed per member country at
// `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-<country>` (slug = English country name;
// GLOBAL_ZONE_SOURCE_RESEARCH.md "Cross-zone aggregators": LIVE, keyless, ~38 countries, GR/ES/PT/IT
// verified 2026-07-18). Each country is a MeteoalarmFeed preset (id, ISO gate, URL, fixture, env prefix)
// so a new country is one manifest row + one preset line — zero new parsing/adapter code (FR-10).
//
// WIDENED from src/adapters/sources/meteoalarm-ro/meteoalarm-ro-adapter.ts (E4·T-177) BACKWARD-COMPATIBLY
// (alias row pattern): `meteoalarm-ro` keeps its manifest row, env prefix (METEOALARM_RO), fixtures and
// tests — its module now subclasses this one with the RO preset. Official warnings → canonical NewsItem
// behind the shared redundancy ladder (live → last-known-good cache → recorded-mock → typed unavailable).
//
// DATA_SOURCE_VERIFICATION §10.1/§10.4 + §3: verified tier CACHED, keyless legacy Atom, CC-BY-4.0-
// equivalent terms. The feed has NO geometry (only area names + awareness codes) → honest NewsItem
// advisory mapping (see meteoalarm-acl.ts header). Config-driven: mode/url/timeout from
// SOURCE_<PREFIX>_* env. Default mode MOCK (air-gapped-first).
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
import { httpGetText, loadFixtureText, ok, resolveSourceConfig } from '@/adapters/_shared/index.js';
import type { MeteoalarmEntry } from './meteoalarm-acl.js';
import { meteoalarmMapper, parseMeteoalarm } from './meteoalarm-acl.js';

const SOURCE = 'MeteoAlarm';
const LICENSE = 'MeteoAlarm — terms equivalent to CC BY 4.0';
const FEED_BASE = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom';
// Polite contact User-Agent for the live rung (MeteoAlarm terms) — not a secret, overridable via env url only.
const USER_AGENT = 'BEACON/1.0 (+https://github.com/IEEE-Response-Quest; emergency COP)';
/**
 * The Accept header — and it is not a formality. It is what took these three feeds off the live board.
 *
 * VERIFIED against feeds.meteoalarm.org on 2026-09-12: same URL, same User-Agent, one header apart.
 *
 *   `Accept: application/atom+xml`                             -> HTTP 406, text/html body
 *   `Accept: application/atom+xml, application/xml;q=0.9, ...` -> HTTP 200, application/atom+xml
 *   (no Accept header at all)                                  -> HTTP 200, application/atom+xml
 *
 * The one value the edge refuses is the exact single type this adapter used to send. The live log read
 * `HTTP 406` for meteoalarm-ro, -es and -gr; all three were this one line. The fix is to ask the way a
 * browser asks — the precise type first, then progressively weaker fallbacks — which is what the header
 * is for and what a server negotiating content is entitled to expect.
 */
const ACCEPT = 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;
const OWN_FIXTURES_DIR = fileURLToPath(new URL('./__fixtures__', import.meta.url));

/** One MeteoAlarm country feed: everything country-specific, so the adapter itself stays generic. */
export interface MeteoalarmFeed {
  /** Manifest/adapter id, e.g. 'meteoalarm-gr' (== SourceRecord.adapter). */
  readonly adapterId: string;
  /** ISO-3166-1 alpha-2 the COUNTRIES coverage gate admits, e.g. 'GR'. */
  readonly iso: string;
  /** Country Atom feed URL (slug = English country name); SOURCE_<PREFIX>_URL overrides. */
  readonly defaultUrl: string;
  /** The fixed region the outward NewsIntelPort queries (bbox is approximate — only the iso gates). */
  readonly newsRegion: Region;
  /** Recorded/recorded-style mock fixture file name inside `fixturesDir`. */
  readonly fixture: string;
  /** Directory holding `fixture` (RO keeps its original meteoalarm-ro/__fixtures__). */
  readonly fixturesDir: string;
}

// Bboxes below are approximate country extents used ONLY to satisfy Region's shape for the outward port —
// the COUNTRIES coverage gate matches on `iso`, never on bbox (see _shared/coverage.ts).
const GR_FEED: MeteoalarmFeed = {
  adapterId: 'meteoalarm-gr',
  iso: 'GR',
  defaultUrl: `${FEED_BASE}-greece`,
  newsRegion: { id: 'gr', bbox: [19.3, 34.8, 29.7, 41.8], iso: 'GR' },
  fixture: 'greece-atom.xml',
  fixturesDir: OWN_FIXTURES_DIR,
};

const ES_FEED: MeteoalarmFeed = {
  adapterId: 'meteoalarm-es',
  iso: 'ES',
  defaultUrl: `${FEED_BASE}-spain`,
  newsRegion: { id: 'es', bbox: [-9.4, 35.9, 4.4, 43.9], iso: 'ES' },
  fixture: 'spain-atom.xml',
  fixturesDir: OWN_FIXTURES_DIR,
};

export interface MeteoalarmAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly feed: MeteoalarmFeed;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class MeteoalarmAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id: string;
  readonly coverage: Coverage;
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly feed: MeteoalarmFeed;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: MeteoalarmAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.feed = deps.feed;
    this.id = deps.feed.adapterId;
    this.coverage = { kind: 'COUNTRIES', iso: [deps.feed.iso] };
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? deps.feed.fixturesDir;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<MeteoalarmEntry, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: meteoalarmMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P6). `query` optionally filters the warning set; empty = all warnings. */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const res = await this.fetch(this.feed.newsRegion);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `${this.id} unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const items = res.value.records.map((r) => r.entity);
    return domainOk({
      data: filterNews(items, query),
      freshness: makeFreshness(res.value.freshness),
    });
  }

  private async fetchLive(): Promise<readonly MeteoalarmEntry[]> {
    const base = this.config.url ?? this.feed.defaultUrl;
    const xml = await httpGetText(base, {
      timeoutMs: this.config.timeoutMs,
      headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT },
    });
    return parseMeteoalarm(xml);
  }

  private async loadMock(): Promise<readonly MeteoalarmEntry[]> {
    const res = await loadFixtureText(this.fixturesDir, this.feed.fixture);
    if (!res.ok) throw res.error;
    return parseMeteoalarm(res.value);
  }
}

/** Case-insensitive substring filter over title+summary; an empty/blank query returns all items. */
function filterNews(items: readonly NewsItem[], query: string): readonly NewsItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items.filter((i) => `${i.title} ${i.summary ?? ''}`.toLowerCase().includes(q));
}

/**
 * Build a `make*Adapter` factory for one country feed: resolves SOURCE_<PREFIX>_* config from env,
 * fail-fast (CONFIG) on a bad mode/url. Default mode MOCK (air-gapped-first); the manifest/region
 * override injects the shipped mode via env (see src/main/adapter-registry.ts resolveEntryEnv).
 */
export function makeMeteoalarmFactory(
  configPrefix: string,
  feed: MeteoalarmFeed,
): (engine: RedundancyEngine, env?: Env) => AdapterResult<MeteoalarmAdapter> {
  return (engine, env = process.env) => {
    const cfg = resolveSourceConfig({
      prefix: configPrefix,
      env,
      defaultMode: 'MOCK',
      defaultUrl: feed.defaultUrl,
    });
    if (!cfg.ok) return cfg;
    return ok(new MeteoalarmAdapter({ engine, config: cfg.value, feed }));
  };
}

/** Factory: MeteoAlarm Greece (SOURCE_METEOALARM_GR_* env; feed slug 'greece'). */
export const makeMeteoalarmGrAdapter = makeMeteoalarmFactory('METEOALARM_GR', GR_FEED);

/** Factory: MeteoAlarm Spain (SOURCE_METEOALARM_ES_* env; feed slug 'spain'). */
export const makeMeteoalarmEsAdapter = makeMeteoalarmFactory('METEOALARM_ES', ES_FEED);
