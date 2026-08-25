// BEACON — Next.js App-Router delegator for the SSE `/api/v1/stream` delta channel (E7; ADR-006, SPEC §2.5).
// SSE cannot travel through the JSON dispatcher (handleHttp returns a serialized body): it needs the raw
// ReadableStream. So this route calls handleStream directly with the process-wide EventBus (getHttpDeps().
// features) and returns `new Response(stream, {status, headers})` verbatim. This static `stream` segment takes
// precedence over the `[...path]` catch-all delegator, so REST routes still flow through handleHttp.
// TRIVIAL by design — all stream logic lives in the tested handleStream.
import { getHttpDepsAsync } from '@/adapters/channels/http/http-dispatcher.js';
import { handleStream } from '@/adapters/channels/http/routes/stream.js';

/** SSE heartbeat interval (ms) from SSE_HEARTBEAT_SEC (default 15s); 0/invalid ⇒ disabled. */
function heartbeatMsFromEnv(): number | undefined {
  const sec = Number(process.env.SSE_HEARTBEAT_SEC ?? '15');
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : undefined;
}

/**
 * Max concurrent open SSE streams per process, from `SSE_MAX_CONNECTIONS`. Unset/invalid ⇒ undefined, and
 * `handleStream` applies its own `DEFAULT_MAX_STREAM_CONNECTIONS` — so the cap is never absent, only tuned.
 *
 * F-351 follow-up: the cap existed but nothing read an env var for it, so an operator had no way to raise
 * or lower it — a knob that is not wired is not a knob. Read HERE rather than in `config/index.ts` for the
 * same reason `heartbeatMsFromEnv` is: this route is the one place that composes the stream's transport
 * options, `stream.ts` is transport-neutral and env-free by contract, and adding a second config pathway for
 * one sibling value would be the inconsistency, not the fix. Documented in `.env.example`.
 */
function maxConnectionsFromEnv(): number | undefined {
  const raw = process.env.SSE_MAX_CONNECTIONS;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  // A non-positive or malformed value falls back to the default rather than disabling the cap: an
  // availability guard must never be switchable off by a typo (fail-closed, Art. XVI).
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// Async so it shares the ONE process-wide deps instance (same EventBus) with the REST delegator — events
// published on a POST/PATCH reach open SSE streams. Using the sync getHttpDeps() here would fork the bus.
export async function GET(request: Request): Promise<Response> {
  const regionId = new URL(request.url).searchParams.get('regionId') ?? undefined;
  const { eventBus, clock } = (await getHttpDepsAsync()).features;
  const heartbeatMs = heartbeatMsFromEnv();
  const maxConnections = maxConnectionsFromEnv();
  const res = handleStream(
    { query: { regionId } },
    {
      eventBus,
      clock,
      ...(heartbeatMs !== undefined ? { heartbeatMs } : {}),
      ...(maxConnections !== undefined ? { maxConnections } : {}),
    },
  );
  return new Response(res.stream, { status: res.status, headers: res.headers });
}
