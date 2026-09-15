// BEACON — narration memo: a cost guard in front of the compliance gateway.
//
// WHY THIS EXISTS. `synthesizeSitRep` narrates on every SitRep READ, and the COP refetches the SitRep on
// every SSE delta. With many live sources enabled, deltas arrive continuously, so an idle browser tab
// could drive one cloud model call every few seconds — observed on the cloud deployment at ~4 s apart,
// each an identical request (same facts in, same prose out). The deterministic facts had not changed;
// only the number of invoices had.
//
// WHAT IT DOES. For an IDENTICAL (actorRole, modelTier, operation, payload) request, within a short TTL,
// it returns the decision the gateway ALREADY allowed instead of calling the model again. The facts are
// the cache key, so any change to the deterministic record — a new hotspot, a fresher gauge, a different
// role's view — is a different key and narrates afresh.
//
// WHERE IT SITS, AND WHY IN FRONT. A cache hit is NOT a model call: no tokens are spent and no money
// moves. Placing the memo in FRONT of the gateway is therefore the honest placement — the hash-chained
// audit ledger and the cost accounting record model calls only when a model was actually reached. Had it
// been placed inside the gateway (around `upstream`), every cache hit would still have written an
// `ai_call` record with a cost that was never incurred, corrupting the very ledger this project asks
// judges to trust.
//
// SINGLE-FLIGHT (added with ADR-038). A memo can only serve a fact set that has ALREADY been narrated
// once, so the first read of every new fact set still reaches the model. Async narration (ADR-038) turns
// that first call into a background one and returns the deterministic SitRep immediately — which means the
// NEXT read arrives while the first call is still in flight. Caching completed decisions alone would let
// each of those reads start its own model call and re-open the very leak this file exists to close, so an
// in-flight request is shared: concurrent callers with the same key join the SAME upstream call. A fact set
// is therefore narrated at most once at a time, however many reads race for it. A flight is forgotten as
// soon as it settles, in either direction — a failure must stay free to retry.
//
// WHAT IS TRADED. The gateway's per-call stages (rate-limit, firewall, PII, policy, cost) do not re-run
// for a hit. That is sound because the response served is byte-identical to one those stages already
// passed, for the same role, within the TTL window — no content reaches an actor who was not already
// allowed to see it. Blocks and errors are NEVER cached: a breaker-open or policy denial must be free to
// clear on the next attempt.
import { createHash } from 'node:crypto';
import { ok, isErr } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { AICompliancePort, ComplianceDecision, ComplianceRequest } from '@/ports/intel.js';

/** Two minutes: long enough to collapse an SSE-driven refetch storm, short enough that a stale narration
 *  can never outlive the freshness badge the operator reads beside it. */
const DEFAULT_TTL_SEC = 120;

/** Bounded so a long-running instance cannot grow the cache without limit (oldest entry is evicted). */
const DEFAULT_MAX_ENTRIES = 64;

export interface NarrationMemoOptions {
  /** TTL in seconds. `0` (or negative) disables memoization entirely — the gateway is returned unwrapped. */
  readonly ttlSec?: number;
  readonly maxEntries?: number;
  /** Injectable clock (tests). Defaults to `Date.now`. */
  readonly now?: () => number;
}

interface Entry {
  readonly at: number;
  readonly decision: unknown;
}

/**
 * Wrap an `AICompliancePort` so identical, already-allowed requests are served from a short-lived
 * in-memory cache. Returns `inner` unchanged when the TTL is not positive.
 */
export function withNarrationMemo(
  inner: AICompliancePort,
  options: NarrationMemoOptions = {},
): AICompliancePort {
  const ttlMs = (options.ttlSec ?? DEFAULT_TTL_SEC) * 1000;
  if (ttlMs <= 0) return inner;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? ((): number => Date.now());
  const cache = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<Result<ComplianceDecision<unknown>, DomainError>>>();

  return {
    async mediate<TReq, TRes>(
      request: ComplianceRequest<TReq>,
    ): Promise<Result<ComplianceDecision<TRes>, DomainError>> {
      const key = cacheKey(request);
      const hit = cache.get(key);
      if (hit !== undefined) {
        if (now() - hit.at < ttlMs) return ok(hit.decision as ComplianceDecision<TRes>);
        cache.delete(key); // expired — fall through and narrate again
      }
      const joined = inFlight.get(key);
      // Someone is already asking the model this exact question — wait for THAT answer, don't buy another.
      if (joined !== undefined)
        return joined as Promise<Result<ComplianceDecision<TRes>, DomainError>>;
      const flight = inner
        .mediate<TReq, TRes>(request)
        .then((res) => {
          if (!isErr(res)) {
            const decision = res.value;
            if (decision.allowed && decision.result !== undefined)
              remember(cache, key, decision, now(), maxEntries);
          }
          return res; // errors pass through uncached — a breaker-open must be free to clear
        })
        .finally(() => {
          inFlight.delete(key); // settled either way: never strand a key on a failed call
        });
      inFlight.set(key, flight as Promise<Result<ComplianceDecision<unknown>, DomainError>>);
      return flight;
    },
  };
}

/** Evict the oldest entry once the bound is reached, then record this one. */
function remember(
  cache: Map<string, Entry>,
  key: string,
  decision: unknown,
  at: number,
  maxEntries: number,
): void {
  if (cache.size >= maxEntries) {
    const oldest = cache.keys().next();
    if (oldest.done !== true) cache.delete(oldest.value);
  }
  cache.set(key, { at, decision });
}

/** The identity of a request: role + tier + operation + a stable digest of the payload (the facts). */
function cacheKey(request: ComplianceRequest<unknown>): string {
  const digest = createHash('sha256').update(stableStringify(request.payload)).digest('hex');
  return `${request.actorRole}|${request.modelTier}|${request.operation}|${digest}`;
}

/**
 * JSON with object keys sorted at every depth, so two payloads that differ only in property order share a
 * key. Arrays keep their order — a reordered fact list is a different SitRep and must narrate afresh.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
