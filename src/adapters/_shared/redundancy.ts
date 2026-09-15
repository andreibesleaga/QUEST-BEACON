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
  /**
   * Why a source that is CONFIGURED live enters the ladder at CACHED for this region (e.g. GloFAS with no
   * reporting point inside the bbox). It replaces the generic "cache was cold" reason in the degradation
   * line, so an operator reading the log sees the configuration gap rather than a phantom outage.
   */
  readonly cachedReason?: string;
}

/**
 * One source stepping DOWN a rung, with the reason.
 *
 * The engine used to classify a failed live fetch and then discard the verdict — `if (live.ok) return
 * live;` and on to the cache. So a source quietly serving the recorded fixture in production told an
 * operator nothing about why, at any log level. This is that verdict, surfaced.
 */
export interface DegradationEvent {
  readonly adapterId: string;
  /** The rung the source was CONFIGURED for. */
  readonly from: SourceMode;
  /** The rung it actually landed on — what the operator is really being served. */
  readonly to: SourceMode;
  readonly reason: string;
}

export interface RedundancyEngineDeps {
  readonly cache: CachePort;
  readonly nowIso?: () => string; // injectable clock (deterministic tests)
  readonly idGen?: () => string; // injectable uuid (deterministic provenance ids)
  /**
   * Called ONCE per fetch that stepped down a rung, never on a healthy one — a report on a healthy fetch
   * trains an operator to ignore the channel. Default: one line to stderr, because a source silently
   * serving a fixture is exactly the thing a production deployment must not hide.
   */
  readonly onDegrade?: (event: DegradationEvent) => void;
}

/**
 * Strip credentials out of a reason before it is ever written anywhere.
 *
 * The reason is built from the classified adapter error, and `statusError` embeds the URL. Some adapters
 * put their key in the QUERY (`?key=...`), and FIRMS puts its MAP_KEY in the PATH itself
 * (`/api/area/csv/<MAP_KEY>/...`). Redacting query parameters alone would therefore still have written a
 * live NASA key into the log on every FIRMS failure — the sources most likely to fail being exactly the
 * ones holding credentials. So the whole locator after the host goes: the host is the useful half of the
 * diagnosis ("which upstream"), and everything after it is where secrets live.
 *
 * `key=`-style pairs outside a URL are redacted too, as defence in depth for error text we do not control.
 */
export function redactSecrets(reason: string): string {
  return reason
    .replace(
      /\b(https?:)\/\/(?:[^/\s@]*@)?([^/?#\s]+)(\/[^\s]*)?/gi,
      (_m, scheme: string, host: string, rest?: string) =>
        `${scheme}//${host}${rest === undefined || rest === '' ? '' : '/<redacted>'}`,
    )
    .replace(
      /\b([a-z_-]*(?:key|token|secret|password|appname|auth)[a-z_-]*)=([^\s&]+)/gi,
      '$1=<redacted>',
    );
}

/**
 * The default sink: one line per degradation, to stderr, unconditionally.
 *
 * NOT behind a debug flag. The six sources that were serving the recorded fixture in production were
 * invisible precisely because the only place their reason could have appeared was a level nobody runs a
 * deployment at. A source that is not serving what it was configured to serve is operational news.
 */
function defaultDegradeReport(event: DegradationEvent): void {
  process.stderr.write(
    `[beacon] source degraded: ${event.adapterId} ${event.from}->${event.to} — ${event.reason}\n`,
  );
}

/** A sink may be declared `() => void` and still be `async`; a rejected promise must not escape. */
function swallowRejection(returned: unknown): void {
  if (typeof (returned as { then?: unknown } | null)?.then === 'function') {
    void (returned as Promise<unknown>).catch(() => undefined);
  }
}

export class RedundancyEngine {
  private readonly cache: CachePort;
  private readonly nowIso: () => string;
  private readonly idGen: () => string;
  private readonly onDegrade: (event: DegradationEvent) => void;
  private readonly breakers = new Map<string, ManagedBreaker>();

  constructor(deps: RedundancyEngineDeps) {
    this.cache = deps.cache;
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString());
    this.idGen = deps.idGen ?? (() => randomUUID());
    this.onDegrade = deps.onDegrade ?? defaultDegradeReport;
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
        makeAdapterError(
          'NOT_COVERED',
          `${spec.adapterId}: region '${spec.region.id}' outside coverage`,
          {
            retryable: false,
          },
        ),
      );
    }
    const ctx: MapContext = { fetchedAt: this.nowIso(), sourceRecordId: this.idGen() };
    // MOCK is not a degradation — it is what the deployment asked for, and reporting it would bury the
    // sources that genuinely fell over in a list of ones behaving exactly as configured.
    if (spec.mode === 'MOCK') return this.serveMock(spec, ctx);
    // `reason` survives the fall so the rung that CATCHES it can say what it was catching. Without this
    // the classified verdict was computed on every failure and dropped on the floor.
    let reason =
      spec.cachedReason ?? 'cache was cold and this source contacts no upstream (mode=CACHED)';
    if (spec.mode === 'LIVE') {
      const live = await this.tryLive(spec, ctx);
      if (live.ok) return live;
      reason = `${live.error.kind}: ${live.error.message}`;
    }
    const cached = await this.serveCache<Raw, T>(spec);
    if (cached.ok) {
      this.report(spec.adapterId, spec.mode, 'CACHED', reason);
      return cached;
    }
    const mock = await this.serveMock(spec, ctx);
    if (mock.ok) {
      this.report(spec.adapterId, spec.mode, 'MOCK', reason);
      return mock;
    }
    return err(
      makeAdapterError(
        'UPSTREAM_UNAVAILABLE',
        `${spec.adapterId}: all redundancy rungs exhausted`,
        {
          retryable: true,
        },
      ),
    );
  }

  /** Fail-open: a reporting sink that throws must never be the thing that takes a data source down. */
  private report(adapterId: string, from: SourceMode, to: SourceMode, reason: string): void {
    // NOT A STEP DOWN, NOT A DEGRADATION. A CACHED source served from cache reached the rung it was
    // configured for. Reporting it would put a line in the log for every healthy cached adapter on every
    // fetch, which is how a diagnostic channel becomes noise an operator learns to scroll past.
    if (to === from) return;
    try {
      swallowRejection(this.onDegrade({ adapterId, from, to, reason: redactSecrets(reason) }));
    } catch {
      /* a broken log sink is not a reason to fail a fetch that succeeded */
    }
  }

  private async tryLive<Raw, T>(
    spec: RedundancySpec<Raw, T>,
    ctx: MapContext,
  ): Promise<AdapterResult<FetchResult<T>>> {
    const fetchLive = spec.fetchLive;
    if (fetchLive === undefined) {
      return err(
        makeAdapterError('CONFIG', `${spec.adapterId}: LIVE mode but no live fetch`, {
          retryable: false,
        }),
      );
    }
    const breaker = this.getBreaker(spec.adapterId, spec.breaker);
    try {
      const raw = await breaker.execute(() => fetchLive(spec.region));
      const records = mapRows<Raw, T>(raw, spec.mapper, ctx, this.stamp(spec, 'LIVE', ctx));
      const fr = buildFetchResult<T>(records, 'LIVE', false, ctx.fetchedAt);
      await writeLastGood(
        this.cache,
        cacheKey(spec.adapterId, spec.region.id),
        fr,
        spec.cacheTtlSec,
      );
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

  private stamp<Raw, T>(
    spec: RedundancySpec<Raw, T>,
    mode: SourceMode,
    ctx: MapContext,
  ): SourceRecord {
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
