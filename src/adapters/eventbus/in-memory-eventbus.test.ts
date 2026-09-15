// BEACON — in-memory EventBus tests (E7; ADR-006). Deterministic synchronous pub/sub, no timers/network.
import { describe, it, expect } from 'vitest';
import { createInMemoryEventBus } from './in-memory-eventbus.js';

describe('InMemoryEventBus', () => {
  it('delivers a published event to a topic subscriber', async () => {
    const bus = createInMemoryEventBus();
    const seen: string[] = [];
    const sub = bus.subscribe<string>('t', (e) => seen.push(e));
    expect(sub.ok).toBe(true);
    await bus.publish('t', 'hello');
    expect(seen).toEqual(['hello']);
  });

  it('isolates topics — a subscriber never sees another topic', async () => {
    const bus = createInMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe<string>('a', (e) => seen.push(e));
    await bus.publish('b', 'nope');
    expect(seen).toEqual([]);
  });

  it('stops delivery after unsubscribe', async () => {
    const bus = createInMemoryEventBus();
    const seen: string[] = [];
    const sub = bus.subscribe<string>('t', (e) => seen.push(e));
    if (sub.ok) sub.value();
    await bus.publish('t', 'gone');
    expect(seen).toEqual([]);
  });

  it('fans out to multiple subscribers in subscription order', async () => {
    const bus = createInMemoryEventBus();
    const order: number[] = [];
    bus.subscribe<number>('t', () => order.push(1));
    bus.subscribe<number>('t', () => order.push(2));
    await bus.publish('t', 0);
    expect(order).toEqual([1, 2]);
  });
});
