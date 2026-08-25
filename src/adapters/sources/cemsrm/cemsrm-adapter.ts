// BEACON — Copernicus EMS Rapid Mapping adapter (S2·Lane-A2; adapter-contract §6, HazardSourcePort P1;
// Art. XVI). Official EU emergency-mapping ACTIVATIONS → canonical HazardGeometry (activation centroid)
// behind the shared redundancy ladder (live → last-known-good cache → recorded-mock → typed unavailable).
// Implements BOTH the framework SourceAdapterPort<HazardGeometry> AND the outward domain HazardSourcePort.
//
// SOURCE (live-verified 2026-08-08 by real curl, HTTP 200, KEYLESS — see cemsrm-acl.ts header for the
// recorded response): `https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/
// public-activations-info/`, query `?limit=<n>` (also supports `offset`, `category`, `code` — verified).
// Documented by Copernicus EMS at mapping.emergency.copernicus.eu → "How to harvest CEMS Mapping data".
//
// MODE (honest default CACHED, LIVE-capable): activations are a SLOW feed — a few per week worldwide —
// so polling it live buys almost nothing while adding a dependency; the default is CACHED with a 1-hour
// TTL and LIVE is a one-env-var flip (`SOURCE_CEMSRM_MODE=live`) that needs no key.
//
// ROLE: official activation-mapping corroboration ("an EU civil-protection authority formally requested
// mapping for this event"), NOT an observed footprint — the geometry is a single activation centroid and
// the AOI/product extents are deliberately not consumed (see cemsrm-acl.ts for the binding rationale).
// `EMSR758` (Flood in Galati and Vaslui counties, Romania, 2024-09-14) is the RO demo reference and was
// re-verified live on the same route via `?code=EMSR758`.
import { fileURLToPath } from 'node:url';
import type { HazardGeometry, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { AreaQuery, HazardSourcePort } from '@/ports/data-sources.js';
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
import type { CemsActivation } from './cemsrm-acl.js';
import { cemsMapper, parseCemsActivations } from './cemsrm-acl.js';

const ADAPTER_ID = 'cemsrm';
const SOURCE = 'Copernicus EMS Rapid Mapping';
// Copernicus data is free, full and open (Reg. (EU) No 1159/2013) with an attribution requirement —
// the same wording already used for the `effis` row, kept identical so provenance reads consistently.
const LICENSE = 'Copernicus/JRC open (attribution)';
const DEFAULT_BASE_URL =
  'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/';
const MOCK_FIXTURE = 'activations.json';
// Per-fetch page size. The route is paginated (247 activations at probe); the newest page is what a COP
// needs, and a bounded page also bounds one fetch's latency/host load (no published rate limit exists).
const DEFAULT_LIMIT = 20;
// Polite contact User-Agent for the live rung — not a secret; the endpoint itself stays env-overridable.
const USER_AGENT = 'BEACON/1.0 (+https://github.com/IEEE-Response-Quest; emergency COP)';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 4, cooldownSec: 300, halfOpenTrials: 1 };
// Activations change a few times a week — a much longer TTL than fast-moving hazard feeds.
const DEFAULT_CACHE_TTL_SEC = 3600;

export interface CemsRmAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly limit?: number;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class CemsRmAdapter implements SourceAdapterPort<HazardGeometry>, HazardSourcePort {
  readonly id = ADAPTER_ID;
  // GLOBAL, not EU: CEMS Rapid Mapping is activated worldwide (the recorded page alone carries Guatemala
  // and Ecuador activations) — restricting coverage to EU would silently hide real data (OP4).
  readonly coverage: Coverage = { kind: 'GLOBAL' };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly limit: number;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: CemsRmAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.limit = deps.limit ?? DEFAULT_LIMIT;
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped HazardGeometry. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<HazardGeometry>>> {
    return this.engine.run<CemsActivation, HazardGeometry>({
      adapterId: this.id,
      source: SOURCE,
      license: LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: cemsMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P1). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchHazards(query: AreaQuery): Promise<Result<Sourced<readonly HazardGeometry[]>, DomainError>> {
    const region: Region = { id: 'query', bbox: query.bbox };
    const res = await this.fetch(region);
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `CEMS-RM unavailable (${res.error.kind}): ${res.error.message}`));
    }
    // The activations route has NO bbox parameter, so the newest page is fetched whole and clipped HERE,
    // by the caller's bbox — an activation outside the query area is never handed up as in-area.
    const data = res.value.records.map((r) => r.entity).filter((h) => inBBox(h, query.bbox));
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(): Promise<readonly CemsActivation[]> {
    const json = await httpGetText(this.buildUrl(), {
      timeoutMs: this.config.timeoutMs,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    return parseCemsActivations(json).activations;
  }

  private async loadMock(): Promise<readonly CemsActivation[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseCemsActivations(res.value).activations;
  }

  /** CEMS dashboard-api: /{base}?limit={n} — newest activations first (verified live 2026-08-08). */
  private buildUrl(): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    return `${base}?limit=${this.limit}`;
  }
}

/**
 * Inclusive point-in-bbox test over an activation centroid. The ACL only ever emits `Point` geometry,
 * and the narrowing below is the enforcement rather than a cast: any other geometry kind is excluded
 * from the result instead of being coerced into a position (Art. XVI — no silent reinterpretation).
 */
function inBBox(hazard: HazardGeometry, bbox: readonly [number, number, number, number]): boolean {
  if (hazard.geometry.type !== 'Point') return false;
  const [lon, lat] = hazard.geometry.coordinates;
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/** Factory: resolve SOURCE_CEMSRM_* config from env and construct the adapter. Fail-fast (CONFIG). */
export function makeCemsRmAdapter(engine: RedundancyEngine, env: Env = process.env): AdapterResult<CemsRmAdapter> {
  // Keyless by design — no `keyEnv`/`requireKeyForLive`, so LIVE can never fail for a missing secret.
  const cfg = resolveSourceConfig({ prefix: 'CEMSRM', env, defaultMode: 'CACHED', defaultUrl: DEFAULT_BASE_URL });
  if (!cfg.ok) return cfg;
  return ok(new CemsRmAdapter({ engine, config: cfg.value }));
}
