// BEACON — periodic live re-ingest tests (V2·A12; Art. XVI).
//
// THE DEFECT UNDER TEST is not a slow path, it is a WRONG PICTURE: `createHttpDepsLive` is memoised behind
// one promise per server process (http-dispatcher.ts `cachedAsync`), so `assembleLiveSeeds` ran once at the
// first request and never again. Every adapter reading the COP served was therefore a BOOT-TIME snapshot —
// `fetched_at` re-stamped per boot rather than per fetch — and a wildfire that started after boot could not
// appear until somebody restarted the process.
//
// NO REAL TIMERS AND NO WALL CLOCK, exactly as scheduler.test.ts: the scheduler's timer is an injected
// two-method port and `assemble` is a promise this file resolves by hand, so "what was being served WHILE
// the rebuild was in flight" is an ordinary synchronous assertion rather than a race.
import { describe, expect, it, vi } from 'vitest';
import { loadConfig, type Env } from '@/config/index.js';
import { runLiveReingest } from './live-refresh.js';
import {
  LIVE_REINGEST_JOB,
  createScheduler,
  startBackgroundJobs,
  type SchedulerTimer,
} from './scheduler.js';

const T0 = '2026-07-05T22:00:00.000Z';
const clock = (): string => T0;

/** Flush the microtask queue. Deterministic (no `setTimeout`/`setImmediate`) — a job's promise settles here. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** The injected timer (the scheduler.test.ts shape) — `tick()` is the only way time moves in this file. */
class FakeTimer implements SchedulerTimer {
  readonly registered: { readonly id: number; readonly fn: () => void; readonly ms: number }[] = [];
  #next = 1;

  set(fn: () => void, ms: number): number {
    const id = this.#next++;
    this.registered.push({ id, fn, ms });
    return id;
  }

  clear(): void {
    /* nothing in this file stops a scheduler */
  }

  tick(): void {
    for (const r of this.registered) r.fn();
  }
}

const baseConfig = (overrides: Partial<Env> = {}): Env => ({
  ...loadConfig({ NODE_ENV: 'development' }),
  RETENTION_SWEEP_ENABLED: 'off',
  DEMO_AUTO_REPORT: 'off',
  ...overrides,
});

/**
 * A picture is just a label here. The refresher is deliberately generic over it — it must not know what an
 * HttpDeps is (src/main must never import the HTTP channel; `no-circular` in .dependency-cruiser.cjs), and a
 * test that can say "the served label is still `boot`" proves the atomicity property directly.
 */
interface Picture {
  readonly label: string;
}

/** The served picture + the commit that replaces it: the ONE statement a reader can observe changing. */
function server(initial: string) {
  let served: Picture = { label: initial };
  return {
    read: (): Picture => served,
    commit: (next: Picture): void => {
      served = next;
    },
    current: (): Promise<Picture> => Promise.resolve(served),
  };
}

describe('LIVE_REINGEST_INTERVAL_SEC (config)', () => {
  it('defaults to 0 — OFF, i.e. today’s boot-time-snapshot behaviour, byte for byte', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).LIVE_REINGEST_INTERVAL_SEC).toBe(0);
  });

  it('accepts the recommended LIVE cadence', () => {
    expect(
      loadConfig({ NODE_ENV: 'development', LIVE_REINGEST_INTERVAL_SEC: '900' })
        .LIVE_REINGEST_INTERVAL_SEC,
    ).toBe(900);
  });

  it('REFUSES TO BOOT below the politeness floor — a re-ingest is a full upstream fan-out', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', LIVE_REINGEST_INTERVAL_SEC: '30' })).toThrow(
      /LIVE_REINGEST_INTERVAL_SEC/,
    );
  });

  it('refuses a negative or fractional interval rather than silently rounding it', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'development', LIVE_REINGEST_INTERVAL_SEC: '-60' }),
    ).toThrow();
    expect(() =>
      loadConfig({ NODE_ENV: 'development', LIVE_REINGEST_INTERVAL_SEC: '90.5' }),
    ).toThrow();
  });
});

describe('runLiveReingest — the atomic swap', () => {
  it('serves the OLD complete picture for the whole rebuild, then the NEW one — never a mixture', async () => {
    const live = server('boot');
    let release!: (seeds: { readonly n: number } | null) => void;
    const assembled = new Promise<{ readonly n: number } | null>((resolve) => {
      release = resolve;
    });
    const compose = vi.fn((seeds: { readonly n: number }): Picture => ({
      label: `refresh-${seeds.n}`,
    }));

    const run = runLiveReingest({
      current: live.current,
      assemble: () => assembled,
      compose,
      commit: live.commit,
    });

    await flush();
    // The rebuild is in flight: the seeds have not arrived, so nothing may have been composed or published.
    expect(compose).not.toHaveBeenCalled();
    expect(live.read()).toEqual({ label: 'boot' });

    release({ n: 1 });
    await expect(run).resolves.toBe(true);
    expect(live.read()).toEqual({ label: 'refresh-1' });
    expect(compose).toHaveBeenCalledWith({ n: 1 }, { label: 'boot' });
  });

  it('composes from the CURRENT picture each run, so two refreshes chain rather than fork', async () => {
    const live = server('boot');
    const compose = (seeds: { readonly n: number }, previous: Picture): Picture => ({
      label: `${previous.label}>${seeds.n}`,
    });
    await runLiveReingest({
      current: live.current,
      assemble: () => Promise.resolve({ n: 1 }),
      compose,
      commit: live.commit,
    });
    await runLiveReingest({
      current: live.current,
      assemble: () => Promise.resolve({ n: 2 }),
      compose,
      commit: live.commit,
    });
    expect(live.read()).toEqual({ label: 'boot>1>2' });
  });
});

describe('runLiveReingest — a failed re-ingest is a DEGRADED refresh, never an outage (Art. XVI)', () => {
  it('keeps the last good picture when nothing live was assembled, and never composes a half-picture', async () => {
    const live = server('boot');
    const compose = vi.fn();
    await expect(
      runLiveReingest({
        current: live.current,
        assemble: () => Promise.resolve(null),
        compose,
        commit: live.commit,
      }),
    ).resolves.toBe(false);
    expect(compose).not.toHaveBeenCalled();
    expect(live.read()).toEqual({ label: 'boot' });
  });

  it('keeps the last good picture when the assembly THROWS, and propagates so the scheduler audits it', async () => {
    const live = server('boot');
    const commit = vi.fn(live.commit);
    await expect(
      runLiveReingest({
        current: live.current,
        assemble: () => Promise.reject(new Error('upstream is down')),
        compose: () => ({ label: 'never' }),
        commit,
      }),
    ).rejects.toThrow('upstream is down');
    expect(commit).not.toHaveBeenCalled();
    expect(live.read()).toEqual({ label: 'boot' });
  });
});

describe('runLiveReingest — the doorbell', () => {
  it('announces AFTER the swap, with the picture that is now being served', async () => {
    const live = server('boot');
    const seen: string[] = [];
    await runLiveReingest({
      current: live.current,
      assemble: () => Promise.resolve({ n: 1 }),
      compose: () => ({ label: 'refresh' }),
      commit: (next) => {
        seen.push(`commit:${next.label}`);
        live.commit(next);
      },
      announce: (next) => {
        seen.push(`announce:${next.label}:${live.read().label}`);
        return Promise.resolve();
      },
    });
    expect(seen).toEqual(['commit:refresh', 'announce:refresh:refresh']);
  });

  it('does not announce a refresh that did not happen', async () => {
    const live = server('boot');
    const announce = vi.fn(() => Promise.resolve());
    await runLiveReingest({
      current: live.current,
      assemble: () => Promise.resolve(null),
      compose: () => ({ label: 'never' }),
      commit: live.commit,
      announce,
    });
    expect(announce).not.toHaveBeenCalled();
  });

  it('a doorbell that fails does not un-commit the refresh or fail the run', async () => {
    const live = server('boot');
    await expect(
      runLiveReingest({
        current: live.current,
        assemble: () => Promise.resolve({ n: 1 }),
        compose: () => ({ label: 'refresh' }),
        commit: live.commit,
        announce: () => Promise.reject(new Error('no subscribers')),
      }),
    ).resolves.toBe(true);
    expect(live.read()).toEqual({ label: 'refresh' });
  });
});

describe('startBackgroundJobs — the re-ingest job', () => {
  it('creates NO job when the interval is 0, even with a runner wired', () => {
    const timer = new FakeTimer();
    const reingest = vi.fn(() => Promise.resolve());
    expect(startBackgroundJobs({ config: baseConfig(), clock, timer, reingest })).toBeUndefined();
    expect(timer.registered).toHaveLength(0);
    expect(reingest).not.toHaveBeenCalled();
  });

  it('creates NO job when no runner is wired, whatever the interval says', () => {
    const timer = new FakeTimer();
    expect(
      startBackgroundJobs({
        config: baseConfig({ LIVE_REINGEST_INTERVAL_SEC: 900 }),
        clock,
        timer,
      }),
    ).toBeUndefined();
    expect(timer.registered).toHaveLength(0);
  });

  it('registers ONE interval at the configured cadence and runs the re-ingest on each tick', async () => {
    const timer = new FakeTimer();
    const reingest = vi.fn(() => Promise.resolve());
    const started = startBackgroundJobs({
      config: baseConfig({ LIVE_REINGEST_INTERVAL_SEC: 900 }),
      clock,
      timer,
      reingest,
    });
    expect(started?.scheduler.jobNames).toEqual([LIVE_REINGEST_JOB]);
    expect(timer.registered.map((r) => r.ms)).toEqual([900_000]);
    timer.tick();
    await flush();
    timer.tick();
    await flush();
    expect(reingest).toHaveBeenCalledTimes(2);
  });

  it('DOES NOT STACK: a tick that arrives mid-re-ingest is dropped, not queued', async () => {
    const timer = new FakeTimer();
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reingest = vi.fn(() => inFlight);
    startBackgroundJobs({
      config: baseConfig({ LIVE_REINGEST_INTERVAL_SEC: 900 }),
      clock,
      timer,
      reingest,
    });

    timer.tick();
    await flush();
    timer.tick(); // the composition takes ~17 s across 5 regions — this tick MUST be dropped
    timer.tick();
    await flush();
    expect(reingest).toHaveBeenCalledTimes(1);

    release();
    await flush();
    timer.tick(); // ...and the NEXT tick after it settles runs normally
    await flush();
    expect(reingest).toHaveBeenCalledTimes(2);
  });
});

describe('the default scheduler timer', () => {
  it('unref()s its interval so a background loop never holds the process open', () => {
    const unref = vi.fn();
    const setSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue({ unref } as unknown as ReturnType<typeof setInterval>);
    try {
      createScheduler({
        jobs: [{ name: 'j', intervalSec: 900, run: () => undefined }],
        clock,
      }).start();
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(unref).toHaveBeenCalledTimes(1);
    } finally {
      setSpy.mockRestore();
    }
  });
});
