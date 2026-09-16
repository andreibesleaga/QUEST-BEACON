// BEACON — the BACKGROUND-WORK SEAM (ADR-037 §2; FR-LD-11 / FR-LD-12 / FR-LD-13).
//
// WHY THIS FILE EXISTS. The app had no way to run recurring work at all: the only `setInterval` in the
// codebase is the SSE heartbeat, which is per-request and dies with the stream. That gap is why
// `src/application/governance/retention-sweep.ts` — a real, tested Art. XIV purge executor — was invoked by
// NOTHING in the running app (UNIMPLEMENTED_REGISTER row 20): the "no PII beyond the incident lifecycle"
// guarantee held only if a human remembered to run it. A privacy guarantee that depends on someone
// remembering is not a guarantee.
//
// THE THREE DESIGN CONSTRAINTS, each load-bearing:
//  • NO CRON DEPENDENCY. `FEATURE_QUEUE=cron` (AGENTS.md §1) means "an interval loop in-process", not a cron
//    library. This is that loop: ~40 lines, zero new packages.
//  • THE TIMER AND THE CLOCK ARE INJECTED. Tests drive `SchedulerTimer` by hand — no real timers, no
//    fake-timer library, no wall clock — so a scheduling test is as deterministic as a pure function.
//  • IT IS STARTED FROM THE SERVER COMPOSITION ROOT AND NOWHERE ELSE. Nothing here runs at import time, so
//    importing this module (as a test does) acquires no background loop. `startBackgroundJobs` additionally
//    refuses to start under `NODE_ENV=test`, and both jobs are pinned OFF in `playwright.config.ts`'s
//    `webServer.env` — three independent reasons a gate never grows a background timer.
//
// A JOB THAT THROWS IS AUDITED AND THE LOOP CONTINUES (FR-LD-12). Background work that can take the server
// process down is worse than no background work at all.
import type { Env } from '@/config/index.js';
import type { GovernanceLedgerPort, RetentionStorePort } from '@/ports/governance.js';
import type { NotificationPort } from '@/ports/interaction.js';
import type { AuditSink } from '@/adapters/compliance/audit-chain.js';
import { makeAuditChain } from '@/adapters/compliance/audit-chain.js';
import { makeGovernanceLedger } from '@/adapters/governance/ledger.js';
import { makeDb } from '@/adapters/persistence/client.js';
import { makePgRetentionStore } from '@/adapters/persistence/retention-store.js';
import { runRetentionSweep } from '@/application/governance/retention-sweep.js';
import type { WatchedSignal } from '@/application/demo-watch/demo-watch.js';
import { makeDemoWatcher } from '@/application/demo-watch/demo-watch.js';
import type { ThresholdAlertSpec } from '@/application/derivation/derive-alerts.js';
import type { FeatureSeed } from '@/main/feature-seed.js';
import { DEFAULT_FEATURE_SEED } from '@/main/feature-seed.js';

const MS_PER_SEC = 1000;

/** Job names — exported so the composition test and the operator docs name the SAME strings. */
export const RETENTION_JOB = 'retention-sweep';
export const DEMO_WATCH_JOB = 'demo-auto-report';
export const LIVE_REINGEST_JOB = 'live-reingest';

/** The audit action a job failure is recorded under (FR-LD-12). */
export const SCHEDULED_JOB_FAILED = 'SCHEDULED_JOB_FAILED';

/**
 * Injectable timer surface — the same two-method shape `app/_lib/sse.ts`'s `TimerApi` uses for the polling
 * ladder, so the project has ONE idea of "an injectable timer" rather than two.
 */
export interface SchedulerTimer {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

/** One registered piece of recurring work. `run` may be sync or async; it is never allowed to throw upward. */
export interface ScheduledJob {
  readonly name: string;
  readonly intervalSec: number;
  run(): Promise<void> | void;
}

export interface Scheduler {
  readonly jobNames: readonly string[];
  readonly running: boolean;
  start(): void;
  stop(): void;
}

export interface SchedulerDeps {
  readonly jobs: readonly ScheduledJob[];
  /** Injected clock — a job-failure record is stamped from it, never from a wall-clock read (Art. XII). */
  readonly clock: () => string;
  readonly timer?: SchedulerTimer;
  /** Where a job failure is recorded. Only `append` is needed, so a test fake is one method. */
  readonly audit?: Pick<AuditSink, 'append'>;
}

/**
 * The real timer. Mirrors `app/_lib/sse.ts`'s `defaultTimer` cast idiom (Node vs DOM handle types).
 *
 * AND IT UNREFS (the `sitrep-synthesis.ts` idiom, optional-called because a DOM handle has no `unref`). A
 * recurring background loop must never be the reason a process refuses to exit: the server is held open by
 * its listening socket, so a job timer that also holds it open only ever turns a clean shutdown into a hang.
 */
const defaultTimer: SchedulerTimer = {
  set: (fn, ms) => {
    const handle = setInterval(fn, ms);
    (handle as unknown as { unref?: () => void }).unref?.();
    return handle as unknown as number;
  },
  clear: (id) => clearInterval(id as unknown as ReturnType<typeof setInterval>),
};

/**
 * Build a scheduler over a fixed job list. `start` is idempotent and `stop` releases every handle, so a
 * composition that is built twice (or a test that starts and stops repeatedly) leaks no timers.
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  const timer = deps.timer ?? defaultTimer;
  const handles: number[] = [];
  const inFlight = new Set<string>();
  let running = false;

  return {
    jobNames: deps.jobs.map((job) => job.name),

    get running(): boolean {
      return running;
    },

    start(): void {
      if (running) return;
      running = true;
      for (const job of deps.jobs) {
        handles.push(
          timer.set(() => void runJob(job, deps, inFlight), job.intervalSec * MS_PER_SEC),
        );
      }
    },

    stop(): void {
      for (const handle of handles) timer.clear(handle);
      handles.length = 0;
      running = false;
    },
  };
}

/**
 * Run one job tick. Two guarantees:
 *  • NO OVERLAP — a tick that arrives while the previous run of the SAME job is still in flight is dropped,
 *    so a slow sweep cannot stack up behind itself and turn one slow job into unbounded concurrency.
 *  • NO ESCAPE — a synchronous throw and a rejected promise are both caught, audited, and swallowed
 *    (FR-LD-12). An unhandled rejection from a `setInterval` callback terminates a Node process by default,
 *    which is exactly the failure mode this catch exists to prevent.
 */
async function runJob(
  job: ScheduledJob,
  deps: SchedulerDeps,
  inFlight: Set<string>,
): Promise<void> {
  if (inFlight.has(job.name)) return;
  inFlight.add(job.name);
  try {
    await job.run();
  } catch (error) {
    auditJobFailure(deps, job, error);
  } finally {
    inFlight.delete(job.name);
  }
}

/**
 * Record a job failure. The message is carried in the audit TARGET (action + target + instant are the only
 * fields the chain holds), truncated so a huge upstream error cannot bloat the append-only log.
 */
function auditJobFailure(deps: SchedulerDeps, job: ScheduledJob, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  try {
    deps.audit?.append({
      action: SCHEDULED_JOB_FAILED,
      target: `job:${job.name}:${reason.slice(0, 120)}`,
      at: deps.clock(),
    });
  } catch {
    // The audit sink itself failing must not resurrect the very crash this handler exists to contain.
  }
}

// ── Composition: the two jobs BEACON ships ──────────────────────────────────────────────────────────────

export interface BackgroundJobsOptions {
  /** The VALIDATED config (`loadConfig`) — every flag below is read from here, never from `process.env`. */
  readonly config: Env;
  readonly clock: () => string;
  /**
   * The composed report store, whichever one the composition root built. Typed `object` rather than
   * `Partial<RetentionStorePort>` because the Postgres report store shares NO property with that port (its
   * retention half is a separate adapter, selected below), and TypeScript's weak-type detection rejects a
   * zero-overlap object against an all-optional type — so the narrower annotation would force the caller to
   * cast, moving the decision to the side that knows least. The structural guard below is what decides
   * whether this store can sweep.
   */
  readonly reports?: object | undefined;
  readonly notifier?: NotificationPort | undefined;
  readonly audience?: readonly string[] | undefined;
  /** Overridable signal slice for the watcher; defaults to the shipped feature seed's rules for the region. */
  readonly signals?: (() => Promise<readonly WatchedSignal[]>) | undefined;
  readonly seed?: FeatureSeed | undefined;
  readonly audit?: AuditSink | undefined;
  readonly timer?: SchedulerTimer | undefined;
  /**
   * V2·A12 — one periodic live re-ingest (`src/main/live-refresh.ts`), supplied by the HTTP composition root
   * because only it can rebuild and swap the served picture. A FUNCTION rather than the picture itself for
   * the reason `signals` above is one: the scheduler owns WHEN, never WHAT. Absent ⇒ no job, so nothing
   * outside the live composition can acquire a re-ingest loop.
   */
  readonly reingest?: (() => Promise<void>) | undefined;
}

/** The started background composition. `audit`/`ledger` stay reachable so the chain can be verified. */
export interface BackgroundJobs {
  readonly scheduler: Scheduler;
  readonly audit: AuditSink;
  readonly ledger: GovernanceLedgerPort;
}

/**
 * Start BEACON's background work. Returns `undefined` — having created no timer at all — when there is
 * nothing to run, so the default offline profile behaves exactly as it did before this file existed.
 *
 * THE TEST/GATE GUARD IS FIRST AND IS DELIBERATELY BLUNT. Under `NODE_ENV=test` no background loop starts,
 * whatever the flags say. A gate that silently acquired a timer would make every suite's teardown racy and
 * would let a demo notification fire from a test run — neither is a trade worth a flag.
 */
export function startBackgroundJobs(options: BackgroundJobsOptions): BackgroundJobs | undefined {
  if (options.config.NODE_ENV === 'test') return undefined;
  const audit = options.audit ?? makeAuditChain();
  const ledger = makeGovernanceLedger({ audit });
  const jobs = [
    ...retentionJobs(options, ledger),
    ...demoWatchJobs(options, audit),
    ...reingestJobs(options),
  ];
  if (jobs.length === 0) return undefined;
  const scheduler = createScheduler({
    jobs,
    clock: options.clock,
    audit,
    ...(options.timer !== undefined ? { timer: options.timer } : {}),
  });
  scheduler.start();
  return { scheduler, audit, ledger };
}

/**
 * The Art. XIV retention job (FR-LD-11). The sweep EXECUTOR is unchanged — this only gives it a heartbeat
 * and the governance ledger it always accepted, so each sweep appends its own `RETENTION_PURGE`
 * AUDIT_EVENT (aggregate-only: counts and instants, never the purged ids).
 */
function retentionJobs(
  options: BackgroundJobsOptions,
  ledger: GovernanceLedgerPort,
): readonly ScheduledJob[] {
  if (options.config.RETENTION_SWEEP_ENABLED !== 'on') return [];
  const store = retentionStoreFor(options);
  if (store === undefined) return [];
  return [
    {
      name: RETENTION_JOB,
      intervalSec: options.config.RETENTION_SWEEP_INTERVAL_SEC,
      run: async () => {
        await runRetentionSweep({ store, ledger, clock: options.clock });
      },
    },
  ];
}

/**
 * Which store the sweep enforces retention on — the same `FEATURE_STORE` choice `makeReportStore` makes, so
 * the guarantee is never enforced against a different store than the one the app writes to.
 */
function retentionStoreFor(options: BackgroundJobsOptions): RetentionStorePort | undefined {
  if (options.config.FEATURE_STORE === 'postgres') {
    return makePgRetentionStore(makeDb(options.config.DATABASE_URL));
  }
  return isRetentionStore(options.reports) ? options.reports : undefined;
}

function isRetentionStore(store: object | undefined): store is RetentionStorePort {
  if (store === undefined) return false;
  // The one narrowing in this file, and it lives INSIDE the guard that proves it: every field the port
  // requires is checked below, so the assertion the caller relies on is the assertion this function makes.
  const candidate = store as Partial<RetentionStorePort>;
  return (
    typeof candidate.storeLabel === 'string' &&
    typeof candidate.datasetLabel === 'string' &&
    typeof candidate.expired === 'function' &&
    typeof candidate.purge === 'function'
  );
}

/**
 * The demo auto-report job (FR-LD-13/FR-LD-14, plan §0 decision 18). Registered ONLY when the flag is on AND
 * a real audience + audited notifier exist — i.e. only when `CHANNEL_TELEGRAM_MODE=live` composed them
 * (`makeBroadcastDeps`, feature-seed.ts). With no broadcast wired there is nobody to notify, so no job is
 * created rather than a job that ticks forever doing nothing.
 */
function demoWatchJobs(options: BackgroundJobsOptions, audit: AuditSink): readonly ScheduledJob[] {
  const { config, notifier, audience } = options;
  if (config.DEMO_AUTO_REPORT !== 'on') return [];
  if (notifier === undefined || audience === undefined || audience.length === 0) return [];
  const regionId = config.DEMO_AUTO_REPORT_REGION;
  const watcher = makeDemoWatcher({
    regionId,
    signals:
      options.signals ??
      watchedSignalsFromSeed(options.seed ?? DEFAULT_FEATURE_SEED, regionId, options.clock),
    notifier,
    audience,
    clock: options.clock,
    once: config.DEMO_AUTO_REPORT_ONCE === 'on',
    audit,
  });
  return [
    {
      name: DEMO_WATCH_JOB,
      intervalSec: config.DEMO_AUTO_REPORT_INTERVAL_SEC,
      run: async () => {
        await watcher.tick();
      },
    },
  ];
}

/**
 * The periodic live re-ingest job (V2·A12). Registered ONLY when the operator set a non-zero
 * `LIVE_REINGEST_INTERVAL_SEC` AND a runner was composed — with neither, no timer is created at all, which
 * is the default and therefore leaves the offline/air-gapped/Playwright profiles byte-identical.
 *
 * THE NO-STACKING GUARANTEE IS THE SCHEDULER'S OWN and is not restated here: `runJob` drops a tick that
 * arrives while the previous run of the SAME job is still in flight. That matters more for this job than for
 * the other two — the composition does ~17 s of real upstream work across five regions, so a second
 * mechanism (or a queue) would multiply the load on free public services exactly when they are slowest.
 */
function reingestJobs(options: BackgroundJobsOptions): readonly ScheduledJob[] {
  const intervalSec = options.config.LIVE_REINGEST_INTERVAL_SEC;
  const run = options.reingest;
  if (intervalSec === 0 || run === undefined) return [];
  return [{ name: LIVE_REINGEST_JOB, intervalSec, run }];
}

/**
 * The S1 signal slice: the SHIPPED threshold rules for the watched region, exactly the rules the DRAFT-alert
 * derivation already evaluates (`computeDraftAlerts`, feature-seed.ts) — so the monitoring beat and the
 * on-screen DRAFT queue can never disagree about what fired.
 *
 * Provenance is labelled `MOCK` because the seeded readings ARE the offline demo dataset; that is Art. XVI
 * honest labelling, not a placeholder. S2 replaces this provider with the region's live adapter slices and
 * the mode label follows the adapter — no change is needed in `demo-watch.ts` for that, which is the whole
 * reason `signals` is a function and not a data field.
 */
export function watchedSignalsFromSeed(
  seed: FeatureSeed,
  regionId: string,
  clock: () => string,
): () => Promise<readonly WatchedSignal[]> {
  return async () => {
    const now = Date.parse(clock());
    const specs = [...seed.thresholds, ...(seed.forecastThresholds?.(now) ?? [])];
    const fetchedAt = clock();
    return specs
      .filter((spec) => seed.incidentRegions?.get(String(spec.incidentId)) === regionId)
      .map((spec) => toWatchedSignal(spec, fetchedAt));
  };
}

function toWatchedSignal(spec: ThresholdAlertSpec, fetchedAt: string): WatchedSignal {
  return {
    rule: spec.rule,
    reading: spec.reading,
    category: spec.category,
    severity: spec.severity,
    source: { sourceId: String(spec.sourceId), mode: 'MOCK', fetchedAt },
    summary: `incident ${String(spec.incidentId)} crossed ${spec.rule.target} ${spec.rule.value}`,
  };
}
