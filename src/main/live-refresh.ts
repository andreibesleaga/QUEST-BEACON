// BEACON — PERIODIC LIVE RE-INGEST (V2·A12; Art. XVI; ADR-037 §2 background-work seam).
//
// WHY THIS FILE EXISTS. The live composition was built EXACTLY ONCE per server process:
// `getHttpDepsAsync` memoises `createHttpDepsLive` behind a single promise
// (`src/adapters/channels/http/http-dispatcher.ts` — `cachedAsync`), so `assembleLiveSeeds` ran at the first
// request and never again. Everything downstream inherited that: the COP's incidents, the map geometry and
// every `fetched_at` were a BOOT-TIME SNAPSHOT, re-stamped per BOOT rather than per fetch. A wildfire that
// started after boot could not appear at all until an operator restarted the process — which is not a
// freshness shortfall, it is the wrong picture presented as a current one (Art. XVI).
//
// WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT. It is the RUN of one re-ingest: rebuild the whole picture,
// then publish it in one statement. It is NOT a second scheduling mechanism — the "when" belongs to the
// existing `src/main/scheduler.ts` loop (which already drops a tick that arrives while the previous run of
// the SAME job is in flight, so a ~17 s composition across five regions can never stack up behind itself).
//
// THE FOUR PROPERTIES, each load-bearing and each tested:
//  • NEVER A HALF-BUILT PICTURE. `compose` is SYNCHRONOUS and `commit` is one statement, so between "the new
//    seeds exist" and "the new picture is served" nothing can await, and therefore nothing can interleave. A
//    reader gets the old COMPLETE picture or the new COMPLETE picture — there is no third state to observe.
//  • A FAILED RE-INGEST KEEPS THE LAST GOOD PICTURE. `assemble` resolving `null` (nothing live was
//    assembled) commits NOTHING, so a degraded upstream degrades the FRESHNESS of what is served, never its
//    existence. Blanking the COP because a refresh failed would be strictly worse than not refreshing.
//  • AND IT LABELS NOTHING AS FRESHER THAN IT IS. Because the failed run does not commit, the served picture
//    keeps its own `fetched_at` — the instants the adapters actually stamped. Nothing here re-stamps.
//  • THE THROW ESCAPES ON PURPOSE. An assembly that throws propagates so the scheduler's FR-LD-12 handler
//    records `SCHEDULED_JOB_FAILED` and the loop continues. Swallowing it here would make a permanently
//    broken re-ingest indistinguishable from a working one.
//
// GENERIC OVER THE PICTURE, BY CONSTRUCTION. `src/main` is the composition root; the HTTP channel imports
// it, so this module may not import the HTTP channel back (`no-circular`, .dependency-cruiser.cjs). Typing
// the picture and the seeds as parameters is what keeps that boundary — and it is also why the whole run is
// testable without an adapter, a network or a clock.

/** One re-ingest run, fully injected: nothing here reads config, a clock, or the environment. */
export interface LiveReingestRun<TPicture, TSeeds> {
  /** The picture being served RIGHT NOW. Read per run (never captured), so successive refreshes chain. */
  readonly current: () => Promise<TPicture>;
  /** Assemble a COMPLETE new set of live seeds. `null` ⇒ nothing live this run — keep the last good picture. */
  readonly assemble: () => Promise<TSeeds | null>;
  /** Compose the next picture over the current one. SYNCHRONOUS on purpose — see the atomicity note above. */
  readonly compose: (seeds: TSeeds, previous: TPicture) => TPicture;
  /** Publish the next picture. The ONE statement that makes a refresh visible to readers. */
  readonly commit: (next: TPicture) => void;
  /**
   * Ring the doorbell once the swap has happened (the SSE delta channel). Optional, always AFTER the commit,
   * and its failure is swallowed: a subscriber problem must not turn a successful refresh into a failed job
   * (the same reasoning `publishDelta` already applies to a mutation's delta).
   */
  readonly announce?: (next: TPicture, seeds: TSeeds) => Promise<void>;
}

/**
 * Run one re-ingest. Resolves `true` when the served picture was replaced, `false` when this run produced
 * nothing live and the last good picture was therefore kept. Rejects only when the assembly itself threw.
 */
export async function runLiveReingest<TPicture, TSeeds>(
  run: LiveReingestRun<TPicture, TSeeds>,
): Promise<boolean> {
  const previous = await run.current();
  const seeds = await run.assemble();
  if (seeds === null) return false; // degraded refresh, not an outage — the last good picture keeps serving
  const next = run.compose(seeds, previous);
  run.commit(next); // ── THE SWAP ── one statement, no await above it in this scope
  await announceQuietly(run, next, seeds);
  return true;
}

/** The doorbell, isolated so its failure cannot reach the caller (see `announce` on the contract). */
async function announceQuietly<TPicture, TSeeds>(
  run: LiveReingestRun<TPicture, TSeeds>,
  next: TPicture,
  seeds: TSeeds,
): Promise<void> {
  try {
    await run.announce?.(next, seeds);
  } catch {
    // Deliberately swallowed: the refresh already happened and is already being served.
  }
}
