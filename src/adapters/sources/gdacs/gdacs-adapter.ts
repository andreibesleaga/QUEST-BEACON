// BEACON — GDACS adapter (E4·T-171; adapter-contract §6, HazardSourcePort P1). GDACS global disaster feed
// → canonical HazardGeometry (wildfire hotspots + flood reaches) behind the shared redundancy ladder (live
// → last-known-good cache → recorded-mock → unavailable). Implements BOTH the framework
// SourceAdapterPort<HazardGeometry> AND the outward HazardSourcePort, so the application depends only on
// the port, never on GDACS internals.
//
// DATA_SOURCE_VERIFICATION §2: verified tier LIVE, keyless, open, GLOBAL — the worldwide hazard rung beside
// FIRMS (US/global fire). Config-driven: endpoint/mode/timeout from SOURCE_GDACS_* env. Coarse alert feed.
import { fileURLToPath } from 'node:url';
import type { HazardGeometry, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { HazardSourcePort, AreaQuery } from '@/ports/data-sources.js';
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
import type { GdacsFeature } from './gdacs-acl.js';
import { gdacsMapper, parseGdacsEvents } from './gdacs-acl.js';

const GDACS_ID = 'gdacs';
const GDACS_SOURCE = 'GDACS';
const GDACS_LICENSE = 'GDACS open data (JRC / UN-OCHA)';
const DEFAULT_BASE_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP';
const MOCK_FIXTURE = 'events.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface GdacsAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class GdacsAdapter implements SourceAdapterPort<HazardGeometry>, HazardSourcePort {
  readonly id = GDACS_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // worldwide alert feed
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: GdacsAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<HazardGeometry>>> {
    return this.engine.run<GdacsFeature, HazardGeometry>({
      adapterId: this.id,
      source: GDACS_SOURCE,
      license: GDACS_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: gdacsMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P1). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchHazards(query: AreaQuery): Promise<Result<Sourced<readonly HazardGeometry[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(new DomainError('NOT_FOUND', `GDACS unavailable (${res.error.kind}): ${res.error.message}`));
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(): Promise<readonly GdacsFeature[]> {
    // geteventlist/MAP returns the current global event set; region filtering happens downstream (COP).
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const json = await httpGetText(base, { timeoutMs: this.config.timeoutMs });
    return parseGdacsEvents(json);
  }

  private async loadMock(): Promise<readonly GdacsFeature[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseGdacsEvents(res.value);
  }
}

/** Factory: resolve SOURCE_GDACS_* config from env. Fail-fast (CONFIG) on a bad mode/url. */
export function makeGdacsAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<GdacsAdapter> {
  const cfg = resolveSourceConfig({ prefix: 'GDACS', env, defaultMode: 'MOCK', defaultUrl: DEFAULT_BASE_URL });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new GdacsAdapter({ engine, config: cfg.value }) };
}
