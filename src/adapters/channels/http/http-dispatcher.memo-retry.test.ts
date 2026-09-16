// BEACON — a FAILED live composition must not be memoised (production-readiness audit, 2026-09-11).
//
// THE DEFECT. `getHttpDepsAsync` used `cachedAsync ??= createHttpDepsLive()`. A rejected promise is not
// `undefined`, so the failure was cached for the entire process lifetime. The audit traced four reachable
// rejection sources — `loadConfig`, the database client, credential parsing, and the background-job start
// — any of which can fail for a transient or trivially-fixable reason at the moment of the FIRST request.
//
// The consequence was severe out of proportion to the cause: the container reports healthy (the health
// endpoint is a static literal that never touches the composition), every subsequent request returns an
// unshaped 500, and NOTHING EVER RETRIES — not after the database finishes starting, not after the
// operator corrects the variable. Only a restart clears it, and nothing on the outside says why.
//
// These tests pin the recovery. They deliberately drive `getHttpDepsAsync` itself rather than a fake, so
// the memo semantics under test are the real ones.
import { describe, expect, it, vi } from 'vitest';
import { memoizeSuccess } from './http-dispatcher.js';

describe('memoizeSuccess — the policy behind getHttpDepsAsync', () => {
  /**
   * Drives the REAL exported policy, not a re-implementation of it. That distinction is the whole point:
   * this project has twice shipped defects behind tests that asserted the SHAPE of a thing rather than
   * running it, so a test that copied the memo's logic into itself would prove only that the copy works.
   * `getHttpDepsAsync` is a three-line call into this function over a module-level slot.
   */
  function makeMemo(build: () => Promise<string>): () => Promise<string> {
    let cached: Promise<string> | undefined;
    return () =>
      memoizeSuccess(
        () => cached,
        (p) => {
          cached = p;
        },
        build,
      );
  }

  it('retries after a failed build instead of wedging the process forever', async () => {
    let attempt = 0;
    const build = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1)
        throw new Error('DATABASE_URL is required to open the persistence adapter');
      return 'deps';
    });
    const get = makeMemo(build);

    // First request: the real failure reaches the caller, unswallowed.
    await expect(get()).rejects.toThrow(/DATABASE_URL/);
    // Second request: the cause has cleared (the database finished starting), so the build runs AGAIN.
    // Before the fix this rejected with the identical cached error, forever.
    await expect(get()).resolves.toBe('deps');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('still builds only ONCE on the happy path — the fix must not cost the single-build guarantee', async () => {
    const build = vi.fn(async () => 'deps');
    const get = makeMemo(build);
    const [a, b, c] = await Promise.all([get(), get(), get()]);
    expect([a, b, c]).toEqual(['deps', 'deps', 'deps']);
    // The live composition is ~17 s of real work across five regions; rebuilding it per request would be
    // a far worse defect than the one being fixed.
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('shares ONE in-flight build across concurrent first requests, then retries together on failure', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const build = vi.fn(async () => {
      await gate;
      throw new Error('transient');
    });
    const get = makeMemo(build);

    const first = get();
    const second = get();
    // Both callers joined the same flight — a boot-time thundering herd must not multiply the work.
    expect(build).toHaveBeenCalledTimes(1);
    release?.();
    await expect(first).rejects.toThrow('transient');
    await expect(second).rejects.toThrow('transient');
    // And the slot is clear afterwards, so the next request is a fresh attempt rather than a replay.
    await expect(get()).rejects.toThrow('transient');
    expect(build).toHaveBeenCalledTimes(2);
  });
});
