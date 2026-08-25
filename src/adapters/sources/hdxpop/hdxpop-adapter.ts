// BEACON — HDX population adapter (S2·Lane A3; adapter-contract §6, PopulationPort P12). UN OCHA HDX
// COD-PS ("Common Operational Dataset — Population Statistics") admin CSV → canonical PopulationEstimate
// behind the shared redundancy ladder (live → last-known-good cache → recorded-mock → unavailable).
// Implements BOTH the framework SourceAdapterPort<PopulationEstimate> (fetch/health) AND the outward domain
// PopulationPort (estimatePopulation → Sourced), so the application depends only on the port.
//
// WHY: the RO/global population fallback beside `worldpop` (modeled grids, CC BY 4.0) and `census` (US ACS).
// For Romania — the demo's non-US region — WorldPop is modeled and Census does not apply, so an OFFICIAL
// statistical vintage (Eurostat via UNFPA, published on HDX) is the strongest exposure base available for
// free. DATA_SOURCE_VERIFICATION §7 "UN OCHA HDX / HAPI" row: free, per-dataset licence, global, CACHED.
//
// VERIFIED LIVE 2026-08-08 (CKAN discovery + the resource download — see hdxpop-acl.ts header for the exact
// calls, response sizes and the recorded body). Keyless: HDX's CKAN API and resource downloads need no token.
//
// WHY THE DEFAULT MODE IS CACHED (honest, not lazy): the wire payload is a STATIC 2022 statistical vintage
// published once per COD revision, so "live" would re-download an unchanged file — CACHED is the truthful
// label for the data's own freshness (Art. XVI: degradation is labelled, never hidden). LIVE is fully
// implemented and needs no key; flip `SOURCE_HDXPOP_MODE=live` to re-pull the resource on the poll cadence.
//
// SCOPE (documented, same pattern as the census adapter's fixed CA-county query): the configured resource is
// ONE country's COD-PS admin-1 CSV (default: `cod-ps-rou`, Romania). HDX resource URLs are opaque UUIDs, so
// the resource is CONFIG (`SOURCE_HDXPOP_URL`), never hardcoded logic — pointing this adapter at another
// country's COD-PS resource is a config change plus a centroid-table entry, with zero code change (FR-10).
import { fileURLToPath } from 'node:url';
import type { BBox, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { PopulationEstimate, PopulationPort } from '@/ports/infrastructure-sources.js';
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
import type { HdxPopRow } from './hdxpop-acl.js';
import { bboxCenter, hdxPopMapper, parseHdxPopCsv, pointInBBox } from './hdxpop-acl.js';

const HDXPOP_ID = 'hdxpop';
const HDXPOP_SOURCE = 'UN OCHA HDX — COD-PS (Eurostat via UNFPA)';
// Declared verbatim by the `cod-ps-rou` dataset record on HDX (`license_title`), read live 2026-08-08.
const HDXPOP_LICENSE = 'CC BY-IGO (Creative Commons Attribution for Intergovernmental Organisations)';
// The `cod-ps-rou` admin-1 CSV resource (opaque CKAN UUIDs — verified live, see module header).
const DEFAULT_RESOURCE_URL =
  'https://data.humdata.org/dataset/819ed0e9-f983-4d72-a60c-6825fc50c8e1/resource/91966f08-8c32-4a9a-a1d1-b0c39819b87e/download/rou_admpop_adm1_2022_v01.csv';
const MOCK_FIXTURE = 'rou-admpop-adm1.csv';
const RO_ISO = 'RO';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
// COD-PS vintages change on the order of years, so the last-known-good window is deliberately long — the
// same reasoning as the WorldPop adapter's 6 h TTL, one step further because this is a fixed-year release.
const DEFAULT_CACHE_TTL_SEC = 86400;

/**
 * The fixed internal query region: "all admin-1 regions in the configured COD-PS resource" — independent of
 * the caller's bbox. A stable id keeps the last-known-good cache single-keyed regardless of which bbox
 * estimatePopulation is asked about (the query-bbox scoping/summing happens afterwards, below).
 */
const RO_ADM1_REGION: Region = { id: 'hdxpop-rou-adm1', bbox: [20.2, 43.6, 29.7, 48.3], iso: RO_ISO };

export interface HdxPopAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string; // defaults to the colocated __fixtures__ dir
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class HdxPopAdapter implements SourceAdapterPort<PopulationEstimate>, PopulationPort {
  // The configured resource is one country's COD-PS release, so coverage is that country — not GLOBAL.
  // Claiming GLOBAL would let a US query silently receive a Romanian sum.
  readonly id = HDXPOP_ID;
  readonly coverage: Coverage = { kind: 'COUNTRIES', iso: [RO_ISO] };
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: HdxPopAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the full redundancy ladder, returning provenance-stamped PopulationEstimates. */
  fetch(region: Region): Promise<AdapterResult<FetchResult<PopulationEstimate>>> {
    return this.engine.run<HdxPopRow, PopulationEstimate>({
      adapterId: this.id,
      source: HDXPOP_SOURCE,
      license: HDXPOP_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: hdxPopMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /**
   * Outward domain port (P12). Fetches the full admin-1 set once (cached under one stable region id), then
   * sums the regions whose builtin centroid falls inside the caller's bbox. HONEST: this is a
   * whole-region-in-or-out sum, NOT an area-weighted intersection — a bbox clipping half a region still
   * counts that region's whole population. Coarse by construction (see hdxpop-acl.ts geometry limitation),
   * so it must be surfaced as an order-of-magnitude exposure base, never as a precise headcount.
   */
  async estimatePopulation(area: BBox): Promise<Result<Sourced<PopulationEstimate>, DomainError>> {
    const res = await this.fetch(RO_ADM1_REGION);
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `HDX population unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const count = res.value.records
      .filter((r) => pointInBBox(bboxCenter(r.entity.area), area))
      .reduce((sum, r) => sum + r.entity.count, 0);
    return domainOk({ data: { area, count }, freshness: makeFreshness(res.value.freshness) });
  }

  /**
   * The live rung downloads the configured CKAN resource verbatim. HDX resource URLs already encode the
   * dataset + resource UUIDs, so there is no query parameter to build — and no bbox parameter exists,
   * which is why the RedundancySpec's `region` is not needed here.
   */
  private async fetchLive(): Promise<readonly HdxPopRow[]> {
    const url = this.config.url ?? DEFAULT_RESOURCE_URL;
    return parseHdxPopCsv(await httpGetText(url, { timeoutMs: this.config.timeoutMs })).rows;
  }

  private async loadMock(): Promise<readonly HdxPopRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseHdxPopCsv(res.value).rows;
  }
}

/**
 * Factory: resolve SOURCE_HDXPOP_* config from env. Keyless — HDX needs no token, so there is deliberately
 * no `keyEnv`/`requireKeyForLive`. defaultMode CACHED because the upstream is a fixed statistical vintage
 * (module header), not because the live rung is missing.
 */
export function makeHdxPopAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<HdxPopAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'HDXPOP',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_RESOURCE_URL,
    // COD-PS resources are ~4 kB but HDX redirects through a CDN; keep a little more headroom than the
    // 8 s shared default so a slow CDN hop degrades to cache on merit, not on an over-tight clock.
    defaultTimeoutMs: 12000,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new HdxPopAdapter({ engine, config: cfg.value }) };
}
