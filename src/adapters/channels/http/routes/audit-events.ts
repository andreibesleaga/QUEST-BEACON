// BEACON — audit-log read HTTP handler (E7·routes; SPEC §2.2, CLARIFICATIONS §B.Q6, ADR-017/ADR-022, F1).
// The governance read openapi.yaml declared and nothing served (UNIMPLEMENTED_REGISTER row 18):
// GET /audit-events.
//
// It reads the EXISTING hash chain — `AlertSink.audit` (src/adapters/compliance/audit-chain.ts), the same
// append-only chain the CAP emission path and the governance ledger write to (ADR-034 §5). There is no
// second chain and no projection copy: `events` are the chain's own rows and `chainVerified` is the chain's
// own `verify()`, so a reader can check tamper-evidence with the response alone.
//
// THREE properties, each load-bearing:
//  1. **VERIFIER+** (CLARIFICATIONS §B.Q6 "View audit log" — VERIFIER/EM; openapi + SPEC §2.2 agree). The
//     audit log names actors and decisions; it is never public.
//  2. **CHAIN ORDER, oldest first.** Each row's `prevHash` is its predecessor's `hash`, so serving append
//     order (rather than "newest first", which reads nicer) is what lets a client re-link and verify the
//     page it received. Pagination is offset-based for the same reason: a stable, re-linkable window.
//  3. **PII-free by construction.** The chain stores ids, actions, targets, instants and cost figures only
//     (THREAT §9.3, Art. XIV) — this handler adds no field and resolves no identity.
import type { AppUserRole } from '@/domain/app-user.js';
import { roleRank } from '@/domain/app-user.js';
import type { DomainError } from '@/domain/errors.js';
import { Unauthorized } from '@/domain/errors.js';
import type { AuditEvent } from '@/domain/audit-event.js';
import type { Envelope, SourceRef } from '@/ports/interaction.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import type { AuditSink } from '@/adapters/compliance/audit-chain.js';
import { statusForError } from '../error-mapping.js';

/** Page size defaults/ceiling. The ceiling bounds the response of an unbounded append-only log. */
export const AUDIT_EVENTS_DEFAULT_LIMIT = 50;
export const AUDIT_EVENTS_MAX_LIMIT = 500;

/** The transport-neutral result this handler returns (mirrors HttpResponse's {status, body}). */
export interface AuditEventsHttpResult {
  readonly status: number;
  readonly body: Envelope | Envelope<null>;
}

/** The pagination block mirrored onto `meta.page` (ResponseEnvelope.meta.page in openapi.yaml). */
export interface AuditEventsPage {
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  /** Offset of the next page as a string cursor, or null at the end of the chain. */
  readonly nextCursor: string | null;
}

export interface AuditEventsData {
  /** One page of the chain, OLDEST FIRST — the order in which `prevHash` links to `hash`. */
  readonly events: readonly AuditEvent[];
  /** Total rows in the chain (not in this page) — lets a client size the walk before making it. */
  readonly total: number;
  /** The chain's own integrity check over EVERY row, recomputed on this read (fail-closed on any gap). */
  readonly chainVerified: boolean;
}

export interface AuditEventsRequest {
  readonly role: AppUserRole;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AuditEventsDeps {
  /** The shared append-only chain (the alert sink's — the one CAP emission + governance write to). */
  readonly audit: AuditSink;
  readonly clock: () => string;
}

function fail(error: DomainError): AuditEventsHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

/** Clamp a caller-supplied page size into [1, MAX]; absent ⇒ the default. Never throws on a bad number. */
function pageLimit(requested: number | undefined): number {
  if (requested === undefined) return AUDIT_EVENTS_DEFAULT_LIMIT;
  return Math.min(AUDIT_EVENTS_MAX_LIMIT, Math.max(1, Math.trunc(requested)));
}

/**
 * GET /audit-events — one page of the hash-chained audit log. VERIFIER+.
 *
 * Provenance names the CHAIN itself: these rows are BEACON's own governance record, not an ingested feed,
 * so attributing them to an upstream source would misreport their origin (the same posture `handleRegions`
 * takes for the region registry). `freshness` is the injected clock — the instant the chain was read.
 */
export function handleAuditEvents(
  req: AuditEventsRequest,
  deps: AuditEventsDeps,
): Promise<AuditEventsHttpResult> {
  if (roleRank(req.role) < roleRank('VERIFIER')) {
    return Promise.resolve(
      fail(new Unauthorized(`GET /audit-events requires VERIFIER+, actor is ${req.role}`)),
    );
  }
  const all = deps.audit.events;
  const limit = pageLimit(req.limit);
  const offset = Math.max(0, Math.trunc(req.offset ?? 0));
  const events = all.slice(offset, offset + limit);
  const hasMore = offset + events.length < all.length;
  const fetchedAt = deps.clock();
  const provenance: readonly SourceRef[] = [
    { sourceId: 'beacon-audit-chain', mode: 'LIVE', fetchedAt },
  ];
  const data: AuditEventsData = { events, total: all.length, chainVerified: deps.audit.verify() };
  const page: AuditEventsPage = {
    limit,
    offset,
    hasMore,
    nextCursor: hasMore ? String(offset + events.length) : null,
  };
  return Promise.resolve({
    status: 200,
    body: { data, provenance, freshness: fetchedAt, meta: { page } },
  });
}
