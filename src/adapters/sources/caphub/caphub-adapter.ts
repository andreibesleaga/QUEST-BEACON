// BEACON — IFRC Alert Hub adapter (S2·Lane-A2; adapter-contract §6, NewsIntelPort P6; Art. XVI). The
// worldwide official-CAP aggregator → canonical NewsItem behind the shared redundancy ladder
// (live → last-known-good cache → recorded-mock → typed unavailable). Implements BOTH the framework
// SourceAdapterPort<NewsItem> AND the outward domain NewsIntelPort.
//
// SOURCE (live-verified 2026-08-08 by real curl, HTTP 200, KEYLESS — see caphub-acl.ts header for the
// exact query and recorded response): `https://alerthub-api.ifrc.org/graphql/`, GraphQL-over-GET.
// 5418 alerts were live at probe, from national alerting authorities worldwide.
//
// ROLE (why this exists alongside GDACS/MeteoAlarm/WMO-SWIC): `wmo-swic` relays ONE registered authority
// per configured source id and `meteoalarm-*` covers EUMETNET members; the Alert Hub is the AGGREGATE —
// it is the only wired source that can surface an official alert from a country BEACON has no dedicated
// adapter for. That is its whole job: broader official-alert corroboration, never a hazard footprint.
//
// LICENCE (stated honestly — this is a real finding, not an omission): the Alert Hub publishes NO single
// aggregate data licence. Each alert remains under the terms of its ISSUING NATIONAL AUTHORITY, and the
// NewsItem's `url` therefore points at that authority's own CAP document rather than at the hub, so every
// citation lands on the licensor. Both parties are named in the provenance licence string below and in
// NOTICE. Because the terms are per-issuer and not declared machine-readably, the shipped default mode is
// CACHED (recorded sample), and flipping to LIVE is an operator decision — documented, not assumed.
//
// RATE LIMITS: none published. Politeness is enforced locally instead — a bounded page size, a 900 s
// cache TTL, and the shared circuit breaker.
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
import type { CapHubAlert } from './caphub-acl.js';
import { capHubMapper, parseCapHubAlerts } from './caphub-acl.js';

const ADAPTER_ID = 'caphub';
const SOURCE = 'IFRC Alert Hub (worldwide CAP aggregator)';
const LICENSE =
  'IFRC Alert Hub aggregation; each alert under its issuing national authority’s terms — attribution';
const DEFAULT_BASE_URL = 'https://alerthub-api.ifrc.org/graphql/';
const MOCK_FIXTURE = 'alerts.json';
// Per-fetch page size (the hub held 5418 alerts at probe): the newest page is what a COP needs, and a
// bounded page also bounds one fetch's latency/host load where no rate limit is published.
const DEFAULT_LIMIT = 50;
// Polite contact User-Agent for the live rung — not a secret; the endpoint stays env-overridable.
const USER_AGENT = 'BEACON/1.0 (+https://github.com/IEEE-Response-Quest; emergency COP)';
// The whole-world region this adapter fetches under. The aggregate query has no bbox parameter, so ONE
// stable region id keeps the last-known-good cache single-keyed (same pattern as census/openfema).
const WORLD_REGION: Region = { id: 'caphub-world', bbox: [-180, -90, 180, 90] };

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface CapHubAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly limit?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class CapHubAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id = ADAPTER_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // every country that publishes CAP to the hub
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly limit: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: CapHubAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.limit = deps.limit ?? DEFAULT_LIMIT;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped NewsItems. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<CapHubAlert, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: capHubMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P6). `query` optionally filters the alert set; empty = all alerts. */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const res = await this.fetch(WORLD_REGION);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `Alert Hub unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const items = res.value.records.map((r) => r.entity);
    return domainOk({
      data: filterNews(items, query),
      freshness: makeFreshness(res.value.freshness),
    });
  }

  private async fetchLive(): Promise<readonly CapHubAlert[]> {
    const json = await httpGetText(this.buildUrl(), {
      timeoutMs: this.config.timeoutMs,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    return parseCapHubAlerts(json).alerts;
  }

  private async loadMock(): Promise<readonly CapHubAlert[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseCapHubAlerts(res.value).alerts;
  }

  /** GraphQL-over-GET: /{base}?query=<url-encoded document> (verified live 2026-08-08). */
  private buildUrl(): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    return `${base}?query=${encodeURIComponent(alertsQuery(this.limit))}`;
  }
}

/**
 * The alerts query, built from the limit ONLY — the field selection is a fixed literal, never assembled
 * from caller input, so nothing user-supplied can reach the GraphQL document (injection is structurally
 * impossible here). Selection mirrors caphub-acl.ts's raw types exactly.
 */
export function alertsQuery(limit: number): string {
  return (
    `query{public{alerts(pagination:{limit:${Math.trunc(limit)},offset:0}){limit offset count ` +
    'items{id sent url identifier sender source status msgType country{id name iso3} feed{id url} ' +
    'info{event headline description severity urgency certainty category senderName effective expires language web}}}}}'
  );
}

/** Case-insensitive substring filter over title+summary; an empty/blank query returns all items. */
function filterNews(items: readonly NewsItem[], query: string): readonly NewsItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items.filter((i) => `${i.title} ${i.summary ?? ''}`.toLowerCase().includes(q));
}

/** Factory: resolve SOURCE_CAPHUB_* config from env and construct the adapter. Fail-fast (CONFIG). */
export function makeCapHubAdapter(
  engine: RedundancyEngine,
  env: Env = process.env,
): AdapterResult<CapHubAdapter> {
  // Keyless by design — no `keyEnv`/`requireKeyForLive`, so LIVE can never fail for a missing secret.
  const cfg = resolveSourceConfig({
    prefix: 'CAPHUB',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return ok(new CapHubAdapter({ engine, config: cfg.value }));
}
