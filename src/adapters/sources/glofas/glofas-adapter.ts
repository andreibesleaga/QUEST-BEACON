// BEACON — GloFAS adapter (E4·T-173; adapter-contract §6, FloodGaugePort P2). Copernicus GloFAS (Global
// Flood Awareness System) reporting points → canonical Gauge behind the shared redundancy ladder (live →
// last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<Gauge> AND the outward FloodGaugePort, so the application depends only on the port,
// never on GloFAS internals. This is the RO/global flood rung beside NWPS (US river gauges).
//
// DATA_SOURCE_VERIFICATION.md row 36: verified tier CACHED — GloFAS is GLOBAL, open license, but the OGC
// WMS-T reporting-point service is PASSWORD-PROTECTED (free Copernicus EWDS/CDS account). There is NO
// keyless public JSON, so the honest default is CACHED and LIVE requires a key (requireKeyForLive). With an
// empty cache the ladder degrades to the recorded mock — never a dead-end (Art. XVI). Config-driven:
// endpoint/mode/timeout from SOURCE_GLOFAS_* env; the CDS/EWDS key from GLOFAS_CDS_KEY. Nothing hardcoded.
import { fileURLToPath } from 'node:url';
import type { Gauge, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { FloodGaugePort, AreaQuery } from '@/ports/data-sources.js';
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
import type { GlofasFeature } from './glofas-acl.js';
import { glofasMapper, parseGlofasReportingPoints } from './glofas-acl.js';

const GLOFAS_ID = 'glofas';
const GLOFAS_SOURCE = 'Copernicus GloFAS';
const GLOFAS_LICENSE = 'Copernicus open (free, attribution)';
// UPSTREAM DECOMMISSIONED (verified live 2026-08-04): this JSON GetFeatureInfo façade now 301s into the
// site's React SPA (`/react/...` serves text/html — "<!doctype …"), so the LIVE rung degrades honestly to
// CACHED/MOCK whatever URL is used; httpGetText's `redirect: 'manual'` (deliberate — a silent cross-host
// redirect could smuggle a request to an unvetted origin) makes that failure visible as a 301 instead of
// masking it with HTML-as-JSON. The canonical documented URL is kept as the default; when a working JSON
// endpoint exists again point SOURCE_GLOFAS_URL at it. The strict-WMS migration (ows.globalfloods.eu
// serves real WMS 1.3.0 but needs proper GetFeatureInfo params) is ROADMAP-POST-V1 work, not a hotfix.
const DEFAULT_BASE_URL = 'https://global-flood.emergency.copernicus.eu/glofas-forecasting/wms';
const KEY_ENV = 'GLOFAS_CDS_KEY';
const MOCK_FIXTURE = 'reporting-points.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface GlofasAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class GlofasAdapter implements SourceAdapterPort<Gauge>, FloodGaugePort {
  readonly id = GLOFAS_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // GloFAS is a global flood forecast
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: GlofasAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<Gauge>>> {
    return this.engine.run<GlofasFeature, Gauge>({
      adapterId: this.id,
      source: GLOFAS_SOURCE,
      license: GLOFAS_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: glofasMapper,
      fetchLive: (r) => this.fetchLive(r),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P2). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchGauges(query: AreaQuery): Promise<Result<Sourced<readonly Gauge[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `GloFAS unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(region: Region): Promise<readonly GlofasFeature[]> {
    const json = await httpGetText(this.buildUrl(region), { timeoutMs: this.config.timeoutMs });
    return parseGlofasReportingPoints(json);
  }

  private async loadMock(): Promise<readonly GlofasFeature[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseGlofasReportingPoints(res.value);
  }

  /** GloFAS reporting points via WMS GetFeatureInfo (INFO_FORMAT=application/json), bbox-scoped, keyed. */
  private buildUrl(region: Region): string {
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const [west, south, east, north] = region.bbox;
    const key = this.config.apiKey ?? '';
    return `${base}?service=WMS&request=GetFeatureInfo&info_format=application/json&bbox=${west},${south},${east},${north}&apikey=${key}`;
  }
}

/** Factory: resolve SOURCE_GLOFAS_* config from env. LIVE requires GLOFAS_CDS_KEY; fail-fast on bad config. */
export function makeGlofasAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<GlofasAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'GLOFAS',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
    keyEnv: KEY_ENV,
    requireKeyForLive: true,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new GlofasAdapter({ engine, config: cfg.value }) };
}
