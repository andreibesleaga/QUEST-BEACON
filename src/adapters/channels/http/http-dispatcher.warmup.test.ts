// BEACON — what a READ does while the live composition is still building.
//
// Measured on the live deployment 2026-09-12: the composition takes 247 s on a cold container, and
// Railway cuts a request at 60 s. Every delegator awaited that composition, so a visitor arriving in the
// first minutes after the demo was switched on got a hang and then a 502 — the worst possible moment,
// because switching the demo on is exactly what happens immediately before someone is shown it.
//
// The rule these tests pin is the asymmetry: a READ may be answered from the offline seed while the live
// build continues; a WRITE may not, because a report filed into the memory store would be discarded the
// moment the live composition took over.
import { describe, expect, it } from 'vitest';
import { depsWithin } from './http-dispatcher.js';
import type { HttpDeps } from './http-types.js';

const LIVE = { marker: 'live' } as unknown as HttpDeps;
const SEED = { marker: 'seed' } as unknown as HttpDeps;
const marker = (d: HttpDeps): string => (d as unknown as { marker: string }).marker;

/** A wait that resolves when the test says so, so nothing here depends on a real clock. */
function controllable(): { wait: (ms: number) => Promise<void>; fire: () => void } {
  let fire = (): void => {};
  const wait = (): Promise<void> =>
    new Promise<void>((resolve) => {
      fire = resolve;
    });
  return { wait, fire: () => fire() };
}

describe('depsWithin', () => {
  it('uses the live composition when it settles inside the deadline', async () => {
    const { wait } = controllable(); // never fires — the live promise wins
    const deps = await depsWithin(Promise.resolve(LIVE), () => SEED, 5_000, wait);
    expect(marker(deps)).toBe('live');
  });

  it('serves the offline seed when the deadline passes first, and does NOT cancel the build', async () => {
    const { wait, fire } = controllable();
    let settleLive = (): void => {};
    const live = new Promise<HttpDeps>((resolve) => {
      settleLive = () => resolve(LIVE);
    });
    const answer = depsWithin(live, () => SEED, 5_000, wait);
    fire(); // the deadline passes before the composition finishes
    expect(marker(await answer)).toBe('seed');
    // The build carries on in its own promise — every later request gets the live deps.
    settleLive();
    expect(marker(await live)).toBe('live');
  });

  it('falls back to the seed when the live build REJECTS, rather than failing the read', async () => {
    // A composition that throws is exactly when a seeded answer matters most: the operator gets a
    // labelled picture instead of a 500, and the health endpoint (which never touches the composition)
    // still reports the failure.
    const { wait } = controllable();
    const live = Promise.reject(new Error('DATABASE_URL is not set'));
    const deps = await depsWithin(live, () => SEED, 5_000, wait);
    expect(marker(deps)).toBe('seed');
    await expect(live).rejects.toThrow('DATABASE_URL'); // the rejection is still observable, not swallowed
  });
});
