// BEACON — Managed circuit breaker + retry/timeout (E4·T-132/T-133; adapter-contract §3.1.2, ADR-009/F5).
// Wraps cockatiel: CLOSED → (N consecutive failures) → OPEN → (cooldown) → HALF_OPEN → (trial) → CLOSED.
// One instance PER adapter id (breaker state must be shared across calls). Tracks last success/error for
// the "stale" UI badge (health()). Execution order per call: breaker › retry › timeout › live fn.
import {
  circuitBreaker,
  retry,
  timeout,
  wrap,
  handleAll,
  ConsecutiveBreaker,
  ExponentialBackoff,
  TimeoutStrategy,
  CircuitState,
  isBrokenCircuitError,
} from 'cockatiel';
import type { CircuitBreakerPolicy, IPolicy } from 'cockatiel';
import type { AdapterHealth, HealthState } from './contract.js';
import type { AdapterError } from './errors.js';
import { isAdapterError, makeAdapterError, errorMessage } from './errors.js';

export interface BreakerConfig {
  readonly failureThreshold: number; // consecutive failures before OPEN
  readonly cooldownSec: number; // OPEN duration before HALF_OPEN
  readonly halfOpenTrials?: number; // trial calls in HALF_OPEN (informational)
  readonly timeoutMs?: number; // per-attempt timeout (default: the hang backstop below)
  readonly maxRetries?: number; // bounded retries on retryable failure (default 2)
}

// TWO timeouts guard every live attempt, and they have DIFFERENT jobs (bug found live 2026-08-04):
//   • the HTTP timeout (resilient-http, default 8s, per-source via SOURCE_<PREFIX>_TIMEOUT_MS) is the
//     EFFECTIVE per-attempt budget — the one operators configure;
//   • THIS breaker-level timeout is only a LAST-RESORT hang backstop for a fetcher whose own timeout
//     failed to fire. It used to default to the SAME 8s, which silently CAPPED every configured
//     SOURCE_*_TIMEOUT_MS above 8s — WorldPop's documented 30s budget died at 8s with a misleading
//     "Operation timed out after 8000ms", and the flag looked read-but-broken. A backstop must sit
//     ABOVE every legitimate budget, not tie it.
export const DEFAULT_BACKSTOP_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;

export class ManagedBreaker {
  private readonly cb: CircuitBreakerPolicy;
  private readonly retryTimeout: IPolicy;
  private readonly nowIso: () => string;
  private consecutiveFailures = 0;
  private lastSuccessAt: string | undefined;
  private lastError: AdapterError | undefined;

  constructor(cfg: BreakerConfig, nowIso: () => string = () => new Date().toISOString()) {
    this.nowIso = nowIso;
    this.cb = circuitBreaker(handleAll, {
      halfOpenAfter: Math.max(1, cfg.cooldownSec * 1000),
      breaker: new ConsecutiveBreaker(cfg.failureThreshold),
    });
    const retryPolicy = retry(handleAll, {
      maxAttempts: cfg.maxRetries ?? DEFAULT_MAX_RETRIES,
      backoff: new ExponentialBackoff({ initialDelay: 50, maxDelay: 2000 }),
    });
    const timeoutPolicy = timeout(cfg.timeoutMs ?? DEFAULT_BACKSTOP_TIMEOUT_MS, TimeoutStrategy.Aggressive);
    this.retryTimeout = wrap(retryPolicy, timeoutPolicy);
  }

  /** Run `fn` through retry+timeout inside the shared breaker. Rethrows the classified failure. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const value = await this.cb.execute(() => this.retryTimeout.execute(fn));
      this.consecutiveFailures = 0;
      this.lastSuccessAt = this.nowIso();
      return value;
    } catch (e) {
      this.consecutiveFailures += 1;
      this.lastError = classify(e);
      throw e;
    }
  }

  state(): HealthState {
    return mapState(this.cb.state);
  }

  health(): AdapterHealth {
    const base = { state: this.state(), consecutiveFailures: this.consecutiveFailures };
    const withSuccess =
      this.lastSuccessAt === undefined ? base : { ...base, lastSuccessAt: this.lastSuccessAt };
    return this.lastError === undefined ? withSuccess : { ...withSuccess, lastError: this.lastError };
  }
}

/** Map a cockatiel CircuitState to the adapter-contract HealthState (Isolated is treated as OPEN). */
export function mapState(state: CircuitState): HealthState {
  if (state === CircuitState.Closed) return 'CLOSED';
  if (state === CircuitState.HalfOpen) return 'HALF_OPEN';
  return 'OPEN';
}

/** Normalise any thrown value (incl. a cockatiel BrokenCircuitError) to a typed AdapterError. */
export function classify(e: unknown): AdapterError {
  if (isAdapterError(e)) return e;
  if (isBrokenCircuitError(e)) {
    return makeAdapterError('CIRCUIT_OPEN', 'circuit breaker is open; served fallback');
  }
  return makeAdapterError('UPSTREAM_UNAVAILABLE', errorMessage(e), { retryable: true, cause: e });
}
