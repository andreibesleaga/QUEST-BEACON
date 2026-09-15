// BEACON — OSM Overpass adapter (E4·osm-overpass; adapter-contract §6, InfrastructurePort P4). This is
// the FIRST implementation of InfrastructurePort: Overpass API node elements (hospitals, fire stations,
// power substations, communication masts) -> canonical InfrastructureNode behind the shared redundancy
// ladder (live -> last-known-good cache -> recorded-mock -> unavailable). Implements BOTH the framework
// SourceAdapterPort<InfrastructureNode> (fetch/health) AND the outward domain InfrastructurePort
// (fetchNodes -> Sourced), so the application depends only on the port, never on Overpass internals.
//
// DATA_SOURCE_VERIFICATION §4 (OSM Overpass row): free but RATE-LIMITED public instances, GLOBAL
// coverage, ODbL (attribution required) -> defaultMode is CACHED (not LIVE/MOCK like FIRMS/GDACS): the
// upstream is live-capable but must be cached aggressively rather than hit on every request. Config-driven:
// endpoint/mode/timeout from SOURCE_OSM_OVERPASS_* env (prefix OSM_OVERPASS); no API key required
// (Overpass is keyless).
//
// MIRROR LADDER (V2 WP-A10). Overpass is served by several INTERCHANGEABLE public instances, and the busy
// primary is the one most likely to be rate-limiting exactly when a disaster drives everyone to it. The
// live rung therefore walks an ORDERED mirror list, config-only (`SOURCE_OSM_OVERPASS_MIRRORS`, comma-
// separated), and the endpoint that ACTUALLY answered is stamped into the SourceRecord (see
// `mirrorSourceLabel`) — provenance must never claim a fetch came from an endpoint that did not serve it.
//   * Unset ⇒ the ladder is exactly ONE endpoint: `SOURCE_OSM_OVERPASS_URL` if set, else DEFAULT_BASE_URL.
//     Adding mirrors is an explicit operator decision (a third-party endpoint must never be contacted by
//     default), so the shipped default behaviour is byte-identical to the pre-A10 single-endpoint adapter.
//   * Set ⇒ that list IS the ladder, in order, and it SUPERSEDES `SOURCE_OSM_OVERPASS_URL`. Entries are
//     validated as absolute http(s) URLs at boot (fail-fast CONFIG) and de-duplicated.
//   * The whole ladder runs INSIDE one `fetchLive` call, i.e. inside the EXISTING circuit breaker +
//     retry/timeout policy: a fully failed ladder is ONE breaker failure, not one per mirror, so the
//     breaker still opens after `failureThreshold` genuinely bad fetches. Every mirror failure mode
//     falls through to the next rung — HTTP status (429/5xx/timeout/redirect) AND a 200 carrying an
//     unparseable body (an overload/error page), which is the shape a busy Overpass mirror actually
//     returns. Only when EVERY mirror has failed does the engine degrade to cache -> recorded mock.
//   * LATENCY BOUND (documented, deliberately not capped): worst case per live attempt is
//     mirrors × SOURCE_OSM_OVERPASS_TIMEOUT_MS (default 8 s), re-run up to `maxRetries` times by the
//     breaker's retry policy and hard-stopped by its backstop timeout. Keep the list SHORT (<= 3) —
//     it is a redundancy ladder, not a fan-out.
import { fileURLToPath } from 'node:url';
import type { InfrastructureNode, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { InfrastructurePort } from '@/ports/infrastructure-sources.js';
import type { AreaQuery } from '@/ports/data-sources.js';
import type {
  AdapterHealth,
  AdapterResult,
  BreakerConfig,
  Coverage,
  FetchResult,
  AdapterError,
  Region,
  RedundancyEngine,
  SourceAdapterPort,
  SourceConfig,
  SourceMode,
} from '@/adapters/_shared/index.js';
import {
  classify,
  err,
  httpGetText,
  loadFixtureText,
  makeAdapterError,
  ok,
  resolveSourceConfig,
} from '@/adapters/_shared/index.js';
import type { OsmOverpassElement } from './osm-overpass-acl.js';
import { osmOverpassMapper, parseOverpassElements } from './osm-overpass-acl.js';

const OSM_ID = 'osm-overpass';
const OSM_SOURCE = 'OSM Overpass';
// ODbL requires attribution + share-alike (DATA_SOURCE_VERIFICATION §4). This exact string is stamped
// into every SourceRecord.license this adapter produces, so the ODbL attribution ask stays visible
// wherever provenance is rendered (UI/NOTICE), never buried.
const OSM_LICENSE = '© OpenStreetMap contributors (ODbL)';
const DEFAULT_BASE_URL = 'https://overpass-api.de/api/interpreter';
/**
 * The public Overpass instances answer `406 Not Acceptable` to a request that carries no descriptive
 * User-Agent (verified 2026-09-15 against overpass-api.de and lz4.overpass-api.de: Node's default fetch →
 * 406; the same query with this header → 200), and the OSM usage policy asks every client to identify
 * itself. Operators override it with SOURCE_OSM_OVERPASS_USER_AGENT (a contact address is the polite form).
 */
export const DEFAULT_USER_AGENT =
  'BEACON/1.0 (open-source emergency COP; +https://github.com/andreibesleaga/QUEST-BEACON)';
const MOCK_FIXTURE = 'elements.json';
const QUERY_TIMEOUT_SEC = 25;

// Node-only filters (lean demo). Each is a defensible, documented tag set (see osm-overpass-acl.ts header
// for the reasoning behind exactly these four types + why fire_station is fetched but not mapped):
//   amenity=hospital                          -> candidate HOSPITAL
//   amenity=fire_station                       -> fetched for coverage awareness; ACL skips it (no honest type)
//   power=substation                           -> candidate POWER
//   man_made=mast + tower:type=communication   -> candidate CELL (explicit comms tower)
//   man_made=mast + any "communication" key    -> candidate CELL (OSM wiki Key:communication convention)
const NODE_FILTERS = [
  '["amenity"="hospital"]',
  '["amenity"="fire_station"]',
  '["power"="substation"]',
  '["man_made"="mast"]["tower:type"="communication"]',
  '["man_made"="mast"]["communication"]',
] as const;

/** Build the Overpass QL body for a bbox. Overpass bbox order is (south,west,north,east) — NOT the
 * domain BBox order [minLon,minLat,maxLon,maxLat] — so the axes are swapped here, once, in one place. */
export function buildOverpassQuery(bbox: Region['bbox'], focus?: Region['focus']): string {
  // ADR-045 — a region-sized query (every hospital, substation and mast in California) does not return
  // inside any Overpass timeout; the lifeline nodes that matter are the ones near the incidents, so the
  // focus boxes are queried instead when the composition supplies them.
  const boxes = focus !== undefined && focus.length > 0 ? focus : [bbox];
  const clauses = boxes
    .map(([west, south, east, north]) => {
      const bboxStr = `${south},${west},${north},${east}`;
      return NODE_FILTERS.map((filter) => `node${filter}(${bboxStr});`).join('');
    })
    .join('');
  return `[out:json][timeout:${QUERY_TIMEOUT_SEC}];(${clauses});out body;`;
}

/**
 * The client deadline must outlive the deadline we ask the SERVER for, or we never hear the answer.
 *
 * The shared default is 8 s, and the query above asks Overpass for 25 s. So the client aborted first,
 * every single time, and the live log read `network/timeout: fetch failed` for a query the server was
 * still perfectly willing to answer — we hung up on it. Measured against overpass-api.de on 2026-09-12:
 * a single filter over California takes 10-20 s, and the full five-filter union exceeds the 25 s budget
 * and comes back as a `remark` (which `parseOverpassElements` now refuses rather than reading as an
 * empty state). 30 s leaves the server its full budget plus the round trip, and no more: this call sits
 * inside a composition with its own deadline, so the cache rung is the right answer past that.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// Rate-limited upstream (DATA_SOURCE_VERIFICATION §4) -> cache aggressively; longer TTL than FIRMS/GDACS.
const DEFAULT_CACHE_TTL_SEC = 3600;

export interface OsmOverpassAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  /** Ordered mirror ladder (A10). Omitted/empty ⇒ the single configured endpoint (config.url ?? default). */
  readonly mirrors?: readonly string[];
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  /** User-Agent sent to every mirror (defaults to DEFAULT_USER_AGENT — the instances refuse an anonymous client). */
  readonly userAgent?: string;
}

/** Per-fetch slot recording which mirror served the live rung (see `fetch` for why it is per-CALL). */
interface MirrorAttempt {
  answeredBy?: string;
}

export class OsmOverpassAdapter
  implements SourceAdapterPort<InfrastructureNode>, InfrastructurePort
{
  readonly id = OSM_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // public Overpass instances mirror the whole OSM planet
  readonly mode: SourceMode;
  /** The resolved ladder, in order — always at least one endpoint. Read by tests + operators. */
  readonly mirrors: readonly string[];

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly userAgent: string;

  constructor(deps: OsmOverpassAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.mirrors =
      deps.mirrors !== undefined && deps.mirrors.length > 0
        ? deps.mirrors
        : [deps.config.url ?? DEFAULT_BASE_URL];
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.userAgent =
      deps.userAgent !== undefined && deps.userAgent !== '' ? deps.userAgent : DEFAULT_USER_AGENT;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped InfrastructureNode. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<InfrastructureNode>>> {
    // ONE attempt slot per fetch() call — never a field on the adapter: two concurrent fetches (two
    // regions on the same instance) must not stamp each other's provenance with the wrong mirror.
    const attempt: MirrorAttempt = {};
    return this.engine.run<OsmOverpassElement, InfrastructureNode>({
      adapterId: this.id,
      // A GETTER, not a value: the engine stamps provenance AFTER fetchLive resolves (redundancy.ts
      // tryLive), so by the time this is read the ladder knows which mirror answered. The cache/mock
      // rungs read it too — with no live answer it evaluates to the bare source name, never a guess.
      get source(): string {
        return mirrorSourceLabel(attempt.answeredBy);
      },
      license: OSM_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: osmOverpassMapper,
      fetchLive: (r) => this.fetchLive(r, attempt),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P4). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchNodes(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly InfrastructureNode[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `OSM Overpass unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  /** Walk the mirror ladder in order; the FIRST endpoint that returns a parseable body wins and is
   * recorded in `attempt`. Throws a typed AdapterError naming every failure only when all rungs fail. */
  private async fetchLive(
    region: Region,
    attempt: MirrorAttempt,
  ): Promise<readonly OsmOverpassElement[]> {
    const query = buildOverpassQuery(region.bbox, region.focus);
    const failures: string[] = [];
    let lastError: unknown;
    for (const mirror of this.mirrors) {
      try {
        const json = await httpGetText(mirrorUrl(mirror, query), {
          timeoutMs: this.config.timeoutMs,
          headers: { 'user-agent': this.userAgent },
        });
        const elements = parseOverpassElements(json); // a 200 carrying garbage fails HERE -> next mirror
        attempt.answeredBy = mirror;
        return elements;
      } catch (e) {
        lastError = e;
        failures.push(`${mirror}: ${classify(e).message}`);
      }
    }
    throw ladderError(failures, lastError);
  }

  private async loadMock(): Promise<readonly OsmOverpassElement[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseOverpassElements(res.value);
  }
}

/** GET {mirror}?data=<urlencoded Overpass QL> — the same query is sent to every rung of the ladder. */
function mirrorUrl(mirror: string, query: string): string {
  return `${mirror}?data=${encodeURIComponent(query)}`;
}

/** `OSM Overpass (host)` once a mirror has answered, else the bare name. This is the ONLY channel the
 * answering endpoint has into provenance — SourceRecord has no endpoint field — so it must never throw
 * (a hand-constructed, unparseable mirror string degrades to the bare name rather than losing the record). */
function mirrorSourceLabel(mirror: string | undefined): string {
  if (mirror === undefined) return OSM_SOURCE;
  const host = mirrorHost(mirror);
  return host === undefined ? OSM_SOURCE : `${OSM_SOURCE} (${host})`;
}

/** Parse an endpoint ONCE; `undefined` for anything WHATWG-URL rejects. Both helpers below build on it. */
function parseMirror(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

function mirrorHost(raw: string): string | undefined {
  const url = parseMirror(raw);
  return url === undefined || url.host === '' ? undefined : url.host;
}

/** An endpoint is usable only if it is ABSOLUTE, http(s) and has a host — `javascript:`/`ftp:`/a bare
 * hostname are all rejected at boot rather than becoming a silently dead rung of the ladder. */
function isHttpUrl(raw: string): boolean {
  const url = parseMirror(raw);
  if (url === undefined || url.host === '') return false;
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/** One typed failure naming EVERY mirror that was tried, carrying the last rung's kind/retryability so
 * the breaker + `AdapterHealth.lastError` stay as informative as they were with a single endpoint. */
function ladderError(failures: readonly string[], lastError: unknown): AdapterError {
  const last = classify(lastError);
  return makeAdapterError(
    last.kind,
    `${OSM_ID}: all ${failures.length} mirror(s) failed — ${failures.join(' | ')}`,
    { retryable: last.retryable, cause: lastError },
  );
}

/** Split SOURCE_OSM_OVERPASS_MIRRORS ("url1,url2,…") into an ordered, de-duplicated ladder.
 * Fail-fast (CONFIG) per the 12-factor config law (AGENTS.md §14 — config is validated at boot): a typo
 * must surface at boot, never silently shorten the ladder mid-incident. Unset/blank ⇒ [] = "no ladder
 * configured", and the caller keeps the single configured endpoint. */
export function parseMirrorsEnv(raw: string | undefined): AdapterResult<readonly string[]> {
  if (raw === undefined || raw.trim() === '') return ok([]);
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (entries.length === 0) {
    return err(
      makeAdapterError('CONFIG', 'SOURCE_OSM_OVERPASS_MIRRORS lists no usable URL', {
        retryable: false,
      }),
    );
  }
  const mirrors: string[] = [];
  for (const entry of entries) {
    if (!isHttpUrl(entry)) {
      return err(
        makeAdapterError(
          'CONFIG',
          `SOURCE_OSM_OVERPASS_MIRRORS invalid endpoint: '${entry}' (absolute http(s) URL required)`,
          { retryable: false },
        ),
      );
    }
    if (!mirrors.includes(entry)) mirrors.push(entry); // a repeated mirror would just burn the timeout twice
  }
  return ok(mirrors);
}

/** Factory: resolve SOURCE_OSM_OVERPASS_* config from env and construct the adapter. Fail-fast on bad config.
 * defaultMode CACHED (never LIVE/MOCK by default) — rate-limited upstream, cache aggressively (Art. XVI). */
export function makeOsmOverpassAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<OsmOverpassAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'OSM_OVERPASS',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (!cfg.ok) return cfg;
  const mirrors = parseMirrorsEnv(env.SOURCE_OSM_OVERPASS_MIRRORS);
  if (!mirrors.ok) return mirrors;
  return {
    ok: true,
    value: new OsmOverpassAdapter({
      engine,
      config: cfg.value,
      mirrors: mirrors.value,
      ...(env.SOURCE_OSM_OVERPASS_USER_AGENT !== undefined
        ? { userAgent: env.SOURCE_OSM_OVERPASS_USER_AGENT }
        : {}),
    }),
  };
}
