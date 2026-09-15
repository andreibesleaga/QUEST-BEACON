// BEACON — SSE client + polling fallback (E8·T-353/T-354). Fake EventSource + injected timer + fixed
// clock ⇒ fully deterministic (no real network/timers). Asserts: a delta frame calls onDelta; an
// EventSource error closes the socket and switches to polling; advancing the injected timer fires the
// refetch (a synthetic 'poll' delta on the same contract); teardown clears everything.
import { describe, it, expect, vi } from 'vitest';
import { subscribeRegionStream } from './sse.js';
import type { EventSourceCtor, EventSourceLike, MessageEventLike, TimerApi } from './sse.js';

class FakeEventSource implements EventSourceLike {
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  readonly url: string;
  private readonly listeners = new Map<string, (ev: MessageEventLike) => void>();
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, listener: (ev: MessageEventLike) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    this.listeners.get(type)?.({ data });
  }
}

function makeFakeES(): { Ctor: EventSourceCtor; get: () => FakeEventSource } {
  const instances: FakeEventSource[] = [];
  const Ctor = class extends FakeEventSource {
    constructor(url: string) {
      super(url);
      instances.push(this);
    }
  } as unknown as EventSourceCtor;
  return {
    Ctor,
    get: () => {
      const inst = instances.at(-1);
      if (inst === undefined) throw new Error('EventSource not constructed');
      return inst;
    },
  };
}

function fakeTimer(): { timer: TimerApi; tickAll: () => void; size: () => number } {
  let seq = 1;
  const fns = new Map<number, () => void>();
  const timer: TimerApi = {
    set: (fn) => {
      const id = seq++;
      fns.set(id, fn);
      return id;
    },
    clear: (id) => {
      fns.delete(id);
    },
  };
  return { timer, tickAll: () => fns.forEach((f) => f()), size: () => fns.size };
}

describe('subscribeRegionStream', () => {
  it('opens a region-keyed stream and calls onDelta on a delta frame', () => {
    const onDelta = vi.fn();
    const { Ctor, get } = makeFakeES();
    const { timer } = fakeTimer();
    const stop = subscribeRegionStream('socal', {
      onDelta,
      EventSourceImpl: Ctor,
      timer,
      now: () => 'FIXED',
    });
    expect(get().url).toBe('/api/v1/stream?regionId=socal');

    const delta = {
      type: 'incident',
      region: 'socal',
      entity: 'inc-1',
      at: '2026-07-07T00:00:00Z',
    };
    get().emit('delta', JSON.stringify(delta));
    expect(onDelta).toHaveBeenCalledWith(delta);

    stop();
    expect(get().closed).toBe(true);
  });

  it('falls back to polling on EventSource error; the injected timer fires the refetch', () => {
    const onDelta = vi.fn();
    const onError = vi.fn();
    const { Ctor, get } = makeFakeES();
    const ft = fakeTimer();
    const stop = subscribeRegionStream('socal', {
      onDelta,
      onError,
      EventSourceImpl: Ctor,
      timer: ft.timer,
      pollIntervalMs: 1000,
      now: () => 'FIXED',
    });

    expect(ft.size()).toBe(0); // no polling while the stream is healthy
    get().onerror?.({ kind: 'drop' });
    expect(onError).toHaveBeenCalled();
    expect(get().closed).toBe(true); // socket closed on drop
    expect(ft.size()).toBe(1); // polling started

    // A repeated error must not start a second interval.
    get().onerror?.({ kind: 'drop' });
    expect(ft.size()).toBe(1);

    ft.tickAll(); // advance the injected timer → refetch trigger on the same contract
    expect(onDelta).toHaveBeenCalledWith({
      type: 'poll',
      region: 'socal',
      entity: '*',
      at: 'FIXED',
    });

    stop();
    expect(ft.size()).toBe(0); // interval cleared on teardown
  });

  it('announces which ladder rung is carrying deltas (Art. XVI — the degradation is labelled)', () => {
    const seen: string[] = [];
    const { Ctor, get } = makeFakeES();
    const ft = fakeTimer();
    const stop = subscribeRegionStream('socal', {
      onDelta: vi.fn(),
      onTransport: (t) => seen.push(t),
      EventSourceImpl: Ctor,
      timer: ft.timer,
      now: () => 'FIXED',
    });

    expect(seen).toEqual(['sse']); // the push rung is announced as soon as the socket is opened
    get().onerror?.({ kind: 'drop' });
    expect(seen).toEqual(['sse', 'polling']); // …and the drop is announced, never silently absorbed
    get().onerror?.({ kind: 'drop' });
    expect(seen).toEqual(['sse', 'polling']); // a repeated drop is not re-announced (one interval, one label)

    stop();
  });

  it('routes a malformed delta frame to onError without throwing', () => {
    const onDelta = vi.fn();
    const onError = vi.fn();
    const { Ctor, get } = makeFakeES();
    const { timer } = fakeTimer();
    subscribeRegionStream('socal', {
      onDelta,
      onError,
      EventSourceImpl: Ctor,
      timer,
      now: () => 'X',
    });
    get().emit('delta', '{not json');
    expect(onDelta).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });
});
