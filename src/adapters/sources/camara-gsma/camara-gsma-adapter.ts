// BEACON — CAMARA/GSMA Open Gateway adapter (TelecomPort P13; adapter-contract §6). Aggregate CAMARA
// (Population Density / Region Device Count / Connectivity Insights-style) rows → canonical
// TelecomCoverage behind the shared redundancy ladder. Implements BOTH the framework
// SourceAdapterPort<TelecomCoverage> (fetch/health) AND the outward domain TelecomPort (fetchCoverage →
// Sourced), so the application depends only on the port, never on CAMARA internals.
//
// MOCK-ONLY, config-gated (DATA_SOURCE_VERIFICATION.md row 59, §4): CAMARA/GSMA Open Gateway APIs are
// **operator-gated** — there is no public keyless live endpoint. A live integration is only possible
// once the client contracts an operator sandbox agreement (per-operator onboarding). Until that
// agreement exists there is no honest "live" rung to offer, so `makeCamaraGsmaAdapter` REJECTS
// SOURCE_CAMARA_GSMA_MODE=LIVE with a CONFIG error at boot (fail-fast, never a silent no-op).
//
// CACHED vs MOCK: this adapter never populates the last-known-good cache (no fetchLive is ever wired
// into the RedundancySpec, live or otherwise), so CACHED mode is allowed through unchanged and simply
// falls back to the recorded mock on every call — RedundancyEngine.run already does this for free (cache
// miss → serveMock) when mode is CACHED and no live rung ever wrote a cache entry. Effectively
// CACHED === MOCK for this adapter; the ladder is honest about it via mode/degraded on the FetchResult
// (see camara-gsma-adapter.test.ts for the round-trip proof).
import { fileURLToPath } from 'node:url';
import type { Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { TelecomPort, TelecomCoverage } from '@/ports/infrastructure-sources.js';
import type { AreaQuery } from '@/ports/data-sources.js';
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
import { loadFixtureText, resolveSourceConfig, makeAdapterError, err as adapterErr } from '@/adapters/_shared/index.js';
import type { CamaraGsmaRow } from './camara-gsma-acl.js';
import { camaraGsmaMapper, parseCamaraGsmaRows } from './camara-gsma-acl.js';

const CAMARA_GSMA_ID = 'camara-gsma';
const CAMARA_GSMA_SOURCE = 'CAMARA / GSMA Open Gateway';
const CAMARA_GSMA_LICENSE = 'operator terms (CAMARA/GSMA)';
const MOCK_FIXTURE = 'coverage.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface CamaraGsmaAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class CamaraGsmaAdapter implements SourceAdapterPort<TelecomCoverage>, TelecomPort {
  readonly id = CAMARA_GSMA_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // varies by operator sandbox reach; declared GLOBAL, gated by mode
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: CamaraGsmaAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir = deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the redundancy ladder (no live rung — see class header). */
  fetch(region: Region): Promise<AdapterResult<FetchResult<TelecomCoverage>>> {
    return this.engine.run<CamaraGsmaRow, TelecomCoverage>({
      adapterId: this.id,
      source: CAMARA_GSMA_SOURCE,
      license: CAMARA_GSMA_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: camaraGsmaMapper,
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P13). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchCoverage(query: AreaQuery): Promise<Result<Sourced<readonly TelecomCoverage[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `CAMARA/GSMA unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async loadMock(): Promise<readonly CamaraGsmaRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseCamaraGsmaRows(res.value);
  }
}

/**
 * Factory: resolve SOURCE_CAMARA_GSMA_* config from env. MOCK-only source — LIVE is rejected fail-fast
 * (CONFIG) because CAMARA/GSMA Open Gateway is operator-gated: a live rung only becomes honest once the
 * client contracts an operator sandbox agreement. CACHED is allowed (see class header — it degrades to
 * MOCK behavior for this adapter since no live rung ever exists to warm the cache).
 */
export function makeCamaraGsmaAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<CamaraGsmaAdapter> {
  const cfg = resolveSourceConfig({ prefix: 'CAMARA_GSMA', env, defaultMode: 'MOCK' });
  if (!cfg.ok) return cfg;
  if (cfg.value.mode === 'LIVE') {
    return adapterErr(
      makeAdapterError(
        'CONFIG',
        'CAMARA_GSMA: LIVE mode requires an operator sandbox agreement — CAMARA/GSMA Open Gateway is operator-gated with no public live endpoint; live access is only available once the client contracts an operator. Use MOCK (default) until then.',
        { retryable: false },
      ),
    );
  }
  return { ok: true, value: new CamaraGsmaAdapter({ engine, config: cfg.value }) };
}
