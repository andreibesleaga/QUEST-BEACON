// BEACON — SSE `/stream` delta channel (E7; ADR-006, SPEC §2.2/§2.5). Framework-agnostic: `handleStream`
// returns an SSEResponse ({status, headers, stream: ReadableStream}) that a Next.js App-Router handler can
// return verbatim (`new Response(res.stream, { status, headers })`). It subscribes to the EventBus on a
// REGION-KEYED topic (cross-region isolation — THREAT T13.1), emits an initial `event: hello`, then one
// `event: delta` SSE frame per published region delta (with a monotonic `id:` for Last-Event-ID backfill),
// plus a periodic heartbeat comment for liveness. The heartbeat interval is INJECTABLE and disabled by
// default (heartbeatMs omitted/0) so tests drive the reader deterministically with no wall-clock dependency.
//
// Next delegator (app/api/v1/stream/route.ts), for the integrator — thin, no logic:
//   export function GET(request: Request) {
//     const regionId = new URL(request.url).searchParams.get('regionId') ?? undefined;
//     const res = handleStream({ query: { regionId } }, streamDeps());
//     return new Response(res.stream, { status: res.status, headers: res.headers });
//   }
//
// ── F-351: WHY THIS ENDPOINT IS DELIBERATELY UNAUTHENTICATED, AND WHAT PAYS FOR THAT ──────────────────────
// The E3 audit recorded "/api/v1/stream has no auth, no RBAC, no rate limit". The first two are the CORRECT
// posture and are kept, deliberately; the third was a real hole and is closed below.
//
// WHY NO AUTH. BEACON's COP is a PUBLIC common operating picture — a citizen with no account is the primary
// audience, and SSE is the top rung of the realtime ladder that keeps that view current (ADR-006; the client
// falls back to polling on error, app/_lib/sse.ts). Putting RBAC on the TRIGGER channel would not protect
// anything: a delta is a change NOTIFICATION, so the client must still fetch the affected entity over REST,
// where the real gate lives and is enforced per role (`rbac.ts` + each route's `isResponder`/`isVerifier`
// check). A responder-only field is invisible to a PUBLIC caller on that REST read whether or not it learned
// that something changed. Gating the trigger would therefore add no confidentiality while breaking the public
// COP's freshness for the exact audience Art. XVI protects ("degrade, don't break… never a dead-end").
// It would be auth theatre in front of an already-locked door.
//
// WHAT THE CHANNEL MAY THEREFORE CARRY — and this is the load-bearing part, enforced below, not asserted:
// a delta is EXACTLY {type, region, entity, at}. No figure (Art. XII), no geometry or precise location
// (Art. XIV), no free text, no alert authority (Art. XIII). `toDelta` PROJECTS every published message onto
// those four string fields and DROPS anything else, so a future publisher that spreads a whole entity onto
// the bus (the F-24/F-192 mapper-spread class) cannot widen a public channel by accident. Without that
// projection, "the channel is safe because deltas are small" is a claim about publisher discipline, not a
// property of the code — and that claim is exactly what the audit was right to distrust.
//
// WHAT WAS ACTUALLY MISSING: A CONNECTION CAP. SSE is the ONE endpoint that bypasses the dispatcher's
// token-bucket entirely — the Next delegator (app/api/v1/stream/route.ts) calls `handleStream` directly,
// never `handleHttp`, so `rateLimiter.take()` is never consulted. And unlike a REST call, each request holds
// a subscription and a stream open indefinitely. An unauthenticated client could therefore open unbounded
// concurrent subscriptions: not a confidentiality bug, an availability one — and availability IS the product
// during an incident. `maxConnections` (per EventBus, i.e. per process) closes it with a LABELLED 503 that
// names the polling rung, not a silent drop.
import type { EventBusPort } from '@/ports/infra.js';
import type { Unsubscribe } from '@/ports/infra.js';

/**
 * The region delta contract carried by `event: delta` `data:` frames. A minimal change notification —
 * the client refetches the affected entity via REST (deltas are triggers, not full payloads). Numbers/
 * geometry never travel here (Art. XII); `at` is the injected-clock ISO timestamp of the change.
 */
export interface StreamDelta {
  readonly type: string; // e.g. 'incident.updated' | 'exposure.recomputed' | 'report.verified'
  readonly region: string; // region id the delta belongs to (matches the subscription topic)
  readonly entity: string; // affected entity id (client refetches it)
  readonly at: string; // ISO-8601 change timestamp (injected clock)
}

/** Transport-neutral inbound request for the stream (Next maps `?regionId=` into `query`). */
export interface StreamRequest {
  readonly query?: Readonly<Record<string, string | undefined>>;
}

/** Everything `handleStream` needs. `heartbeatMs` omitted/0 ⇒ no heartbeat timer (deterministic tests). */
export interface StreamDeps {
  readonly eventBus: EventBusPort;
  readonly clock: () => string;
  readonly heartbeatMs?: number;
  /**
   * Max CONCURRENT open streams per EventBus (F-351). Omitted ⇒ `DEFAULT_MAX_STREAM_CONNECTIONS`. The bus is
   * the process-wide singleton the Next delegator passes, so this is a per-process cap. Injectable rather
   * than read from `process.env` here because this module is transport-neutral and clock-free by contract —
   * an operator-tunable `SSE_MAX_CONNECTIONS` belongs in `config/index.ts` beside `SSE_HEARTBEAT_SEC`.
   */
  readonly maxConnections?: number;
}

/** A streaming HTTP response abstraction (Next returns `new Response(stream, {status, headers})`). */
export interface SSEResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly stream: ReadableStream<Uint8Array>;
}

/** SSE response headers: event-stream, uncached/unbuffered so proxies flush each frame (ADR-006). */
const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no', // disable nginx proxy buffering of the stream
};

/** Region-keyed delta topic. Cross-region isolation: a subscriber only sees its own region's deltas. */
export function streamTopic(regionId: string): string {
  return `region:${regionId}:delta`;
}

/** Resolve the region id from the request (`?regionId=`); falls back to a shared 'default' topic. */
function regionIdOf(req: StreamRequest): string {
  const raw = req.query?.regionId;
  return raw !== undefined && raw !== '' ? raw : 'default';
}

/** Build one SSE frame. `id` (when given) enables Last-Event-ID reconnect backfill (SPEC §2.5). */
function sseFrame(event: string, data: unknown, id?: number): string {
  const idLine = id !== undefined ? `id: ${id}\n` : '';
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * PROJECT an arbitrary published message onto the delta CONTRACT, or reject it (F-351). This is the whole
 * reason an unauthenticated channel is defensible: the four fields below are all that can ever leave here, so
 * no publisher — present or future — can put a figure (Art. XII), a precise coordinate (Art. XIV) or a free
 * text body on a public channel by widening its own event object. It is also the Art. XVI half: a message
 * that does not conform is DROPPED (typed `null`), never thrown on, and never half-serialized.
 */
function toDelta(raw: unknown): StreamDelta | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { type, region, entity, at } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || typeof region !== 'string') return null;
  if (typeof entity !== 'string' || typeof at !== 'string') return null;
  return { type, region, entity, at };
}

/** Default per-process concurrent-stream cap. Generous for a demo/regional deployment, finite by design. */
export const DEFAULT_MAX_STREAM_CONNECTIONS = 100;

/** Retry-After (seconds) advertised when the cap is hit — the client's polling rung covers the gap. */
const OVER_CAPACITY_RETRY_AFTER_SEC = 5;

/**
 * Open streams per EventBus. Keyed on the BUS (the process-wide singleton the Next delegator passes) rather
 * than on the deps object, because that delegator builds a FRESH deps literal per request — a per-deps
 * counter would count to one forever. A WeakMap keeps this out of module-global state, so tests that build
 * their own bus are independently counted and cannot leak a count into each other (no order dependence).
 */
const openStreams = new WeakMap<EventBusPort, number>();

function openCount(bus: EventBusPort): number {
  return openStreams.get(bus) ?? 0;
}

/** A labelled over-capacity response (Art. XVI): a real 503 + Retry-After, and a frame that says what to do. */
function overCapacity(regionId: string, deps: StreamDeps): SSEResponse {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          sseFrame('unavailable', {
            region: regionId,
            at: deps.clock(),
            reason:
              'stream capacity reached on this server — fall back to polling and retry shortly',
            retryAfterSec: OVER_CAPACITY_RETRY_AFTER_SEC,
          }),
        ),
      );
      controller.close();
    },
  });
  return {
    status: 503,
    headers: { ...SSE_HEADERS, 'retry-after': String(OVER_CAPACITY_RETRY_AFTER_SEC) },
    stream,
  };
}

/** Handle a GET /stream request: return an SSE stream of region-keyed deltas + hello + heartbeat. */
export function handleStream(req: StreamRequest, deps: StreamDeps): SSEResponse {
  const { eventBus, clock, heartbeatMs } = deps;
  const regionId = regionIdOf(req);
  const max = deps.maxConnections ?? DEFAULT_MAX_STREAM_CONNECTIONS;
  if (openCount(eventBus) >= max) return overCapacity(regionId, deps);

  const topic = streamTopic(regionId);
  const encoder = new TextEncoder();

  let unsubscribe: Unsubscribe | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let released = false;
  let seq = 0;

  /** Release this connection's slot exactly once (a double cancel must not decrement twice). */
  const release = (): void => {
    if (released) return;
    released = true;
    openStreams.set(eventBus, Math.max(0, openCount(eventBus) - 1));
  };

  openStreams.set(eventBus, openCount(eventBus) + 1);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      /**
       * Art. XVI, at the one place this handler runs INSIDE someone else's call stack.
       * `InMemoryEventBus.publish` invokes subscribers synchronously with NO try/catch, so anything thrown
       * here propagates into whatever request published the delta — an open SSE tab could 500 a POST
       * /reports. `toDelta` already removes the serialization hazards, and this catch covers the rest
       * (an enqueue onto a controller the client has already torn down): the stream degrades to silence
       * for THIS subscriber and the publisher is never affected.
       */
      const safeEnqueue = (frame: string): void => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          release();
          unsubscribe?.();
          if (timer !== undefined) clearInterval(timer);
        }
      };

      safeEnqueue(sseFrame('hello', { region: regionId, at: clock() }));

      const sub = eventBus.subscribe<unknown>(topic, (raw) => {
        const delta = toDelta(raw);
        // A dropped message must NOT burn a sequence id: `id:` is the client's Last-Event-ID reconnect
        // cursor, so an id spent on a frame nobody received would make the client skip a real delta.
        if (delta === null) return;
        seq += 1;
        safeEnqueue(sseFrame('delta', delta, seq));
      });
      if (sub.ok) unsubscribe = sub.value;

      if (heartbeatMs !== undefined && heartbeatMs > 0) {
        timer = setInterval(() => {
          safeEnqueue(`: heartbeat ${clock()}\n\n`);
        }, heartbeatMs);
      }
    },
    cancel() {
      release();
      unsubscribe?.();
      if (timer !== undefined) clearInterval(timer);
    },
  });

  return { status: 200, headers: SSE_HEADERS, stream };
}
