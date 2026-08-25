// BEACON — SSE region-stream client + polling fallback (E8·T-353/T-354; ADR-006/OP2). Opens the
// region-keyed EventSource, parses `event: delta` frames into a RegionDelta, and hands each to onDelta
// (which the hook uses to invalidate the precise TanStack queries — the client then REFETCHES grounded
// data via REST; no numbers cross the stream, Art. XII). If the stream errors/drops, it AUTO-FALLS-BACK
// to polling on the SAME delta contract (a synthetic 'poll' delta on each tick). The EventSource, the
// timer, and the clock are all injectable so tests are fully deterministic (no real network/timers).
import { useEffect, useState } from 'react';
import { useUiStore } from './store.js';
import type { ActorRole, RegionDelta } from './types.js';

/**
 * Which rung of the realtime ladder is currently carrying deltas (Art. XVI — the degradation is a LABEL,
 * never a silent dead-end). `idle` = no region selected, so nothing is subscribed; `sse` = the push channel
 * is open; `polling` = the push channel dropped and the SAME delta contract is now driven by a timer.
 * Consumers surface this so nothing ever claims a live push channel it does not have.
 */
export type StreamTransport = 'idle' | 'sse' | 'polling';

/** The slice of EventSource we depend on — lets tests inject a fake without a DOM. */
export interface MessageEventLike {
  readonly data: string;
}
export interface EventSourceLike {
  addEventListener(type: string, listener: (ev: MessageEventLike) => void): void;
  close(): void;
  onerror: ((ev: unknown) => void) | null;
}
export type EventSourceCtor = new (url: string) => EventSourceLike;

/** Injectable timer surface (default wraps global setInterval/clearInterval). */
export interface TimerApi {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface RegionStreamOptions {
  readonly onDelta: (delta: RegionDelta) => void;
  readonly onError?: (err: unknown) => void;
  /** Called with the active ladder rung whenever it changes ('sse' on open, 'polling' after a drop). */
  readonly onTransport?: (transport: StreamTransport) => void;
  readonly EventSourceImpl?: EventSourceCtor;
  readonly pollIntervalMs?: number;
  readonly timer?: TimerApi;
  readonly now?: () => string;
  /** Acting role carried to the stream (EventSource can't set headers, so it rides the query string). */
  readonly role?: ActorRole;
}

const DEFAULT_POLL_MS = 15_000;

const defaultTimer: TimerApi = {
  set: (fn, ms) => setInterval(fn, ms) as unknown as number,
  clear: (id) => clearInterval(id as unknown as ReturnType<typeof setInterval>),
};

function defaultEventSource(): EventSourceCtor {
  const g = globalThis as { EventSource?: EventSourceCtor };
  if (g.EventSource === undefined) {
    throw new Error('EventSource is unavailable in this runtime; inject EventSourceImpl.');
  }
  return g.EventSource;
}

/**
 * The region-keyed SSE URL (SPEC §2.5 — cross-region isolation via ?regionId=). The acting `role` is
 * appended when present because EventSource cannot set request headers — the dev server may honour it under
 * AUTH_DEV_TRUST_HEADER. Deltas carry NO grounded data (Art. XII), so the stream is not RBAC-sensitive; the
 * client always REFETCHES grounded data over REST, which DOES carry the role header.
 */
export function streamUrl(regionId: string, role?: ActorRole): string {
  const base = `/api/v1/stream?regionId=${encodeURIComponent(regionId)}`;
  return role !== undefined ? `${base}&role=${encodeURIComponent(role)}` : base;
}

function parseDelta(ev: MessageEventLike, onDelta: (d: RegionDelta) => void, onError?: (e: unknown) => void): void {
  try {
    onDelta(JSON.parse(ev.data) as RegionDelta);
  } catch (err) {
    onError?.(err);
  }
}

/**
 * Subscribe to a region's delta stream. Returns a teardown that closes the EventSource and stops any
 * polling. On an EventSource error it closes the socket and begins polling — each tick emits a synthetic
 * 'poll' delta so the consumer refetches on the identical contract (OP2).
 */
export function subscribeRegionStream(regionId: string, opts: RegionStreamOptions): () => void {
  const {
    onDelta,
    onError,
    onTransport,
    EventSourceImpl,
    pollIntervalMs = DEFAULT_POLL_MS,
    timer = defaultTimer,
    now = () => new Date().toISOString(),
  } = opts;

  const Ctor = EventSourceImpl ?? defaultEventSource();
  const es = new Ctor(streamUrl(regionId, opts.role));
  let pollId: number | undefined;
  let stopped = false;
  onTransport?.('sse');

  const startPolling = (): void => {
    if (stopped || pollId !== undefined) return;
    pollId = timer.set(() => {
      onDelta({ type: 'poll', region: regionId, entity: '*', at: now() });
    }, pollIntervalMs);
    onTransport?.('polling');
  };

  es.addEventListener('delta', (ev) => parseDelta(ev, onDelta, onError));
  es.onerror = (err) => {
    onError?.(err);
    es.close();
    startPolling();
  };

  return () => {
    stopped = true;
    es.close();
    if (pollId !== undefined) {
      timer.clear(pollId);
      pollId = undefined;
    }
  };
}

/**
 * React hook: open the region stream for the active region and invoke onDelta on every delta (and on
 * each polling tick after a drop). Re-subscribes when regionId or onDelta changes; tears down on unmount.
 * Memoize onDelta at the call site to avoid needless re-subscription.
 *
 * Returns the CURRENT ladder rung so the mounting component can label the degradation (Art. XVI): the
 * fallback is automatic and never a dead-end, but it is also never presented as the push channel.
 */
export function useRegionStream(
  regionId: string | undefined,
  onDelta: (delta: RegionDelta) => void,
): StreamTransport {
  const role = useUiStore((s) => s.actorRole);
  const [transport, setTransport] = useState<StreamTransport>('idle');
  useEffect(() => {
    if (regionId === undefined || regionId === '') {
      setTransport('idle');
      return;
    }
    // A resubscription (region/role change) starts on the push rung again; a drop moves it to 'polling'.
    return subscribeRegionStream(regionId, { onDelta, role, onTransport: setTransport });
  }, [regionId, onDelta, role]);
  return transport;
}
