// BEACON test harness — in-memory EventBusPort + QueuePort (TEST_PLAN §4 / F11 sse↔polling,
// cron↔bullmq parity fixtures). Synchronous, deterministic: publish invokes subscribers inline, enqueue
// runs the registered processor inline. Records published/enqueued items so tests can assert delta flow.
import type { EventBusPort, QueuePort, Unsubscribe } from '@/ports/infra.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { ok } from '@/domain/shared/result.js';

type Handler = (event: unknown) => void;

export class FakeEventBus implements EventBusPort {
  private readonly handlers = new Map<string, Set<Handler>>();
  public readonly published: Array<{ topic: string; event: unknown }> = [];

  publish<E>(topic: string, event: E): Promise<Result<void, DomainError>> {
    this.published.push({ topic, event });
    for (const h of this.handlers.get(topic) ?? []) h(event);
    return Promise.resolve(ok(undefined));
  }

  subscribe<E>(topic: string, handler: (event: E) => void): Result<Unsubscribe, DomainError> {
    const set = this.handlers.get(topic) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(topic, set);
    return ok(() => set.delete(handler as Handler));
  }
}

export class FakeQueue implements QueuePort {
  private readonly processors = new Map<string, (job: unknown) => Promise<void>>();
  public readonly enqueued: Array<{ queue: string; job: unknown }> = [];
  private seq = 0;

  async enqueue<J>(queue: string, job: J): Promise<Result<string, DomainError>> {
    this.enqueued.push({ queue, job });
    const processor = this.processors.get(queue);
    if (processor !== undefined) await processor(job);
    return ok(`job-${this.seq++}`);
  }

  process<J>(queue: string, handler: (job: J) => Promise<void>): Result<Unsubscribe, DomainError> {
    this.processors.set(queue, handler as (job: unknown) => Promise<void>);
    return ok(() => this.processors.delete(queue));
  }
}
