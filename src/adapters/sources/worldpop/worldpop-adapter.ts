// BEACON — WorldPop adapter (E4·T-worldpop; adapter-contract §6, PopulationPort P12). WorldPop "stats"
// API (dataset=wpgppop, gridded modeled population) → canonical PopulationEstimate behind the shared
// redundancy ladder (live → last-known-good cache → recorded-mock → unavailable). Implements BOTH the
// framework SourceAdapterPort<PopulationEstimate> (fetch/health) AND the outward domain PopulationPort
// (estimatePopulation → Sourced), so the application depends only on the port, never on WorldPop internals.
//
// DATA_SOURCE_VERIFICATION.md (population row, ~line 85): free, CC BY 4.0, GLOBAL coverage, modeled
// population grids → verdict CACHED. WorldPop grids are MODELED, not measured/real-time, so the honest
// default is CACHED (Art. XVI — degradation is always labeled, never a dead-end). Config-driven:
// endpoint/mode/timeout from SOURCE_WORLDPOP_* env. No API key is required (keyless public stats API).
//
// VERIFIED LIVE (2026-07-15, curl against https://api.worldpop.org):
//   The documented/observed default behavior is ASYNC — a GET to the stats endpoint with a `geojson`
//   Polygon returns a task handle immediately, and the caller must poll `GET /v1/tasks/{taskid}` until
//   `status:"finished"`. Verified round-trip:
//     submit -> curl '.../v1/services/stats?dataset=wpgppop&year=2020&geojson=<Polygon>'
//            -> {"status":"created","taskid":"37be02d5-92ea-58da-9b5f-f3a8b090939f", ...}
//     poll   -> curl '.../v1/tasks/37be02d5-92ea-58da-9b5f-f3a8b090939f'
//            -> {"status":"finished","data":{"total_population":103437.78}, ...}
//   The API ALSO accepts (verified live) a `runasync=false` query param that runs the SAME job
//   synchronously in one HTTP round-trip:
//     curl '.../v1/services/stats?dataset=wpgppop&year=2020&runasync=false&geojson=<Butte-County-ish
//           Polygon [-121.9,39.4,-121.35,39.85]>'
//     -> {"status":"started","data":{"total_population":215182.79}, ...}   (recorded verbatim as the
//        MOCK_FIXTURE below — a real recorded live response, not hand-crafted)
//   The live rung used `runasync=false` for exactly that reason — one resilient-http call, no polling loop.
//
// CORRECTED 2026-09-12, from the live log (`PARSE: ... missing/invalid data.total_population: undefined`).
// `runasync=false` is BEST-EFFORT, not a guarantee, and what decides it is the size of the question.
// Re-verified against the live API that day:
//   county-sized polygon + runasync=false -> 200 in ~6 s WITH `data.total_population` (unchanged)
//   California's bbox   + runasync=false -> 200 after 40 s with `{status:"started", taskid}` and NO data
//   the same bbox submitted async         -> the task finishes in ~12 s with
//       `error:true, "The requested area was too large. Requested 964477.28 km^2 but allowance was 100000."`
// So the adapter now submits ASYNC and follows the task (bounded, see `awaitTask`). Two things follow.
// It is FASTER, because 40 s of a composition budget is no longer spent on a call that then fails; and the
// operator is told the truth — WorldPop's 100,000 km² allowance means this source answers INCIDENT-sized
// polygons, not region-sized bboxes, so at region scale it degrades (labelled) and the region's population
// comes from the sources built for that scale (`census` for US, `hdxpop` for RO).
// The bbox is sent as a closed GeoJSON Polygon built from the four corners of the queried Region.bbox.
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { BBox } from '@/domain/value-objects/geo.js';
import { bboxAreaKm2 } from '@/domain/value-objects/geo.js';
import type { Sourced } from '@/ports/infra.js';
import type { PopulationPort, PopulationEstimate } from '@/ports/infrastructure-sources.js';
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
  err,
} from '@/adapters/_shared/index.js';
import type { WorldPopRaw, WorldPopStatsBody } from './worldpop-acl.js';
import { worldPopMapper, parseWorldPopResponse } from './worldpop-acl.js';

const WORLDPOP_ID = 'worldpop';
const WORLDPOP_SOURCE = 'WorldPop';
const WORLDPOP_LICENSE = 'CC BY 4.0';
const DEFAULT_BASE_URL = 'https://api.worldpop.org/v1/services/stats';
const DEFAULT_DATASET = 'wpgppop';
const DEFAULT_YEAR = 2020;
const MOCK_FIXTURE = 'population.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// Modeled population grids change rarely (annual releases) — a much longer TTL than fast-moving hazards.
const DEFAULT_CACHE_TTL_SEC = 21600;
// A WorldPop task for a county-sized polygon finishes in ~6-12 s (measured 2026-09-12). The deadline is
// deliberately close to that: this runs inside a composition with its own budget, and a population figure
// that arrives a minute late is a figure the cached rung would have served instantly and honestly.
/** WorldPop's own allowance for one stats task, quoted verbatim by its refusal: "allowance was 100000". */
export const WORLDPOP_MAX_AREA_KM2 = 100_000;
const DEFAULT_TASK_WAIT_MS = 25_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export interface WorldPopAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly dataset?: string;
  readonly year?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  /** How long to follow an async task before degrading (ms). Injected by tests; never awaits a real clock. */
  readonly taskWaitMs?: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class WorldPopAdapter implements SourceAdapterPort<PopulationEstimate>, PopulationPort {
  readonly id = WORLDPOP_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // WorldPop grids cover every country
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly dataset: string;
  private readonly year: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly taskWaitMs: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: WorldPopAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.dataset = deps.dataset ?? DEFAULT_DATASET;
    this.year = deps.year ?? DEFAULT_YEAR;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.taskWaitMs = deps.taskWaitMs ?? DEFAULT_TASK_WAIT_MS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Framework port: walk the full redundancy ladder, returning a provenance-stamped PopulationEstimate. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<PopulationEstimate>>> {
    // A region-sized bbox is a question WorldPop has told us it refuses (header, and the live log on
    // 2026-09-13: five regions, five "area was too large"). Asking anyway costs a submit, a poll and a
    // refusal per region — ~12 s each. It is refused HERE, before the ladder, and not demoted onto it:
    // a CACHED rung with a cold cache falls through to the recorded mock — a Butte County figure stamped
    // with this region's bbox — and the region's real or seeded count would be replaced by it under a
    // MOCK label (review, PR #29). That holds for the documented CACHED default exactly as for LIVE, so
    // both refuse; only an EXPLICIT `SOURCE_WORLDPOP_MODE=mock` — the operator asking for the fixture —
    // still serves it. NOT_COVERED is the honest answer: this source does not cover a question this size,
    // so the slice is skipped and not cited. Incident-sized polygons are unaffected.
    const areaKm2 = bboxAreaKm2(region.bbox);
    if (this.mode !== 'MOCK' && areaKm2 > WORLDPOP_MAX_AREA_KM2) {
      return Promise.resolve(
        err(
          makeAdapterError(
            'NOT_COVERED',
            `${this.id}: a ${Math.round(areaKm2).toLocaleString('en-US')} km² bbox exceeds WorldPop's ${WORLDPOP_MAX_AREA_KM2.toLocaleString('en-US')} km² per-task allowance; incident-sized polygons only`,
            { retryable: false },
          ),
        ),
      );
    }
    return this.engine.run<WorldPopRaw, PopulationEstimate>({
      adapterId: this.id,
      source: WORLDPOP_SOURCE,
      license: WORLDPOP_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: worldPopMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(region),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P12). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async estimatePopulation(area: BBox): Promise<Result<Sourced<PopulationEstimate>, DomainError>> {
    // The region id is the last-known-good cache key's tail (`lkg:worldpop:<id>`). A fixed 'query' id
    // would make every area share one entry, so a county-sized answer that warmed the cache could later
    // be served for a different area (review, PR #29). The bbox IS the question, so it is the key — at
    // full precision, because two areas ~11 m apart are still two areas.
    const region: Region = { id: `query:${area.map(String).join(',')}`, bbox: area };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `WorldPop unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const entity = res.value.records[0]?.entity;
    if (entity === undefined) {
      return domainErr(new DomainError('NOT_FOUND', 'WorldPop: no population estimate returned'));
    }
    return domainOk({ data: entity, freshness: makeFreshness(res.value.freshness) });
  }

  /**
   * Live rung: submit the job, then follow the task to its answer.
   *
   * WHY THIS IS NO LONGER ONE CALL (2026-09-12). The live log read
   * `PARSE: WorldPop response missing/invalid data.total_population: undefined`, and the cause was not a
   * changed response shape — it was the SIZE of the question. Verified against api.worldpop.org that day:
   * `runasync=false` runs the job inline only while it is small enough. Asked for a county-sized polygon
   * it still answers in one round trip with `data.total_population`; asked for California's bbox it spends
   * 40 seconds and then hands back a bare `{status:"started", taskid}` — no data, exactly what the parser
   * reported. The synchronous mode is best-effort on WorldPop's side, not a guarantee.
   *
   * So the job is now submitted ASYNCHRONOUSLY and the task is polled until it finishes. That is both
   * correct and faster: the submit returns immediately instead of burning 40 s of a 300 s composition
   * budget before failing. A response that already carries the answer is returned untouched, so a small
   * query and the recorded fixture both still take exactly one step.
   */
  private async fetchLive(region: Region): Promise<readonly WorldPopRaw[]> {
    const text = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    const body = await this.awaitTask(parseWorldPopResponse(text));
    return [{ ...body, bbox: region.bbox }];
  }

  /**
   * Poll `GET /v1/tasks/{id}` until the job finishes, or give up with a typed, retryable error.
   *
   * Bounded on purpose: a poll that can run forever is a composition that can hang, so the deadline is
   * explicit and expiry degrades the ladder (live → cache → mock) exactly as any other upstream failure
   * does. A task that finishes with `error: true` is returned as-is rather than thrown here — the ACL
   * turns it into a PARSE error carrying WorldPop's OWN message, which is how the operator gets told
   * "the requested area was too large. Requested 964477.28 km^2 but allowance was 100000" instead of a
   * sentence about an undefined field.
   */
  private async awaitTask(body: WorldPopStatsBody): Promise<WorldPopStatsBody> {
    if (hasPopulation(body) || body.error === true) return body;
    const taskId = body.taskid;
    if (taskId === undefined || taskId === '') return body; // no answer and no handle — the ACL says so
    const url = taskUrl(this.config.url ?? DEFAULT_BASE_URL, taskId);
    const deadline = Date.now() + this.taskWaitMs;
    let latest = body;
    while (Date.now() < deadline) {
      await this.sleep(this.pollIntervalMs);
      latest = parseWorldPopResponse(await httpGetText(url, { timeoutMs: this.config.timeoutMs }));
      if (hasPopulation(latest) || latest.error === true) return latest;
    }
    throw makeAdapterError(
      'UPSTREAM_UNAVAILABLE',
      `WorldPop task ${taskId} did not finish within ${this.taskWaitMs}ms`,
      { retryable: true },
    );
  }

  /** Mock rung: the recorded fixture is the wire body only; the queried bbox is stitched on here. */
  private async loadMock(region: Region): Promise<readonly WorldPopRaw[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    const body = parseWorldPopResponse(res.value);
    return [{ ...body, bbox: region.bbox }];
  }

  /**
   * WorldPop stats endpoint: dataset + year + a closed GeoJSON Polygon built from the queried bbox's four
   * corners (WGS-84). The API does not accept a raw bbox param — geojson is required. `runasync=false` is
   * deliberately NOT sent any more (see the file header): it made the server spend up to 40 s trying to
   * answer inline before handing back a task handle anyway.
   */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const params = new URLSearchParams({
      dataset: this.dataset,
      year: String(this.year),
      geojson: JSON.stringify(bboxToPolygonGeoJson(region.bbox)),
    });
    return `${base}?${params.toString()}`;
  }
}

/** Did the job actually produce a number? `null` data is WorldPop's shape for "not yet". */
function hasPopulation(body: WorldPopStatsBody): boolean {
  return typeof body.data?.total_population === 'number';
}

/**
 * The task endpoint that belongs to a given stats endpoint. Derived from the configured URL rather than
 * hardcoded, so a mirror or a pinned host keeps both halves of the conversation on the same server.
 */
export function taskUrl(statsUrl: string, taskId: string): string {
  const swapped = statsUrl.replace(/\/services\/stats\/?$/, '/tasks');
  const base = swapped === statsUrl ? `${trimSlash(statsUrl)}/../tasks` : swapped;
  return `${trimSlash(base)}/${encodeURIComponent(taskId)}`;
}

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

interface Polygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
}

/** [minLon,minLat,maxLon,maxLat] → a closed GeoJSON Polygon ring (5 points, WGS-84, deterministic). */
function bboxToPolygonGeoJson(bbox: BBox): Polygon {
  const [west, south, east, north] = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

/** Factory: resolve SOURCE_WORLDPOP_* config from env. Fail-fast on bad config. No API key required. */
export function makeWorldPopAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<WorldPopAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'WORLDPOP',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new WorldPopAdapter({ engine, config: cfg.value }) };
}
