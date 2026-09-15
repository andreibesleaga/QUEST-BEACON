// BEACON — background-work seam tests (ADR-037 §2; FR-LD-11 / FR-LD-12).
//
// NO REAL TIMERS AND NO FAKE-TIMER LIBRARY. The scheduler's timer is a two-method injected port, so a hand
// written `FakeTimer` drives every tick synchronously — the suite never waits on wall time, never installs a
// global timer shim, and cannot flake under load. The clock is pinned to the project's fixed instant.
//
// NOTHING IN THIS FILE STARTS BACKGROUND WORK BY IMPORTING THE MODULE: the first assertion below is exactly
// that, because "the scheduler must never start at import time" is the property that keeps every other gate
// (vitest, Playwright) free of a stray loop.
import { describe, expect, it, vi } from 'vitest';
import { loadConfig, type Env } from '@/config/index.js';
import type { NotificationPort } from '@/ports/interaction.js';
import type { AuditAppendInput } from '@/adapters/compliance/audit-chain.js';
import type { AuditEvent } from '@/domain/audit-event.js';
import { ok } from '@/domain/shared/result.js';
import { FakeRetentionStore } from '../../tests/_harness/fakes/fake-governance.js';
import {
  DEMO_WATCH_JOB,
  RETENTION_JOB,
  SCHEDULED_JOB_FAILED,
  createScheduler,
  startBackgroundJobs,
  watchedSignalsFromSeed,
  type ScheduledJob,
  type SchedulerTimer,
} from './scheduler.js';
import { DEFAULT_FEATURE_SEED } from './feature-seed.js';

const T0 = '2026-07-05T22:00:00.000Z';
const clock = (): string => T0;

/** Flush the microtask queue. Deterministic (no `setTimeout`/`setImmediate`) — a job's promise settles here. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

interface Registration {
  readonly id: number;
  readonly fn: () => void;
  readonly ms: number;
}

/** The injected timer. `tick()` fires every LIVE registration once — the only way time moves in this file. */
class FakeTimer implements SchedulerTimer {
  readonly registered: Registration[] = [];
  readonly cleared: number[] = [];
  #next = 1;

  set(fn: () => void, ms: number): number {
    const id = this.#next++;
    this.registered.push({ id, fn, ms });
    return id;
  }

  clear(id: number): void {
    this.cleared.push(id);
  }

  get live(): readonly Registration[] {
    return this.registered.filter((r) => !this.cleared.includes(r.id));
  }

  tick(): void {
    for (const r of this.live) r.fn();
  }
}

/** The narrow audit surface the scheduler writes job failures to. Records inputs verbatim. */
class SpyAudit {
  readonly appended: AuditAppendInput[] = [];
  throwOnAppend = false;

  append(input: AuditAppendInput): AuditEvent {
    if (this.throwOnAppend) throw new Error('audit sink is down');
    this.appended.push(input);
    return {
      id: 'ae-1',
      action: input.action,
      target: input.target,
      at: input.at ?? T0,
      hash: 'h',
    } as AuditEvent;
  }
}

const baseConfig = (overrides: Partial<Env> = {}): Env => ({
  ...loadConfig({ NODE_ENV: 'development' }),
  RETENTION_SWEEP_ENABLED: 'off',
  DEMO_AUTO_REPORT: 'off',
  ...overrides,
});

const acceptingNotifier: NotificationPort = { notify: () => Promise.resolve(ok(undefined)) };

describe('createScheduler', () => {
  it('registers NOTHING until start() — importing or building a scheduler acquires no timer', () => {
    const timer = new FakeTimer();
    const scheduler = createScheduler({
      jobs: [{ name: 'j', intervalSec: 60, run: () => undefined }],
      clock,
      timer,
    });
    expect(timer.registered).toHaveLength(0);
    expect(scheduler.running).toBe(false);
    expect(scheduler.jobNames).toEqual(['j']);
  });

  it('registers one interval per job, at the job’s OWN interval in milliseconds', () => {
    const timer = new FakeTimer();
    createScheduler({
      jobs: [
        { name: 'fast', intervalSec: 120, run: () => undefined },
        { name: 'slow', intervalSec: 3600, run: () => undefined },
      ],
      clock,
      timer,
    }).start();
    expect(timer.registered.map((r) => r.ms)).toEqual([120_000, 3_600_000]);
  });

  it('runs each job on every tick', async () => {
    const timer = new FakeTimer();
    const run = vi.fn();
    createScheduler({ jobs: [{ name: 'j', intervalSec: 60, run }], clock, timer }).start();
    timer.tick();
    await flush(); // let the run settle — back-to-back ticks are DROPPED by the no-overlap guard, by design
    timer.tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('start() is idempotent — a second start registers no second interval', () => {
    const timer = new FakeTimer();
    const scheduler = createScheduler({
      jobs: [{ name: 'j', intervalSec: 60, run: () => undefined }],
      clock,
      timer,
    });
    scheduler.start();
    scheduler.start();
    expect(timer.registered).toHaveLength(1);
    expect(scheduler.running).toBe(true);
  });

  it('stop() clears EVERY handle and the loop goes quiet', async () => {
    const timer = new FakeTimer();
    const run = vi.fn();
    const scheduler = createScheduler({
      jobs: [
        { name: 'a', intervalSec: 60, run },
        { name: 'b', intervalSec: 90, run },
      ],
      clock,
      timer,
    });
    scheduler.start();
    scheduler.stop();
    expect(timer.cleared).toEqual([1, 2]);
    expect(scheduler.running).toBe(false);
    timer.tick(); // nothing is live any more
    await flush();
    expect(run).not.toHaveBeenCalled();
  });

  it('AUDITS a throwing job and KEEPS SCHEDULING it — a bad job never takes the loop down (FR-LD-12)', async () => {
    const timer = new FakeTimer();
    const audit = new SpyAudit();
    let calls = 0;
    const job: ScheduledJob = {
      name: 'exploding',
      intervalSec: 60,
      run: () => {
        calls += 1;
        throw new Error('boom');
      },
    };
    createScheduler({ jobs: [job], clock, timer, audit }).start();
    timer.tick();
    await flush();
    timer.tick(); // the load-bearing assertion: the NEXT tick still runs
    await flush();

    expect(calls).toBe(2);
    expect(audit.appended).toHaveLength(2);
    expect(audit.appended[0]?.action).toBe(SCHEDULED_JOB_FAILED);
    expect(audit.appended[0]?.target).toBe('job:exploding:boom');
    expect(audit.appended[0]?.at).toBe(T0); // the INJECTED clock, never a wall-clock read
  });

  it('catches a REJECTED promise too — an unhandled rejection from a timer callback kills a Node process', async () => {
    const timer = new FakeTimer();
    const audit = new SpyAudit();
    createScheduler({
      jobs: [
        {
          name: 'async-boom',
          intervalSec: 60,
          run: () => Promise.reject(new Error('async failure')),
        },
      ],
      clock,
      timer,
      audit,
    }).start();
    timer.tick();
    await flush();
    expect(audit.appended[0]?.target).toBe('job:async-boom:async failure');
  });

  it('records a non-Error throw without pretending it had a message', async () => {
    const timer = new FakeTimer();
    const audit = new SpyAudit();
    createScheduler({
      jobs: [
        {
          name: 'weird',
          intervalSec: 60,
          run: () => {
            throw 'a bare string';
          },
        },
      ],
      clock,
      timer,
      audit,
    }).start();
    timer.tick();
    await flush();
    expect(audit.appended[0]?.target).toBe('job:weird:a bare string');
  });

  it('survives an audit sink that itself throws — the containment handler cannot become the crash', async () => {
    const timer = new FakeTimer();
    const audit = new SpyAudit();
    audit.throwOnAppend = true;
    let calls = 0;
    createScheduler({
      jobs: [
        {
          name: 'exploding',
          intervalSec: 60,
          run: () => {
            calls += 1;
            throw new Error('boom');
          },
        },
      ],
      clock,
      timer,
      audit,
    }).start();
    timer.tick();
    await flush();
    timer.tick();
    await flush();
    expect(calls).toBe(2);
  });

  it('never overlaps a job with itself — a tick during a slow run is DROPPED, not queued', async () => {
    const timer = new FakeTimer();
    let started = 0;
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    createScheduler({
      jobs: [
        {
          name: 'slow',
          intervalSec: 60,
          run: async () => {
            started += 1;
            await gate;
          },
        },
      ],
      clock,
      timer,
    }).start();

    timer.tick();
    await flush();
    timer.tick(); // arrives while the first run is still in flight
    await flush();
    expect(started).toBe(1);

    release();
    await flush();
    timer.tick(); // the job is free again
    await flush();
    expect(started).toBe(2);
  });

  it('falls back to the REAL timer when none is injected — registered and released in the same tick', () => {
    // The only test that touches `setInterval`, deliberately: it starts a one-hour interval and clears it
    // immediately, so the default timer path is covered without the suite ever WAITING on wall time. Nothing
    // here is time-dependent — the callback is never allowed to fire.
    const scheduler = createScheduler({
      jobs: [{ name: 'j', intervalSec: 3600, run: () => undefined }],
      clock,
    });
    scheduler.start();
    expect(scheduler.running).toBe(true);
    scheduler.stop();
    expect(scheduler.running).toBe(false);
  });

  it('runs with no audit sink configured (the failure path degrades, it does not throw)', async () => {
    const timer = new FakeTimer();
    createScheduler({
      jobs: [
        {
          name: 'exploding',
          intervalSec: 60,
          run: () => {
            throw new Error('boom');
          },
        },
      ],
      clock,
      timer,
    }).start();
    timer.tick();
    await expect(flush()).resolves.toBeUndefined();
  });
});

describe('startBackgroundJobs — the gate guard', () => {
  it('starts NOTHING under NODE_ENV=test, whatever the flags say', () => {
    const timer = new FakeTimer();
    const started = startBackgroundJobs({
      config: baseConfig({
        NODE_ENV: 'test',
        RETENTION_SWEEP_ENABLED: 'on',
        DEMO_AUTO_REPORT: 'on',
      }),
      clock,
      timer,
      reports: new FakeRetentionStore({ 'rep-1': '2026-06-01T00:00:00.000Z' }),
      notifier: acceptingNotifier,
      audience: ['chat-1'],
    });
    expect(started).toBeUndefined();
    expect(timer.registered).toHaveLength(0);
  });

  it('creates no timer at all when every job is disabled (the default profile is unchanged)', () => {
    const timer = new FakeTimer();
    expect(startBackgroundJobs({ config: baseConfig(), clock, timer })).toBeUndefined();
    expect(timer.registered).toHaveLength(0);
  });
});

describe('startBackgroundJobs — the retention job (FR-LD-11, register row 20)', () => {
  it('SWEEPS on its interval and appends a RETENTION_PURGE governance record per sweep', async () => {
    const timer = new FakeTimer();
    const store = new FakeRetentionStore({
      'rep-expired': '2026-06-05T22:00:00.000Z',
      'rep-live': '2026-08-04T22:00:00.000Z',
    });
    const started = startBackgroundJobs({
      config: baseConfig({ RETENTION_SWEEP_ENABLED: 'on', RETENTION_SWEEP_INTERVAL_SEC: 900 }),
      clock,
      timer,
      reports: store,
    });
    expect(started?.scheduler.jobNames).toEqual([RETENTION_JOB]);
    expect(timer.registered[0]?.ms).toBe(900_000);

    timer.tick();
    await flush();

    // The row is GONE from the running app without a human running anything — the point of row 20.
    expect(store.remaining).toEqual(['rep-live']);
    const entry = started?.ledger.entries[0];
    expect(entry?.action).toBe('RETENTION_PURGE');
    expect(entry?.target).toBe('retention:public_report');
    expect(entry?.at).toBe(T0);
  });

  it('registers no retention job when the store cannot sweep (no silent half-enforcement)', () => {
    const timer = new FakeTimer();
    const started = startBackgroundJobs({
      config: baseConfig({ RETENTION_SWEEP_ENABLED: 'on' }),
      clock,
      timer,
      reports: { storeLabel: 'postgres' }, // a report store WITHOUT the retention half
    });
    expect(started).toBeUndefined();
    expect(timer.registered).toHaveLength(0);
  });

  it('sweeps the DURABLE store under FEATURE_STORE=postgres, not the memory one', () => {
    // The guarantee must be enforced against the store the app actually WRITES to — a sweep pointed at the
    // wrong store is F-25 with extra steps. Composition only: the job is registered and the scheduler is
    // stopped without ticking, so no query is issued and no connection is opened.
    const timer = new FakeTimer();
    const memoryStore = new FakeRetentionStore({ 'rep-expired': '2026-06-05T22:00:00.000Z' });
    const started = startBackgroundJobs({
      config: baseConfig({
        RETENTION_SWEEP_ENABLED: 'on',
        FEATURE_STORE: 'postgres',
        DATABASE_URL: 'postgres://beacon:beacon@db.invalid:5432/beacon_test',
      }),
      clock,
      timer,
      reports: memoryStore,
    });
    expect(started?.scheduler.jobNames).toEqual([RETENTION_JOB]);
    started?.scheduler.stop();
    expect(memoryStore.remaining).toHaveLength(1); // the in-memory store was NOT the sweep target
  });

  it('a failing sweep is contained by the scheduler, not propagated', async () => {
    const timer = new FakeTimer();
    const store = new FakeRetentionStore({ 'rep-expired': '2026-06-05T22:00:00.000Z' });
    store.failPurge = true;
    const started = startBackgroundJobs({
      config: baseConfig({ RETENTION_SWEEP_ENABLED: 'on' }),
      clock,
      timer,
      reports: store,
    });
    timer.tick();
    await expect(flush()).resolves.toBeUndefined();
    expect(started?.scheduler.running).toBe(true);
  });
});

describe('startBackgroundJobs — the demo watcher job (FR-LD-13)', () => {
  const watchConfig = (overrides: Partial<Env> = {}): Env =>
    baseConfig({
      DEMO_AUTO_REPORT: 'on',
      DEMO_AUTO_REPORT_REGION: 'us-ca',
      DEMO_AUTO_REPORT_INTERVAL_SEC: 120,
      DEMO_AUTO_REPORT_ONCE: 'on',
      ...overrides,
    });

  it('registers the watcher at its configured interval and sends on the first critical signal', async () => {
    const timer = new FakeTimer();
    const notify = vi.fn(() => Promise.resolve(ok(undefined)));
    const started = startBackgroundJobs({
      config: watchConfig(),
      clock,
      timer,
      notifier: { notify },
      audience: ['chat-1'],
    });
    expect(started?.scheduler.jobNames).toEqual([DEMO_WATCH_JOB]);
    expect(timer.registered[0]?.ms).toBe(120_000);

    timer.tick();
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('registers NO watcher without an audited notifier or without an audience — nobody to notify', () => {
    const timer = new FakeTimer();
    expect(
      startBackgroundJobs({ config: watchConfig(), clock, timer, audience: ['chat-1'] }),
    ).toBeUndefined();
    expect(
      startBackgroundJobs({
        config: watchConfig(),
        clock,
        timer,
        notifier: acceptingNotifier,
        audience: [],
      }),
    ).toBeUndefined();
    expect(timer.registered).toHaveLength(0);
  });

  it('registers NO watcher when DEMO_AUTO_REPORT is off, even with a live notifier composed', () => {
    const timer = new FakeTimer();
    const started = startBackgroundJobs({
      config: baseConfig(),
      clock,
      timer,
      notifier: acceptingNotifier,
      audience: ['chat-1'],
    });
    expect(started).toBeUndefined();
  });

  it('runs BOTH jobs when both are enabled', () => {
    const timer = new FakeTimer();
    const started = startBackgroundJobs({
      config: watchConfig({ RETENTION_SWEEP_ENABLED: 'on' }),
      clock,
      timer,
      reports: new FakeRetentionStore({}),
      notifier: acceptingNotifier,
      audience: ['chat-1'],
    });
    expect(started?.scheduler.jobNames).toEqual([RETENTION_JOB, DEMO_WATCH_JOB]);
  });
});

describe('watchedSignalsFromSeed', () => {
  it('serves ONLY the watched region’s seeded rules, each carrying its own citation and freshness', async () => {
    const signals = await watchedSignalsFromSeed(DEFAULT_FEATURE_SEED, 'us-ca', clock)();
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal.source.sourceId.length).toBeGreaterThan(0);
      expect(signal.source.mode).toBe('MOCK'); // honest labelling of the offline dataset (Art. XVI)
      expect(signal.source.fetchedAt).toBe(T0);
      expect(signal.summary.length).toBeGreaterThan(0);
    }
    // The RO flood rules belong to the RO region and must not leak into a us-ca watch.
    const ro = await watchedSignalsFromSeed(DEFAULT_FEATURE_SEED, 'ro', clock)();
    const usRules = new Set(signals.map((s) => String(s.rule.id)));
    for (const signal of ro) expect(usRules.has(String(signal.rule.id))).toBe(false);
  });

  it('is empty for a region the seed knows nothing about (no fabricated signal)', async () => {
    expect(await watchedSignalsFromSeed(DEFAULT_FEATURE_SEED, 'nowhere', clock)()).toEqual([]);
  });

  it('tolerates a seed with no forecast rules at all', async () => {
    const seed = { ...DEFAULT_FEATURE_SEED };
    delete (seed as { forecastThresholds?: unknown }).forecastThresholds;
    const signals = await watchedSignalsFromSeed(seed, 'ro', clock)();
    expect(signals.every((s) => s.rule.target !== 'FORECAST_GAUGE_CATEGORY')).toBe(true);
  });
});
