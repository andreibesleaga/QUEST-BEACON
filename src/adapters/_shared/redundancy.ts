// BEACON — Redundancy engine (E4·T-140/T-141; adapter-contract §3.1, ADR-009, Art. XVI). Composes the
// full ladder every adapter shares: coverage-gate → live (breaker + retry + timeout) → last-known-good
// cache → recorded-mock → typed unavailable. NEVER dead-ends the COP. Each concrete adapter supplies only
// its ACL mapper + live call + mock loader; the engine supplies resilience + provenance + freshness.
// This is the primary seam Part-B adapters plug into (one `engine.run(spec)` call per fetch).
import { randomUUID } from 'node:crypto';
import type { CachePort } from '@/ports/infra.js';
import type {
  AdapterHealth,
  AdapterResult,
  AntiCorruptionMapper,
  Coverage,
  FetchResult,
  MapContext,
  Region,
  SourceMode,
  SourceRecord,
} from './contract.js';
import { ok, err } from './contract.js';
import type { BreakerConfig } from './circuit-breaker.js';
import { ManagedBreaker, classify } from './circuit-breaker.js';
import { makeAdapterError } from './errors.js';
import { isCovered } from './coverage.js';
import { mapRows } from './anti-corruption.js';
import { buildFetchResult, stampProvenance } from './provenance.js';
import { cacheKey, readLastGood, writeLastGood } from './last-known-good-cache.js';

export interface RedundancySpec<Raw, T> {
  readonly adapterId: string;
  readonly source: string;
  readonly license: string;
  readonly mode: SourceMode;
  readonly coverage: Coverage;
  readonly region: Region;
  readonly cacheTtlSec: number;
  readonly breaker: BreakerConfig;
  readonly mapper: AntiCorruptionMapper<Raw, T>;
  /** Raw upstream fetch (throws AdapterError on failure). Omitted for MOCK-only adapters. */
  readonly fetchLive?: (region: Region) => Promise<readonly Raw[]>;
  /** Recorded-mock raw loader (reads the fixture). Omitted only if the adapter has no mock rung. */
  readonly loadMockRaw?: () => Promise<readonly Raw[]>;
}

export interface RedundancyEngineDeps {
  readonly cache: CachePort;
  readonly nowIso?: () => string; // injectable clock (deterministic tests)
  readonly idGen?: () => string; // injectable uuid (deterministic provenance ids)
}

export class RedundancyEngine {
  private readonly cache: CachePort;
  private readonly nowIso: () => string;
  private readonly idGen: () => string;
  private readonly breakers = new Map<string, ManagedBreaker>();

  constructor(deps: RedundancyEngineDeps) {
    this.cache = deps.cache;
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString());
    this.idGen = deps.idGen ?? (() => randomUUID());
  }

  /** Per-adapter breaker state is shared across calls (health() reads it). */
  private getBreaker(id: string, cfg: BreakerConfig): ManagedBreaker {
    let breaker = this.breakers.get(id);
    if (breaker === undefined) {
      breaker = new ManagedBreaker(cfg, this.nowIso);
      this.breakers.set(id, breaker);
    }
    return breaker;
  }

  health(id: string, cfg: BreakerConfig): AdapterHealth {
    return this.getBreaker(id, cfg).health();
  }

  async run<Raw, T>(spec: RedundancySpec<Raw, T>): Promise<AdapterResult<FetchResult<T>>> {
    if (!isCovered(spec.coverage, spec.region)) {
      return err(
        makeAdapterError('NOT_COVERED', `${spec.adapterId}: region '${spec.region.id}' outside coverage`, {
          retryable: false,
        }),
      );
    }
    const ctx: MapContext = { fetchedAt: this.nowIso(), sourceRecordId: this.idGen() };
    if (spec.mode === 'MOCK') return this.serveMock(spec, ctx);
    if (spec.mode === 'LIVE') {
      const live = await this.tryLive(spec, ctx);
      if (live.ok) return live;
    }
    const cached = await this.serveCache<Raw, T>(spec);
    if (cached.ok) return cached;
    const mock = await this.serveMock(spec, ctx);
    if (mock.ok) return mock;
    return err(
      makeAdapterError('UPSTREAM_UNAVAILABLE', `${spec.adapterId}: all redundancy rungs exhausted`, {
        retryable: true,
      }),
    );
  }

  private async tryLive<Raw, T>(
    spec: RedundancySpec<Raw, T>,
    ctx: MapContext,
  ): Promise<AdapterResult<FetchResult<T>>> {
    const fetchLive = spec.fetchLive;
    if (fetchLive === undefined) {
      return err(makeAdapterError('CONFIG', `${spec.adapterId}: LIVE mode but no live fetch`, { retryable: false }));
    }
    const breaker = this.getBreaker(spec.adapterId, spec.breaker);
    try {
      const raw = await breaker.execute(() => fetchLive(spec.region));
      const records = mapRows<Raw, T>(raw, spec.mapper, ctx, this.stamp(spec, 'LIVE', ctx));
      const fr = buildFetchResult<T>(records, 'LIVE', false, ctx.fetchedAt);
      await writeLastGood(this.cache, cacheKey(spec.adapterId, spec.region.id), fr, spec.cacheTtlSec);
      return ok(fr);
    } catch (e) {
      return err(classify(e));
    }
  }

  private serveCache<Raw, T>(spec: RedundancySpec<Raw, T>): Promise<AdapterResult<FetchResult<T>>> {
    return readLastGood<T>(this.cache, cacheKey(spec.adapterId, spec.region.id));
  }

  private async serveMock<Raw, T>(
    spec: RedundancySpec<Raw, T>,
    ctx: MapContext,
  ): Promise<AdapterResult<FetchResult<T>>> {
    const loadMockRaw = spec.loadMockRaw;
    if (loadMockRaw === undefined) {
      return err(
        makeAdapterError('UPSTREAM_UNAVAILABLE', `${spec.adapterId}: no recorded-mock fixture`, {
          retryable: false,
        }),
      );
    }
    try {
      const raw = await loadMockRaw();
      const records = mapRows<Raw, T>(raw, spec.mapper, ctx, this.stamp(spec, 'MOCK', ctx));
      return ok(buildFetchResult<T>(records, 'MOCK', true, ctx.fetchedAt));
    } catch (e) {
      return err(classify(e));
    }
  }

  private stamp<Raw, T>(spec: RedundancySpec<Raw, T>, mode: SourceMode, ctx: MapContext): SourceRecord {
    return stampProvenance({
      adapterId: spec.adapterId,
      source: spec.source,
      license: spec.license,
      mode,
      fetchedAt: ctx.fetchedAt,
      id: ctx.sourceRecordId,
    });
  }
}
