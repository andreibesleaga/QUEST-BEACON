// BEACON — WMO-SWIC CAP relay adapter (B3.2; adapter-contract §6, NewsIntelPort P6; Art. XVI). Official
// national CAP alerts relayed by the WMO Severe Weather Information Centre → canonical NewsItem behind
// the shared redundancy ladder (live → last-known-good cache → recorded-mock → typed unavailable).
// Implements BOTH the framework SourceAdapterPort<NewsItem> AND the outward NewsIntelPort.
//
// SOURCE (live-verified 2026-07-27 — GLOBAL_ZONE_SOURCE_RESEARCH.md "LATE ADDITION 3", resolves F-21):
// index `https://severeweather.wmo.int/v2/cap-alerts/<sourceId>/rss.xml` (RSS 2.0, per-alert CAP v1.2
// links on the same host), keyless. The SWIC source id is CONFIG (WMO_SWIC_SOURCE_ID), so another
// registered authority is a config change, not a code change (FR-10) — but its licence must be reviewed
// first: the shipped default `ph-pagasa-en` (PAGASA-DOST) is explicitly CC BY 4.0 (declared verbatim in
// PAGASA's native feed); the relay itself is under the WMO Unified Data Policy (Res. 1, attribution).
//
// F-48 🔴 mechanism (binding, see wmo-swic-acl.ts header for the full rationale): this adapter yields
// alert/news intel ONLY — it NEVER constructs a HazardGeometry, so no `acp` (Tropical Cyclone Alert)
// area can ever be rendered as a hazard footprint or reach exposure computation; the `acp` PAR polygon
// is labelled "alerting area only" in the NewsItem summary. Flood/storm FOOTPRINTS for PH come from the
// global tier (GloFAS/GDACS).
//
// HONEST LIMITATIONS (F-51 — claimed nowhere as more): only the `gfa` + `acp` families were observed
// (no thunderstorm/rainfall-advisory CAP support is claimed); no published rate limit exists for either
// host (politeness: CACHED default, ttl 900 s, capped per-fetch CAP-document count, circuit breaker);
// per-alert URLs are UUID-keyed ⇒ feed-discovery only; the PH bbox below is approximate, not
// geodetically verified (it only shapes the outward-port Region — the COUNTRIES gate matches iso).
// Fixtures are HAND-AUTHORED recorded-style from the documented live evidence, and labelled as such.
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
import { httpGetText, loadFixtureText, makeAdapterError, ok, resolveSourceConfig } from '@/adapters/_shared/index.js';
import type { SwicCapAlert } from './wmo-swic-acl.js';
import { parseSwicCap, parseSwicIndex, swicCapMapper } from './wmo-swic-acl.js';

const ADAPTER_ID = 'wmo-swic';
const SOURCE = 'WMO SWIC CAP relay (PAGASA-DOST)';
const LICENSE = 'CC BY 4.0 (PAGASA-DOST); relay under WMO Unified Data Policy Res. 1 — attribution';
const DEFAULT_RELAY_BASE = 'https://severeweather.wmo.int/v2/cap-alerts';
const DEFAULT_SOURCE_ID = 'ph-pagasa-en';
// Polite contact User-Agent for the live rung — not a secret, endpoint overridable via env url only.
const USER_AGENT = 'BEACON/1.0 (+https://github.com/IEEE-Response-Quest; emergency COP)';
// Per-fetch cap on CAP-document GETs (the live index carried 71 items at probe): bounds one fetch's
// latency/host load without any claimed rate limit (F-51). Newest-first per the relay's index order.
const MAX_CAP_DOCS_PER_FETCH = 10;

// Suggested PH land bbox from the spike — NOT geodetically verified (F-51); shapes the outward-port
// Region only (the COUNTRIES coverage gate matches on `iso`, never bbox). Narrower than the CAP PAR.
const PH_REGION: Region = { id: 'ph', bbox: [116.93, 4.59, 126.6, 21.12], iso: 'PH' };

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface WmoSwicAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  /** SWIC source id (WMO_SWIC_SOURCE_ID env; default `ph-pagasa-en`). Also names the index fixture. */
  readonly sourceId?: string;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  readonly maxCapDocsPerFetch?: number;
}

export class WmoSwicAdapter implements SourceAdapterPort<NewsItem>, NewsIntelPort {
  readonly id = ADAPTER_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: ['PH'] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly sourceId: string;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly maxCapDocs: number;

  constructor(deps: WmoSwicAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.sourceId = deps.sourceId ?? DEFAULT_SOURCE_ID;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.maxCapDocs = deps.maxCapDocsPerFetch ?? MAX_CAP_DOCS_PER_FETCH;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<NewsItem>>> {
    return this.engine.run<SwicCapAlert, NewsItem>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: swicCapMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P6). `query` optionally filters the alert set; empty = all alerts. */
  async fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>> {
    const res = await this.fetch(PH_REGION);
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `wmo-swic unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const items = res.value.records.map((r) => r.entity);
    return domainOk({ data: filterNews(items, query), freshness: makeFreshness(res.value.freshness) });
  }

  /** Index → capped link list → per-alert CAP docs. Individual failures tolerated; ALL-fail throws. */
  private async fetchLive(): Promise<readonly SwicCapAlert[]> {
    const indexXml = await this.getText(this.indexUrl(), 'application/rss+xml');
    const { items } = parseSwicIndex(indexXml);
    const links = items.slice(0, this.maxCapDocs).map((i) => i.link);
    if (links.length === 0) return []; // an empty index is a valid "no active alerts" state
    const settled = await Promise.allSettled(links.map((link) => this.fetchCapDoc(link)));
    const alerts = settled.flatMap((s) => (s.status === 'fulfilled' && s.value !== null ? [s.value] : []));
    if (alerts.length === 0) {
      throw makeAdapterError(
        'UPSTREAM_UNAVAILABLE',
        `${ADAPTER_ID}: none of ${links.length} CAP documents could be fetched/parsed`,
        { retryable: true },
      );
    }
    return alerts;
  }

  private async fetchCapDoc(link: string): Promise<SwicCapAlert | null> {
    return parseSwicCap(await this.getText(link, 'application/cap+xml'), link);
  }

  private getText(url: string, accept: string): Promise<string> {
    return httpGetText(url, {
      timeoutMs: this.config.timeoutMs,
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
    });
  }

  private indexUrl(): string {
    return this.config.url ?? `${DEFAULT_RELAY_BASE}/${this.sourceId}/rss.xml`;
  }

  /**
   * Recorded-style mock walks the SAME index→documents pipeline as LIVE: the index fixture
   * `<sourceId>-rss.xml` is parsed, then each item's CAP fixture is loaded by its link basename.
   * A configured-but-absent fixture is a CONFIG failure (fail-fast, T-137), never a silent empty.
   */
  private async loadMock(): Promise<readonly SwicCapAlert[]> {
    const idx = await loadFixtureText(this.fixturesDir, `${this.sourceId}-rss.xml`);
    if (!idx.ok) throw idx.error;
    const { items } = parseSwicIndex(idx.value);
    const alerts: SwicCapAlert[] = [];
    for (const item of items) {
      const doc = await loadFixtureText(this.fixturesDir, fixtureNameFor(item.link));
      if (!doc.ok) throw doc.error;
      const parsed = parseSwicCap(doc.value, item.link);
      if (parsed !== null) alerts.push(parsed);
    }
    return alerts;
  }
}

/** The CAP-document fixture is stored under the link's basename (mirrors the relay's UUID-keyed paths). */
function fixtureNameFor(link: string): string {
  return link.split('/').pop() ?? link;
}

/** Case-insensitive substring filter over title+summary; an empty/blank query returns all items. */
function filterNews(items: readonly NewsItem[], query: string): readonly NewsItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items;
  return items.filter((i) => `${i.title} ${i.summary ?? ''}`.toLowerCase().includes(q));
}

/** Factory: resolve SOURCE_WMO_SWIC_* config + WMO_SWIC_SOURCE_ID from env. Fail-fast (CONFIG). */
export function makeWmoSwicAdapter(
  engine: RedundancyEngine,
  env: Env = process.env,
): AdapterResult<WmoSwicAdapter> {
  const cfg = resolveSourceConfig({ prefix: 'WMO_SWIC', env, defaultMode: 'MOCK' });
  if (!cfg.ok) return cfg;
  const sourceId = env['WMO_SWIC_SOURCE_ID'];
  return ok(
    new WmoSwicAdapter({
      engine,
      config: cfg.value,
      ...(sourceId !== undefined && sourceId !== '' ? { sourceId } : {}),
    }),
  );
}
