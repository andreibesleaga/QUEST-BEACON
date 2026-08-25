// BEACON — SSE `/stream` tests (E7; ADR-006, SPEC §2.5). Deterministic: the ReadableStream reader is
// driven step-by-step, heartbeat disabled (heartbeatMs omitted) → no wall-clock/timer dependency.
import { describe, it, expect } from 'vitest';
import { createInMemoryEventBus } from '@/adapters/eventbus/index.js';
import { handleStream, streamTopic, type StreamDelta, type StreamDeps } from './stream.js';

const FIXED = '2026-07-07T12:00:00.000Z';
const decoder = new TextDecoder();

function depsFor(eventBus = createInMemoryEventBus()): { bus: typeof eventBus; deps: StreamDeps } {
  return { bus: eventBus, deps: { eventBus, clock: () => FIXED } }; // heartbeatMs omitted → disabled
}

describe('handleStream — SSE delta channel', () => {
  it('returns a 200 text/event-stream response', () => {
    const { deps } = depsFor();
    const res = handleStream({ query: { regionId: 'ro-cluj' } }, deps);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toContain('no-cache');
  });

  it('emits an initial hello frame, then a delta frame when one is published to the region topic', async () => {
    const { bus, deps } = depsFor();
    const res = handleStream({ query: { regionId: 'ro-cluj' } }, deps);
    const reader = res.stream.getReader();

    const hello = decoder.decode((await reader.read()).value);
    expect(hello).toContain('event: hello');
    expect(hello).toContain('"region":"ro-cluj"');

    const delta: StreamDelta = {
      type: 'incident.updated',
      region: 'ro-cluj',
      entity: 'incident-42',
      at: FIXED,
    };
    await bus.publish(streamTopic('ro-cluj'), delta);

    const chunk = decoder.decode((await reader.read()).value);
    expect(chunk).toContain('event: delta');
    expect(chunk).toContain('id: 1');
    expect(chunk).toContain('data:');
    expect(chunk).toContain('"entity":"incident-42"');

    await reader.cancel();
  });

  it('is region-isolated: a delta on another region is not delivered', async () => {
    const { bus, deps } = depsFor();
    const res = handleStream({ query: { regionId: 'ro-cluj' } }, deps);
    const reader = res.stream.getReader();
    await reader.read(); // consume hello

    // Publish to a DIFFERENT region, then to ours — the reader must receive only ours.
    await bus.publish(streamTopic('us-ca'), {
      type: 'incident.updated', region: 'us-ca', entity: 'other', at: FIXED,
    });
    await bus.publish(streamTopic('ro-cluj'), {
      type: 'incident.updated', region: 'ro-cluj', entity: 'mine', at: FIXED,
    });

    const chunk = decoder.decode((await reader.read()).value);
    expect(chunk).toContain('"entity":"mine"');
    expect(chunk).not.toContain('other');

    await reader.cancel();
  });

  // ===========================================================================================================
  // F-351 — the channel is DELIBERATELY UNAUTHENTICATED (a public COP's realtime rung). The posture is argued
  // in stream.ts's header; these tests hold the two properties that posture DEPENDS ON.
  // ===========================================================================================================

  it('F-351: the frame carries ONLY the four contract fields — a publisher cannot widen the public channel', async () => {
    const { bus, deps } = depsFor();
    const res = handleStream({ query: { regionId: 'ro-cluj' } }, deps);
    const reader = res.stream.getReader();
    await reader.read(); // hello

    // A future publisher spreads a whole entity onto the bus (the F-24/F-192 mapper-spread class). On an
    // UNAUTHENTICATED channel that is an Art. XII (a figure) AND Art. XIV (precise location, a device handle)
    // leak in one line. The handler must project, not serialize what it was handed.
    await bus.publish(streamTopic('ro-cluj'), {
      type: 'report.verified',
      region: 'ro-cluj',
      entity: 'rep-7',
      at: FIXED,
      casualtyCount: 12,
      geomPrecise: { type: 'Point', coordinates: [-121.6, 39.7] },
      reporterPhone: '+15550100',
      chatId: '1234567',
    });

    const chunk = decoder.decode((await reader.read()).value);
    expect(chunk).toContain('"entity":"rep-7"');
    expect(chunk).not.toContain('casualtyCount');
    expect(chunk).not.toContain('geomPrecise');
    expect(chunk).not.toContain('reporterPhone');
    expect(chunk).not.toContain('1234567');
    // Exact shape: the four contract fields and nothing else.
    const data = JSON.parse(/data: (.*)\n/.exec(chunk)?.[1] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['at', 'entity', 'region', 'type']);

    await reader.cancel();
  });

  it('F-351: a malformed delta is DROPPED, and does not consume a Last-Event-ID sequence number', async () => {
    const { bus, deps } = depsFor();
    const res = handleStream({ query: { regionId: 'ro-cluj' } }, deps);
    const reader = res.stream.getReader();
    await reader.read(); // hello

    await bus.publish(streamTopic('ro-cluj'), 'not-a-delta');
    await bus.publish(streamTopic('ro-cluj'), { type: 'incident.updated', region: 'ro-cluj' }); // no entity/at
    await bus.publish(streamTopic('ro-cluj'), { type: 'incident.updated', region: 'ro-cluj', entity: 'inc-1', at: FIXED });

    const chunk = decoder.decode((await reader.read()).value);
    expect(chunk).toContain('"entity":"inc-1"');
    // `id:` is the client's reconnect cursor. If a dropped frame burned an id, a reconnecting client would
    // silently skip a REAL delta it never received (SPEC §2.5 Last-Event-ID backfill).
    expect(chunk).toContain('id: 1');

    await reader.cancel();
  });

  it('F-351/Art. XVI: a delta the handler cannot serialize NEVER breaks the PUBLISHER', async () => {
    const { bus, deps } = depsFor();
    const res = handleStream({ query: { regionId: 'ro-cluj' } }, deps);
    const reader = res.stream.getReader();
    await reader.read(); // hello

    // `InMemoryEventBus.publish` invokes subscribers SYNCHRONOUSLY with no try/catch, so a throw inside this
    // handler's callback propagates out of `publish` and into whatever request published the delta — a POST
    // /reports would 500 because someone had an SSE tab open. A BigInt id (a plausible DB-derived value) is
    // enough: JSON.stringify throws on it.
    const published = await bus.publish(streamTopic('ro-cluj'), {
      type: 'incident.updated', region: 'ro-cluj', entity: 10n, at: FIXED,
    });
    expect(published.ok).toBe(true);

    // …and the subscription survives: the next valid delta still arrives.
    await bus.publish(streamTopic('ro-cluj'), {
      type: 'incident.updated', region: 'ro-cluj', entity: 'inc-2', at: FIXED,
    });
    const chunk = decoder.decode((await reader.read()).value);
    expect(chunk).toContain('"entity":"inc-2"');

    await reader.cancel();
  });

  it('F-351: concurrent streams per EventBus are CAPPED — the one control an open channel actually needs', async () => {
    const { bus, deps } = depsFor();
    const capped: StreamDeps = { ...deps, maxConnections: 2 };

    const first = handleStream({ query: { regionId: 'ro-cluj' } }, capped);
    const second = handleStream({ query: { regionId: 'us-ca' } }, capped);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const third = handleStream({ query: { regionId: 'ro-cluj' } }, capped);
    expect(third.status).toBe(503);
    expect(third.headers['retry-after']).toBe('5');
    // Art. XVI — a LABELLED degradation, never a dead-end: the frame names the fallback rung the client
    // already implements (app/_lib/sse.ts falls back to polling on stream error).
    const notice = decoder.decode((await third.stream.getReader().read()).value);
    expect(notice).toContain('event: unavailable');
    expect(notice).toContain('polling');

    // Releasing a slot re-admits a client — the cap is a live gauge, not a one-way latch.
    await first.stream.cancel();
    const fourth = handleStream({ query: { regionId: 'ro-cluj' } }, capped);
    expect(fourth.status).toBe(200);

    await second.stream.cancel();
    await fourth.stream.cancel();
    // The cap is keyed on the EventBus (the process-wide singleton the Next delegator passes), so a
    // different bus is independently counted — one region's traffic can never lock out another process.
    expect(handleStream({ query: { regionId: 'ro-cluj' } }, { ...depsFor().deps, maxConnections: 1 }).status).toBe(200);
    expect(bus).toBeDefined();
  });

  it('unsubscribes from the bus when the stream is cancelled', async () => {
    const { bus, deps } = depsFor();
    const res = handleStream({ query: { regionId: 'ro-cluj' } }, deps);
    const reader = res.stream.getReader();
    await reader.read(); // hello
    await reader.cancel(); // triggers stream cancel → unsubscribe

    // No subscribers remain → publishing is a no-op that resolves cleanly.
    const published = await bus.publish(streamTopic('ro-cluj'), {
      type: 'incident.updated', region: 'ro-cluj', entity: 'x', at: FIXED,
    });
    expect(published.ok).toBe(true);
  });
});
