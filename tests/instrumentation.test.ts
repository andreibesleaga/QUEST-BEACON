// BEACON — the boot warm-up (see ../instrumentation.ts). Pins the three properties that matter: it runs
// the real composition getter on the node runtime, it stays out of the edge runtime, and a failing warm-up
// never throws out of `register` (a throw there would fail the whole server start).
//
// WHY THIS FILE IS HERE AND NOT BESIDE THE MODULE. `instrumentation.ts` must sit at the project root —
// that is where Next looks for it — but the vitest include list covers `tests/`, `src/` and `app/` only.
// A root-level test file is invisible to the suite: it never runs, reports nothing, and looks exactly like
// a test that was never written. The first version of this file lived at the root and "passed" that way.
import { afterEach, describe, expect, it, vi } from 'vitest';

const getHttpDepsAsync = vi.fn();
const getHttpDepsAsyncTiming = vi.fn(() => ({}));
vi.mock('@/adapters/channels/http/http-dispatcher.js', () => ({
  getHttpDepsAsync,
  getHttpDepsAsyncTiming,
}));

async function registerWith(runtime: string | undefined, delayMs = '0'): Promise<void> {
  vi.resetModules();
  vi.stubEnv('BEACON_WARMUP_DELAY_MS', delayMs);
  if (runtime === undefined) vi.stubEnv('NEXT_RUNTIME', '');
  else vi.stubEnv('NEXT_RUNTIME', runtime);
  const mod = await import('../instrumentation.js');
  await mod.register();
}

describe('register — boot-time warm-up', () => {
  afterEach(() => {
    getHttpDepsAsync.mockReset();
    getHttpDepsAsyncTiming.mockReset();
    getHttpDepsAsyncTiming.mockReturnValue({});
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('starts the composition on the node runtime, exactly once, and logs completion with a duration', async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    getHttpDepsAsyncTiming.mockReturnValue({ startedAtMs: 100, settledAtMs: 160 });
    getHttpDepsAsync.mockResolvedValue({});
    await registerWith('nodejs');
    await vi.runAllTimersAsync();
    expect(getHttpDepsAsync).toHaveBeenCalledTimes(1);
    // The completion line is the whole point: without it a build that never finishes is invisible.
    expect(info).toHaveBeenCalledWith('[beacon] boot warm-up complete', { elapsedMs: 60 });
    info.mockRestore();
  });

  it('does nothing on the edge runtime — the composition cannot run there', async () => {
    vi.useFakeTimers();
    await registerWith('edge');
    await vi.runAllTimersAsync();
    expect(getHttpDepsAsync).not.toHaveBeenCalled();
  });

  it('a failing warm-up is logged and does not throw out of register', async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getHttpDepsAsyncTiming.mockReturnValue({ startedAtMs: 200, settledAtMs: 280 });
    getHttpDepsAsync.mockRejectedValue(new Error('DATABASE_URL is required'));
    await expect(registerWith('nodejs')).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    expect(err).toHaveBeenCalledWith('[beacon] boot warm-up failed; the first request will retry', {
      error: 'DATABASE_URL is required',
      elapsedMs: 80,
    });
    err.mockRestore();
  });

  it('falls back to the default delay when BEACON_WARMUP_DELAY_MS is invalid', async () => {
    vi.useFakeTimers();
    getHttpDepsAsync.mockResolvedValue({});
    await registerWith('nodejs', 'Infinity');
    await vi.advanceTimersByTimeAsync(9_999);
    expect(getHttpDepsAsync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getHttpDepsAsync).toHaveBeenCalledTimes(1);
  });
});
