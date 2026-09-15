// BEACON — in-memory EventBus adapter (E7; ADR-006/ADR-009; FEATURE_EVENTBUS default rung). Implements
// EventBusPort as a synchronous in-process pub/sub over topic → handler-set. It is the default realtime
// fan-out backing the SSE `/stream` delta channel (the Redis-Streams adapter is the scale-up flag rung).
// Publish is deterministic (handlers invoked synchronously in subscription order) so tests need no timers.
import type { EventBusPort, Unsubscribe } from '@/ports/infra.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { ok } from '@/domain/shared/result.js';

/** Process-local pub/sub. One instance per process (compose it in the composition root / SSE deps). */
export class InMemoryEventBus implements EventBusPort {
  readonly #topics = new Map<string, Set<(event: unknown) => void>>();

  /** Deliver `event` to every current subscriber of `topic`, synchronously, in subscription order. */
  publish<E>(topic: string, event: E): Promise<Result<void, DomainError>> {
    const subs = this.#topics.get(topic);
    if (subs !== undefined) {
      // Snapshot so a handler that (un)subscribes during dispatch cannot mutate the live set mid-iteration.
      for (const handler of [...subs]) handler(event);
    }
    return Promise.resolve(ok(undefined));
  }

  /** Register `handler` for `topic`; the returned Unsubscribe removes exactly this registration. */
  subscribe<E>(topic: string, handler: (event: E) => void): Result<Unsubscribe, DomainError> {
    const set = this.#topics.get(topic) ?? new Set<(event: unknown) => void>();
    if (!this.#topics.has(topic)) this.#topics.set(topic, set);
    const boxed = handler as (event: unknown) => void;
    set.add(boxed);
    const unsubscribe: Unsubscribe = () => {
      set.delete(boxed);
      if (set.size === 0) this.#topics.delete(topic);
    };
    return ok(unsubscribe);
  }
}

/** Factory (used by the composition root / SSE deps). */
export function createInMemoryEventBus(): InMemoryEventBus {
  return new InMemoryEventBus();
}
