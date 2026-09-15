// BEACON — FEMA ESF#6 Shelter System adapter (WP A4; adapter-contract §6, ShelterDirectoryPort P18).
// FEMA's National Shelter System, served live by FEMA's public ArcGIS MapServer, → canonical `Shelter`
// behind the shared redundancy ladder (live → last-known-good cache → recorded-mock → unavailable).
// Implements BOTH the framework SourceAdapterPort<Shelter> (fetch/health) AND the outward domain
// ShelterDirectoryPort (fetchShelters → Sourced), so the application depends only on the port, never on
// ArcGIS internals. Registered as one manifest row + one factory entry: zero core change.
//
// ── WHY THIS IS A LIVE SOURCE AND NOT A SEED
// A4 originally proposed SEEDING shelters from published lists. Research (docs/audit/
// V2-A4-SEED-SOURCING-2026-09-10.md) found real, citable data for California and Romania and none for
// Spain, Greece or the Philippines, and refused to invent the rest. Shelters are not a static roster:
// they open and close during an event. A seed frozen on the day it was written would be stale the moment
// a shelter opened — so California reads the feed at demo time and shows what FEMA is publishing THEN,
// including shelters that open during a real incident. The evidence for that being the right call is in
// the feed itself: the A4 research recorded ZERO open California shelters on 2026-09-10; re-probing the
// same service on 2026-09-11 returned ONE (shelter_id 341375, Lake County Fairgrounds, Lakeport). A seed
// would have missed it.
//
// ── WHAT THE FEED ACTUALLY SAYS TODAY, AND WHY THE PRODUCT MUST NOT PRETTIFY IT (2026-09-11, live)
//   • California: 1 OPEN, 6,887 CLOSED, 0 FULL, 1 ALERT. Every closed record's shelter_status_code is
//     literally 'CLOSED' — the distinct-value query returns exactly that one value.
//   • So the honest California picture is a map of CLOSED shelters with ONE open destination on it, and
//     that destination publishes the 99999 capacity placeholder (⇒ capacity unknown ⇒ ineligible for
//     capacity matching). A CLOSED shelter renders CLOSED; closed shelters are never filtered out to make
//     the map look busier, and an uncounted capacity is never filled in with a number (see the ACL).
//   • That is a legitimate operational state: outside an active mass-care activation, a shelter system IS
//     closed. A COP that showed it otherwise would be lying about where evacuees can go.
//
// ── HONEST LIMITATION — THE PER-LAYER CAP. The closed layer is national and enormous (6,887 CA records
// alone, against a service maxRecordCount of 4000). One fetch therefore takes a BOUNDED page per layer
// (`SOURCE_SHELTERS_FEMA_MAX_PER_LAYER`, default 200), ordered by `shelter_id` so the page is deterministic
// rather than arbitrary-by-chance. The consequence must be stated wherever this layer is shown: for a
// wide region the closed list is a SAMPLE, not the complete register. Open and Full — the layers an
// operator acts on — are small enough that the cap does not bite (1 and 0 in CA today).
//
// Config-driven: endpoint/mode/timeout/layer-ids/page-size from SOURCE_SHELTERS_FEMA_* env (12-factor;
// nothing hardcoded). Keyless — the service is public and needs no credential (verified 2026-09-11).
import { fileURLToPath } from 'node:url';
import type { Result, Shelter } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { AreaQuery } from '@/ports/data-sources.js';
import type { ShelterDirectoryPort } from '@/ports/logistics.js';
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
  err,
  httpGetText,
  loadFixtureText,
  makeAdapterError,
  ok,
  resolveSourceConfig,
} from '@/adapters/_shared/index.js';
import type { FemaShelterLayer, FemaShelterRaw } from './shelters-fema-acl.js';
import {
  FEMA_SHELTER_LAYERS,
  SHELTER_OUT_FIELDS,
  femaShelterMapper,
  parseFemaShelterLayer,
} from './shelters-fema-acl.js';

const SHELTERS_FEMA_ID = 'shelters-fema';
const SHELTERS_FEMA_SOURCE = 'FEMA ESF#6 Shelter System';
/**
 * A US federal government work is not subject to domestic copyright (17 U.S.C. §105); the service's own
 * `copyrightText` names three parties, and all three are credited because FEMA says so — we do not get to
 * shorten an attribution the publisher printed.
 */
const SHELTERS_FEMA_LICENSE =
  'US public domain (17 U.S.C. §105) — FEMA, Mass Care, American Red Cross';

/** Verified live 2026-09-11: HTTP/2 200, `f=json`, keyless, `access-control-allow-origin: *`. */
const DEFAULT_BASE_URL = 'https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/MapServer';
const US_ISO = 'US';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
/**
 * 15 minutes. Shelter status is the one thing on this feed that moves during an incident, so the
 * last-known-good window is short: an hours-old "OPEN" would be a freshness claim the data cannot support.
 */
const DEFAULT_CACHE_TTL_SEC = 900;
const DEFAULT_MAX_PER_LAYER = 200;

/**
 * Recorded live responses (2026-09-11), replayed by the SAME ACL as the live rung. The set is deliberately
 * mixed so the offline path exercises every branch the live path can take AND so region scoping is a real
 * test rather than a no-op:
 *   • `open-shelters-national.json`     — the WHOLE national open layer: 13 records across 7 states,
 *                                         including the single open California one and the six-plus rows
 *                                         that publish an occupancy with no capacity.
 *   • `closed-shelters-butte-ca.json`   — 25 closed shelters in the Butte-County wildfire demo footprint,
 *                                         with real published capacities and the operating Red Cross chapter.
 *   • `full-shelters-national.json`     — the Full layer, which is genuinely EMPTY. An honest zero is a
 *                                         recorded response too; inventing a full shelter to "exercise the
 *                                         branch" is exactly the fabrication this WP exists to prevent.
 */
const MOCK_FIXTURES = [
  'open-shelters-national.json',
  'closed-shelters-butte-ca.json',
  'full-shelters-national.json',
] as const;

export interface SheltersFemaAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  /** NSS layers to query (from SOURCE_SHELTERS_FEMA_LAYERS). */
  readonly layers?: readonly FemaShelterLayer[];
  readonly maxPerLayer?: number;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class SheltersFemaAdapter implements SourceAdapterPort<Shelter>, ShelterDirectoryPort {
  readonly id = SHELTERS_FEMA_ID;
  /**
   * FEMA's National Shelter System covers the United States and nothing else. Declaring GLOBAL would turn
   * every non-US region into a silently empty shelter layer that LOOKS like "no shelters here"; COUNTRIES
   * makes the ladder return NOT_COVERED, which the UI renders as "not available in this region" (OP4).
   */
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: [US_ISO] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly layers: readonly FemaShelterLayer[];
  private readonly maxPerLayer: number;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: SheltersFemaAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.layers = deps.layers ?? FEMA_SHELTER_LAYERS;
    this.maxPerLayer = deps.maxPerLayer ?? DEFAULT_MAX_PER_LAYER;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped Shelters. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<Shelter>>> {
    return this.engine.run<FemaShelterRaw, Shelter>({
      adapterId: this.id,
      source: SHELTERS_FEMA_SOURCE,
      license: SHELTERS_FEMA_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: femaShelterMapper,
      fetchLive: (r) => this.fetchLive(r),
      // The mock rung is region-scoped for the SAME reason the live rung is. The recorded open layer is a
      // NATIONAL response spanning seven states, so replaying it wholesale would put Hawaii, Minnesota and
      // Indiana shelters on the California COP — the exact defect that put GloFAS gauges from Tibet on the
      // Romanian map. A shelter outside the region is not a degraded answer, it is a wrong one, and the
      // degraded rung is precisely when an operator most needs the picture to be trustworthy. Art. XVI
      // licenses degrading and labelling; it never licenses answering a different question.
      loadMockRaw: () => this.loadMock(region.bbox),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /**
   * Outward domain port (P18). FEMA's coverage is national, so the query bbox scopes WHICH US shelters are
   * returned while `iso: 'US'` is what makes the coverage gate pass at all.
   */
  async fetchShelters(query: AreaQuery): Promise<Result<Sourced<readonly Shelter[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox, iso: US_ISO });
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `FEMA shelters unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  /**
   * One NSS layer = one shelter status = one bounded GET, so a three-status fetch is three sequential
   * requests — NOT a polling loop (adapter-contract §3.1). Sequential rather than parallel to stay a
   * polite client of a shared public FEMA service. A layer that fails throws and the WHOLE fetch degrades
   * to cache/mock: a shelter picture silently missing its OPEN layer would be far worse than a labelled
   * degraded one, because "no open shelters" and "we could not ask about open shelters" are different
   * answers and only one of them is true (Art. XVI).
   */
  private async fetchLive(region: Region): Promise<readonly FemaShelterRaw[]> {
    const rows: FemaShelterRaw[] = [];
    for (const layer of this.layers) {
      const text = await httpGetText(this.buildUrl(layer, region), {
        timeoutMs: this.config.timeoutMs,
      });
      rows.push(...parseFemaShelterLayer(text).rows);
    }
    return rows;
  }

  /**
   * Mock rung: one recorded body per fixture, parsed by the same ACL as LIVE, then KEPT ONLY IF THE
   * SHELTER FALLS INSIDE THE REGION (edges inclusive, matching the live rung's envelope query).
   */
  private async loadMock(
    bbox: readonly [number, number, number, number],
  ): Promise<readonly FemaShelterRaw[]> {
    const rows: FemaShelterRaw[] = [];
    for (const name of MOCK_FIXTURES) {
      const res = await loadFixtureText(this.fixturesDir, name);
      if (!res.ok) throw res.error;
      rows.push(...parseFemaShelterLayer(res.value).rows);
    }
    const [west, south, east, north] = bbox;
    return rows.filter((r) => r.lon >= west && r.lon <= east && r.lat >= south && r.lat <= north);
  }

  /**
   * ArcGIS MapServer bbox query. `where=1=1` is deliberate and load-bearing: gis.fema.gov sits behind a
   * Cloudflare WAF that answers HTTP 403 with an HTML block page to a `where` clause containing `IS NULL`
   * (measured 2026-09-11), so all null handling lives in the ACL and the wire query stays trivial.
   * `outFields` is an EXPLICIT projection, never `*` — see SHELTER_OUT_FIELDS for why (PII).
   */
  private buildUrl(layer: FemaShelterLayer, region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    const params = new URLSearchParams({
      where: '1=1',
      geometry: `${west},${south},${east},${north}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: SHELTER_OUT_FIELDS,
      outSR: '4326',
      returnGeometry: 'true',
      orderByFields: 'shelter_id', // a deterministic page, not an arbitrary one
      resultRecordCount: String(this.maxPerLayer),
      f: 'json',
    });
    return `${base}/${layer.layerId}/query?${params.toString()}`;
  }
}

/**
 * Parse `SOURCE_SHELTERS_FEMA_LAYERS` — a comma-separated list of NSS MapServer layer ids, e.g. `0,1,2`.
 * Unset means all three status layers. An id outside {@link FEMA_SHELTER_LAYERS} FAILS FAST rather than
 * being queried: BEACON knows the published status of layers 0/1/2 and of no others, so consuming (say)
 * layer 3 "Alert Shelters" would mean inventing a domain status for it. Refusing beats guessing.
 */
export function parseFemaShelterLayerIds(
  raw: string | undefined,
): AdapterResult<readonly FemaShelterLayer[]> {
  const entries = (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== '');
  if (entries.length === 0) return ok(FEMA_SHELTER_LAYERS);

  const layers: FemaShelterLayer[] = [];
  for (const entry of entries) {
    const id = Number(entry);
    const layer = Number.isInteger(id)
      ? FEMA_SHELTER_LAYERS.find((l) => l.layerId === id)
      : undefined;
    if (layer === undefined) {
      return err(
        makeAdapterError(
          'CONFIG',
          `SOURCE_SHELTERS_FEMA_LAYERS entry '${entry}' is not an NSS layer whose status BEACON can state ` +
            `(known: ${FEMA_SHELTER_LAYERS.map((l) => `${l.layerId}=${l.expectedStatus}`).join(', ')})`,
        ),
      );
    }
    layers.push(layer);
  }
  return ok(layers);
}

/**
 * Factory: resolve SOURCE_SHELTERS_FEMA_* config from env (12-factor). Keyless — the FEMA service is
 * public, so there is deliberately no `keyEnv`/`requireKeyForLive`. defaultMode stays CACHED: per the
 * honesty law LIVE is flipped by an operator on recorded evidence at deploy time, never asserted here,
 * even though the endpoint was verified live for this WP.
 */
export function makeSheltersFemaAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<SheltersFemaAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'SHELTERS_FEMA',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    // Three sequential ArcGIS queries against national layers; each gets this budget. Above the 8 s shared
    // default for the same reason HIFLD is: ArcGIS spatial queries on national layers are routinely slower
    // than a flat-file GET.
    defaultTimeoutMs: 15000,
  });
  if (!cfg.ok) return cfg;
  const layers = parseFemaShelterLayerIds(env.SOURCE_SHELTERS_FEMA_LAYERS);
  if (!layers.ok) return layers;
  const maxPerLayer = Number(env.SOURCE_SHELTERS_FEMA_MAX_PER_LAYER);
  return ok(
    new SheltersFemaAdapter({
      engine,
      config: cfg.value,
      layers: layers.value,
      ...(Number.isInteger(maxPerLayer) && maxPerLayer > 0 ? { maxPerLayer } : {}),
    }),
  );
}
