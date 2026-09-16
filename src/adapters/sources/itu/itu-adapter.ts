// BEACON — ITU adapter (TelecomPort P13; adapter-contract §6). ITU-style country/region connectivity
// indicators → canonical TelecomCoverage behind the shared redundancy ladder. Implements BOTH the
// framework SourceAdapterPort<TelecomCoverage> (fetch/health) AND the outward domain TelecomPort
// (fetchCoverage → Sourced), so the application depends only on the port, never on ITU internals.
//
// MOCK-ONLY, config-gated (DATA_SOURCE_VERIFICATION.md row 57, §4; .env.example SOURCE_ITU_MODE=mock):
// ITU Disaster Connectivity Maps / national indicator datasets are gated (per-event access / account-
// gated bulk download) — there is no public keyless live endpoint suitable for this adapter. Until that
// access is arranged, `makeItuAdapter` REJECTS SOURCE_ITU_MODE=LIVE with a CONFIG error at boot (fail-fast,
// never a silent no-op). CACHED is allowed and behaves the same as camara-gsma's: no live rung ever
// writes the last-known-good cache, so a cold cache falls straight through to the recorded mock.
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
import {
  loadFixtureText,
  resolveSourceConfig,
  makeAdapterError,
  err as adapterErr,
} from '@/adapters/_shared/index.js';
import type { ItuConnectivityRow } from './itu-acl.js';
import { ituMapper, parseItuRows } from './itu-acl.js';

const ITU_ID = 'itu';
const ITU_SOURCE = 'ITU Disaster Connectivity Maps';
const ITU_LICENSE = 'ITU terms (gated)';
const MOCK_FIXTURE = 'connectivity.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface ItuAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class ItuAdapter implements SourceAdapterPort<TelecomCoverage>, TelecomPort {
  readonly id = ITU_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // ITU indicators exist per-country worldwide (sparse/event-based)
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: ItuAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  /** Framework port: walk the redundancy ladder (no live rung — see class header). */
  fetch(region: Region): Promise<AdapterResult<FetchResult<TelecomCoverage>>> {
    return this.engine.run<ItuConnectivityRow, TelecomCoverage>({
      adapterId: this.id,
      source: ITU_SOURCE,
      license: ITU_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: ituMapper,
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
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(
        new DomainError('NOT_FOUND', `ITU unavailable (${res.error.kind}): ${res.error.message}`),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async loadMock(): Promise<readonly ItuConnectivityRow[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseItuRows(res.value);
  }
}

/**
 * Factory: resolve SOURCE_ITU_* config from env. MOCK-only source — LIVE is rejected fail-fast (CONFIG)
 * because ITU connectivity datasets are gated (no public keyless live endpoint). CACHED is allowed (see
 * class header — degrades to MOCK behavior for this adapter since no live rung ever exists).
 */
export function makeItuAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<ItuAdapter> {
  const cfg = resolveSourceConfig({ prefix: 'ITU', env, defaultMode: 'MOCK' });
  if (!cfg.ok) return cfg;
  if (cfg.value.mode === 'LIVE') {
    return adapterErr(
      makeAdapterError(
        'CONFIG',
        'ITU: LIVE mode requires access to a gated ITU dataset (Disaster Connectivity Maps / national indicators are not publicly keyless) — no live endpoint is available. Use MOCK (default) until access is arranged.',
        { retryable: false },
      ),
    );
  }
  return { ok: true, value: new ItuAdapter({ engine, config: cfg.value }) };
}
