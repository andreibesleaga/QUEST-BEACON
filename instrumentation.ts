// BEACON — warm the composition root at boot (added after the 2026-09-11 cold-start outage).
//
// THE DEFECT. The API route awaits `getHttpDepsAsync()` — the whole live composition, five regions of
// adapters — before dispatching ANY path. Nothing ran it until the first request arrived, so the first
// request after every container start paid the full cost. On Railway that cost exceeded the edge proxy's
// 60-second limit, the connection was cut, and the operator saw a login that hung and then failed. It
// happened on every deploy, every restart and every scale event, and it looked like a broken login.
//
// THE FIX. Kick the composition off the moment the server process starts, so it is warm — or already in
// flight — before the first request. It is deliberately NOT awaited: awaiting would hold the server closed
// for the whole warm-up, turning a slow first request into a window of 502s and failing any deploy
// health check that lands inside it. Fire-and-forget lets static pages and the health literal serve at
// once, while early API requests join the in-flight build through `memoizeSuccess` rather than starting
// a second one. A failed warm-up is logged and clears the memo slot, so the first request simply retries —
// the same recovery the memo already guarantees.
//
// `register` runs once per server start under `next start`; the runtime guard keeps the Node-only
// composition (fs, pg) out of the edge bundle, where it cannot run and would fail the build.
/**
 * How long to wait after the process starts before beginning the warm-up. The first version started it
 * at the instant `register` ran, and the very next deploy sat with the composition in flight for minutes
 * while every request joined it and was cut at the edge — where the previous deploy, warmed by a user
 * request that arrived after the container's network was up, finished in about thirty seconds. Starting
 * a five-region fan-out of live fetches before DNS and outbound routing settle is a way to spend every
 * adapter's full timeout budget on the first try. A few seconds costs nothing; zero cost a deploy.
 * Overridable so tests run it immediately and an operator can tune it without a rebuild.
 */
const DEFAULT_WARMUP_DELAY_MS = 10_000;

function warmupDelayMsFromEnv(): number {
  const delayMs = Number(process.env['BEACON_WARMUP_DELAY_MS'] ?? DEFAULT_WARMUP_DELAY_MS);
  return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : DEFAULT_WARMUP_DELAY_MS;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getHttpDepsAsync, getHttpDepsAsyncTiming } =
    await import('@/adapters/channels/http/http-dispatcher.js');
  const warmupDelayMs = warmupDelayMsFromEnv();
  // Logged so the runtime log itself proves the hook fired — a unit test can show `register` works
  // when called; only this line shows that Next called it. The completion line below, with its elapsed
  // time, is what makes a slow or stuck build VISIBLE: the first version logged only start and failure,
  // so a composition that never finished looked identical to one that had.
  console.info('[beacon] boot warm-up scheduled', { delayMs: warmupDelayMs });
  setTimeout(() => {
    console.info('[beacon] boot warm-up started');
    const warmup = getHttpDepsAsync();
    const elapsedMs = () => {
      const { startedAtMs = Date.now(), settledAtMs } = getHttpDepsAsyncTiming(warmup);
      return (settledAtMs ?? Date.now()) - startedAtMs;
    };
    warmup
      .then(() => console.info('[beacon] boot warm-up complete', { elapsedMs: elapsedMs() }))
      .catch((e: unknown) => {
        console.error('[beacon] boot warm-up failed; the first request will retry', {
          elapsedMs: elapsedMs(),
          error: e instanceof Error ? e.message : String(e),
        });
      });
  }, warmupDelayMs);
}
