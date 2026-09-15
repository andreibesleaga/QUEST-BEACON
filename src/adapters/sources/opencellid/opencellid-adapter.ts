// BEACON — OpenCelliD adapter (E4·T-13x; adapter-contract §6, TelecomPort P13). OpenCelliD area cell-tower
// DB → canonical TelecomCoverage behind the shared redundancy ladder (live → last-known-good cache →
// recorded-mock → unavailable). Implements BOTH the framework SourceAdapterPort<TelecomCoverage> (fetch/
// health) AND the outward domain TelecomPort (fetchCoverage → Sourced), so the application depends only on
// the port, never on OpenCelliD internals.
//
// DATA_SOURCE_VERIFICATION §4 OpenCelliD row: free key, CC BY-SA, crowdsourced gaps, verdict **CACHED**
// (not LIVE) — a keyed, periodically-refreshed crowdsourced tower census, not a real-time feed; the
// default mode reflects that honestly (see opencellid-acl.ts for the fuller honest-limitations note).
// Config-driven: endpoint/mode/key/timeout come from SOURCE_OPENCELLID_* env (key is OPENCELLID_API_KEY).
import { fileURLToPath } from 'node:url';
import { makeAdapterError } from '@/adapters/_shared/errors.js';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { AreaQuery } from '@/ports/data-sources.js';
import type { TelecomCoverage, TelecomPort } from '@/ports/infrastructure-sources.js';
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
import type { OpenCelliDCell } from './opencellid-acl.js';
import { openCelliDMapper, parseOpenCelliDCells } from './opencellid-acl.js';

const OPENCELLID_ID = 'opencellid';
const OPENCELLID_SOURCE = 'OpenCelliD';
const OPENCELLID_LICENSE = 'CC BY-SA (OpenCelliD)';
const DEFAULT_BASE_URL = 'https://opencellid.org/cell/getInArea';
const DEFAULT_LIMIT = 20;
const MOCK_FIXTURE = 'cells.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// A day, not 15 minutes (2026-09-14): cell sites are static infrastructure, and the last-known-good tiles
// must outlive a spent daily budget — with a 900 s TTL the ladder would reach the recording within the hour.
const DEFAULT_CACHE_TTL_SEC = 86_400;

export interface OpenCelliDAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly limit?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
  /** Tiles per region per refresh (`SOURCE_OPENCELLID_MAX_TILES`); default {@link DEFAULT_MAX_TILES}. */
  readonly maxTiles?: number;
  /** Requests per UTC day (`SOURCE_OPENCELLID_DAILY_BUDGET`); default {@link DEFAULT_DAILY_BUDGET}. */
  readonly dailyBudget?: number;
  /** Clock for the daily budget (deterministic tests); default wall clock. */
  readonly now?: () => string;
  /** The ledger the budget is spent from; default = the process-wide ledger of this API key. */
  readonly ledger?: DailyLedger;
}

/**
 * Requests spent per UTC day. ONE ledger per API key for the whole process (the live composition builds an
 * adapter per region, and five regions must not each spend the key's whole day — Copilot, #38).
 */
export class DailyLedger {
  private day = '';
  private requests = 0;
  constructor(readonly limit: number) {}
  spentOn(day: string): number {
    return this.day === day ? this.requests : 0;
  }
  /** Reserve `count` requests on `day`; false when that would exceed the limit (nothing is spent). */
  reserve(day: string, count: number): boolean {
    if (this.day !== day) {
      this.day = day;
      this.requests = 0;
    }
    if (this.requests + count > this.limit) return false;
    this.requests += count;
    return true;
  }
}

const LEDGERS = new Map<string, DailyLedger>();
/** The process-wide ledger for an API key (created with the first adapter's limit). */
export function ledgerFor(apiKey: string, limit: number): DailyLedger {
  let ledger = LEDGERS.get(apiKey);
  if (ledger === undefined) {
    ledger = new DailyLedger(limit);
    LEDGERS.set(apiKey, ledger);
  }
  return ledger;
}
/** Tests only: forget every ledger. */
export function resetLedgers(): void {
  LEDGERS.clear();
}

/**
 * The free OpenCelliD key is metered per day, and 2026-09-14's deploy log showed `429 rate-limited` on a
 * cycle after the focus tiles landed (up to 8 tiles × every focused region × every 5-minute refresh). The
 * adapter now spends at most `dailyBudget` requests per UTC day and, once spent, answers RATE_LIMITED
 * without a request — the ladder then serves the last-known-good tiles until the day turns. Four tiles per
 * region keep the two to four incident clusters that matter inside the budget with the default refresh.
 */
export const DEFAULT_MAX_TILES = 4;
export const DEFAULT_DAILY_BUDGET = 800;

export class OpenCelliDAdapter implements SourceAdapterPort<TelecomCoverage>, TelecomPort {
  readonly id = OPENCELLID_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // crowdsourced, worldwide contributor base (gaps honest-limitation)
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly limit: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;
  private readonly maxTiles: number;
  private readonly now: () => string;
  private readonly ledger: DailyLedger;

  constructor(deps: OpenCelliDAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.limit = deps.limit ?? DEFAULT_LIMIT;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
    this.maxTiles = deps.maxTiles ?? DEFAULT_MAX_TILES;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.ledger =
      deps.ledger ?? ledgerFor(deps.config.apiKey ?? '', deps.dailyBudget ?? DEFAULT_DAILY_BUDGET);
  }

  /** Requests spent today (UTC) on this adapter's key — exposed for tests and the health line. */
  requestsSpentToday(): number {
    return this.ledger.spentOn(this.now().slice(0, 10));
  }

  /** Reserve `count` requests against today's budget, or throw RATE_LIMITED without a request. */
  private reserve(count: number): void {
    const day = this.now().slice(0, 10);
    if (!this.ledger.reserve(day, count)) {
      throw makeAdapterError(
        'RATE_LIMITED',
        `OpenCelliD daily request budget spent (${this.ledger.spentOn(day)} of ${this.ledger.limit} on ${day}); last-known-good served until the day turns`,
        { retryable: true },
      );
    }
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped TelecomCoverage. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<TelecomCoverage>>> {
    return this.engine.run<OpenCelliDCell, TelecomCoverage>({
      adapterId: this.id,
      source: OPENCELLID_SOURCE,
      license: OPENCELLID_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: openCelliDMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P13). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchCoverage(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly TelecomCoverage[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `OpenCelliD unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly OpenCelliDCell[]> {
    const tiles = tilesFor(region, this.maxTiles);
    if (tiles.length === 0) {
      // No request is made: the upstream would answer 400 "BBOX too big" for anything above 4 km², and a
      // region is a million times that. The ladder degrades exactly as it did on the 400, minus the call.
      throw makeAdapterError(
        'UPSTREAM_UNAVAILABLE',
        `OpenCelliD answers at most ${MAX_TILE_KM2} km² per query and no focus area was given for region '${region.id}'`,
      );
    }
    this.reserve(tiles.length);
    const rows: OpenCelliDCell[] = [];
    for (const tile of tiles) {
      const json = await httpGetText(this.buildUrl({ ...region, bbox: tile }), {
        timeoutMs: this.config.timeoutMs,
      });
      rows.push(...parseOpenCelliDCells(json).rows);
    }
    return rows;
  }

  private async loadMock(): Promise<readonly OpenCelliDCell[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseOpenCelliDCells(res.value).rows;
  }

  /**
   * OpenCelliD `cell/getInArea`: BBOX is `latmin,lonmin,latmax,lonmax` — the REVERSE axis order from the
   * BEACON internal `Region.bbox` (`[minLon,minLat,maxLon,maxLat]`, WGS-84). Converted here, at the edge,
   * so no other layer needs to know OpenCelliD's axis convention.
   */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const key = this.config.apiKey ?? '';
    const [west, south, east, north] = region.bbox;
    return `${base}?key=${encodeURIComponent(key)}&BBOX=${south},${west},${north},${east}&format=json&limit=${this.limit}`;
  }
}

/** OpenCelliD's documented area cap for `cell/getInArea` ("BBOX too big - Limit to 4,000,000 sq.mts."). */
export const MAX_TILE_KM2 = 4;
/** Half the side of one tile, in km: a 1.9 km square stays under the cap with margin for the projection. */
const TILE_HALF_KM = 0.95;
const KM_PER_DEG_LAT = 111.32;

/**
 * The boxes actually sent upstream (ADR-045). With a focus: one ~1.9 km square centred on each focus box —
 * the cells around each incident, which is the coverage question the COP asks. Without one: the bbox itself
 * when it fits under the cap, else nothing (the caller degrades). Pure and exported for the tests.
 */
export function tilesFor(
  region: Region,
  maxTiles: number = DEFAULT_MAX_TILES,
): readonly Region['bbox'][] {
  const focus = region.focus ?? [];
  if (focus.length > 0) return focus.slice(0, Math.max(1, Math.floor(maxTiles))).map(tileAround);
  return areaKm2(region.bbox) <= MAX_TILE_KM2 ? [region.bbox] : [];
}

function tileAround([west, south, east, north]: Region['bbox']): Region['bbox'] {
  const lon = (west + east) / 2;
  const lat = (south + north) / 2;
  const dLat = TILE_HALF_KM / KM_PER_DEG_LAT;
  const dLon = TILE_HALF_KM / (KM_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

function areaKm2([west, south, east, north]: Region['bbox']): number {
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  return (east - west) * KM_PER_DEG_LAT * Math.cos(midLat) * ((north - south) * KM_PER_DEG_LAT);
}

/** Factory: resolve SOURCE_OPENCELLID_* config from env and construct the adapter. Fail-fast on bad config. */
export function makeOpenCelliDAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<OpenCelliDAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'OPENCELLID',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: 'OPENCELLID_API_KEY',
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return {
    ok: true,
    value: new OpenCelliDAdapter({
      engine,
      config: cfg.value,
      ...knob(env.SOURCE_OPENCELLID_MAX_TILES, 'maxTiles'),
      ...knob(env.SOURCE_OPENCELLID_DAILY_BUDGET, 'dailyBudget'),
    }),
  };
}

/** A positive integer knob from the environment, or nothing (the default applies); never a bad value. */
function knob(
  raw: string | undefined,
  name: 'maxTiles' | 'dailyBudget',
): Partial<Pick<OpenCelliDAdapterDeps, 'maxTiles' | 'dailyBudget'>> {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n > 0 ? { [name]: n } : {};
}
