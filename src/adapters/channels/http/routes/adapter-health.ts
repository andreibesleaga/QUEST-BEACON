// BEACON — adapter-health HTTP handler (E7·routes; SPEC §2.2, ADR-009/Art. XVI, F1). The operational read
// openapi.yaml declared and nothing served (UNIMPLEMENTED_REGISTER row 16): GET /health/adapters.
//
// It does NOT re-implement the source catalogue. The per-source effective mode + fetch instant are already
// computed by the `sources` verb (`GET /sources`), so this handler dispatches THAT verb through the shared
// core and adds the two operational verdicts a health surface owes an operator and `GET /sources` does not
// state: how OLD each source's newest datum is, and whether the redundancy ladder is standing on a fallback
// rung (Art. XVI degrade-labelled).
//
// HONEST LIMITATION, stated rather than faked (the SPEC §13.11 posture): the cockatiel breaker object lives
// INSIDE a per-composition adapter instance (`ManagedBreaker`, src/adapters/_shared/circuit-breaker.ts) and
// the live composition builds those instances per seed assembly and discards them — no process-wide breaker
// registry is reachable from an HTTP request. So this endpoint does NOT invent a CLOSED/OPEN/HALF_OPEN
// literal it cannot observe. It reports the breaker's OUTCOME, which it can: a source configured LIVE that
// is being served CACHED or MOCK is precisely "the ladder descended", and that is what `degraded` says.
// Restoring a literal breaker state requires the composition root to retain the registry (a src/main change,
// out of this lane's ownership) — tracked in the register row rather than papered over here.
import type { AppUserRole } from '@/domain/app-user.js';
import { roleRank } from '@/domain/app-user.js';
import type { DomainError } from '@/domain/errors.js';
import { Unauthorized } from '@/domain/errors.js';
import type { RegionId } from '@/domain/value-objects/ids.js';
import type { Envelope, InteractionPort, SourceRef } from '@/ports/interaction.js';
import type { SourceView } from '@/application/interaction/command-router.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { statusForError } from '../error-mapping.js';

/**
 * The age beyond which a source's newest datum is reported STALE. 900 s is the adapter-contract §5 default
 * cache TTL — i.e. the point at which the last-known-good copy a degraded adapter serves is itself expired,
 * so "older than this" is a statement the contract already makes rather than a number invented here. It is a
 * CONSTANT, not a new env var: adding one would need `EnvSchema` + `.env.example`, both outside this lane.
 */
const STALE_AFTER_SEC = 900;

/** The transport-neutral result this handler returns (mirrors HttpResponse's {status, body}). */
export interface AdapterHealthHttpResult {
  readonly status: number;
  readonly body: Envelope | Envelope<null>;
}

/** One adapter's operational row. `stale`/`degraded` are DERIVED verdicts, never upstream claims. */
export interface AdapterHealthRow {
  readonly adapterId: string;
  readonly mode: SourceView['mode'];
  readonly fetchedAt: string;
  /** Age of the newest datum in whole seconds. Absent when `fetchedAt` is not a parseable instant. */
  readonly ageSec?: number;
  /** True when the newest datum is older than STALE_AFTER_SEC — or when its instant cannot be read. */
  readonly stale: boolean;
  /** True when the ladder is serving a fallback rung (CACHED|MOCK) rather than the live source. */
  readonly degraded: boolean;
}

export interface AdapterHealthCounts {
  readonly total: number;
  readonly live: number;
  readonly cached: number;
  readonly mock: number;
  readonly stale: number;
}

export interface AdapterHealthData {
  readonly regionId: string;
  /** `ok` only when every adapter is LIVE and fresh; `degraded` when any is on a fallback rung or stale. */
  readonly status: 'ok' | 'degraded';
  readonly generatedAt: string;
  readonly staleAfterSec: number;
  readonly adapters: readonly AdapterHealthRow[];
  readonly counts: AdapterHealthCounts;
}

export interface AdapterHealthRequest {
  readonly role: AppUserRole;
  readonly regionId?: RegionId;
}

export interface AdapterHealthDeps {
  readonly interaction: InteractionPort;
  readonly clock: () => string;
}

function fail(error: DomainError): AdapterHealthHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

/** Whole seconds between `now` and an ISO instant, or undefined when the instant cannot be parsed. */
function ageSeconds(now: number, fetchedAt: string): number | undefined {
  const at = Date.parse(fetchedAt);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.round((now - at) / 1000));
}

function toRow(source: SourceView, now: number): AdapterHealthRow {
  const age = ageSeconds(now, source.fetchedAt);
  return {
    adapterId: source.sourceId,
    mode: source.mode,
    fetchedAt: source.fetchedAt,
    ...(age !== undefined ? { ageSec: age } : {}),
    // An unreadable instant is treated as STALE, never as fresh: a health surface must fail toward the
    // pessimistic verdict, or a broken timestamp would render as a green badge.
    stale: age === undefined || age > STALE_AFTER_SEC,
    degraded: source.mode !== 'LIVE',
  };
}

function countRows(rows: readonly AdapterHealthRow[]): AdapterHealthCounts {
  return {
    total: rows.length,
    live: rows.filter((r) => r.mode === 'LIVE').length,
    cached: rows.filter((r) => r.mode === 'CACHED').length,
    mock: rows.filter((r) => r.mode === 'MOCK').length,
    stale: rows.filter((r) => r.stale).length,
  };
}

/**
 * GET /health/adapters — per-source effective mode, freshness age and ladder verdict.
 *
 * RESPONDER+ (NOT public). `GET /sources` remains the PUBLIC provenance catalogue — this endpoint adds the
 * deployment's degradation posture (which sources are on a fallback rung right now, which are stale), which
 * is operational reconnaissance about the deployment rather than data about the emergency. openapi.yaml and
 * SPEC §2.2 previously marked it PUBLIC while it returned 404; the role is tightened as it is implemented.
 *
 * Always 200 when the caller is authorized: a degraded fleet is reported IN the body (`status: 'degraded'`),
 * never as an HTTP failure — a monitoring endpoint that 5xx's when the thing it monitors is unhappy cannot
 * be used to see that it is unhappy (Art. XVI).
 */
export async function handleAdapterHealth(
  req: AdapterHealthRequest,
  deps: AdapterHealthDeps,
): Promise<AdapterHealthHttpResult> {
  if (roleRank(req.role) < roleRank('RESPONDER')) {
    return fail(new Unauthorized(`GET /health/adapters requires RESPONDER+, actor is ${req.role}`));
  }
  const res = await deps.interaction.handle({
    channel: 'http',
    actorRole: req.role,
    command: { verb: 'sources', ...(req.regionId !== undefined ? { regionId: req.regionId } : {}) },
    receivedAt: deps.clock(),
  });
  if (!res.ok) return fail(res.error);
  const generatedAt = deps.clock();
  const { regionId, sources } = res.value.data as { readonly regionId: string; readonly sources: readonly SourceView[] };
  const adapters = sources.map((s) => toRow(s, Date.parse(generatedAt)));
  const counts = countRows(adapters);
  const data: AdapterHealthData = {
    regionId,
    status: counts.live === counts.total && counts.stale === 0 ? 'ok' : 'degraded',
    generatedAt,
    staleAfterSec: STALE_AFTER_SEC,
    adapters,
    counts,
  };
  // F1: a data response NEVER ships empty provenance. A region with no configured sources still produced
  // this report — from the deployment's own adapter configuration — so that is what it is attributed to.
  const provenance: readonly SourceRef[] =
    res.value.provenance.length > 0
      ? res.value.provenance
      : [{ sourceId: 'adapter-registry', mode: 'LIVE', fetchedAt: generatedAt }];
  return { status: 200, body: { data, provenance, freshness: res.value.freshness ?? generatedAt } };
}
