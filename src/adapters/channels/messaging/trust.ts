// BEACON — inbound trust mapping (E10·T-455; ADR-023 §trust, SECURITY_BASELINE, ADR-017). ALL messaging
// input is UNTRUSTED. Before a message may reach the core it must clear, in order:
//   (1) transport signature — HMAC-SHA256 over the canonical payload with a per-transport secret;
//   (2) sender allow-list — senderId → AppUserRole (unknown sender rejected);
//   (3) replay guard — a (transport, senderId, signature) tuple seen before is rejected;
//   (4) rate-limit — a naive per-sender sliding window on the INJECTED clock (no wall-clock read);
//   (5) input firewall — scanInput (reused from the compliance adapter) rejects injection/blocked text.
// Only then is the parsed Command wrapped into an InteractionRequest with an injected `receivedAt`.
// node:crypto is allowed here (adapter layer, not domain).
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError, Unauthorized } from '@/domain/errors.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { InboundMessage, InteractionRequest } from '@/ports/interaction.js';
import { scanInput } from '@/adapters/compliance/index.js';
import type { CompiledPattern } from '@/adapters/compliance/index.js';
import { parseMessageToCommand } from './parse.js';

/** senderId → role. The ONLY senders the transport trusts (allow-list, deny-by-default). */
export type SenderAllowList = Readonly<Record<string, AppUserRole>>;

/** Naive per-sender rate-limit config (sliding window over the injected clock). */
export interface RateLimitConfig {
  readonly maxPerWindow: number;
  readonly windowMs: number;
}

const DEFAULT_RATE: RateLimitConfig = { maxPerWindow: 5, windowMs: 60_000 };

/** Reject a validly-signed message whose `receivedAt` is outside this window from now — bounds replay of a
 *  captured message across a process restart / second instance (the in-memory `seen` set alone cannot). */
const DEFAULT_FRESHNESS_MS = 5 * 60_000;

/** Mutable, injectable trust state (replay set + per-sender hit timestamps). Tests build a fresh one. */
export interface InboundStore {
  readonly seen: Set<string>;
  readonly rate: Map<string, number[]>;
}

export const makeInboundStore = (): InboundStore => ({ seen: new Set<string>(), rate: new Map() });

/** Everything mapInbound needs — all injected (deterministic tests: fixed clock, fixed secret/allow-list). */
export interface InboundDeps {
  readonly secret: string; // per-transport HMAC secret (from env, never hardcoded)
  readonly allowList: SenderAllowList;
  readonly store: InboundStore;
  readonly clock: () => string; // ISO-8601 now (injected)
  readonly blocked?: readonly CompiledPattern[]; // policy blocked-command patterns (default: none)
  readonly rateLimit?: RateLimitConfig;
  readonly freshnessMs?: number; // accepted |now - receivedAt| window (default 5 min)
}

/** Canonical bytes we sign/verify — deliberately excludes the signature field itself. */
function canonical(
  msg: Pick<InboundMessage, 'transport' | 'senderId' | 'receivedAt' | 'text'>,
): string {
  return [msg.transport, msg.senderId, msg.receivedAt, msg.text].join('\n');
}

/** Compute the transport signature for a message (also used by senders/tests to produce a valid one). */
export function signInbound(
  secret: string,
  msg: Pick<InboundMessage, 'transport' | 'senderId' | 'receivedAt' | 'text'>,
): string {
  return createHmac('sha256', secret).update(canonical(msg)).digest('hex');
}

/** Constant-time signature check; a missing/mis-shaped signature fails closed. */
function verifySignature(secret: string, msg: InboundMessage): boolean {
  if (msg.signature === undefined || msg.signature.length === 0) return false;
  const expected = Buffer.from(signInbound(secret, msg), 'hex');
  const provided = Buffer.from(msg.signature, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Admit under the rate limit; on success records this hit against the sliding window. Mutates on OK. */
function admitRate(deps: InboundDeps, senderId: string): Result<void, DomainError> {
  const cfg = deps.rateLimit ?? DEFAULT_RATE;
  const now = Date.parse(deps.clock());
  const recent = (deps.store.rate.get(senderId) ?? []).filter((t) => now - t < cfg.windowMs);
  if (recent.length >= cfg.maxPerWindow) {
    return err(new DomainError('CONFLICT', `rate limit exceeded for sender ${senderId}`));
  }
  recent.push(now);
  deps.store.rate.set(senderId, recent);
  return ok(undefined);
}

/**
 * Freshness guard: reject a validly-signed message whose `receivedAt` is outside the window from now
 * (receivedAt is inside the signed canonical → trusted once the signature verifies). Bounds replay of a
 * captured-but-valid message after a restart / on a second instance where the in-memory `seen` set is empty.
 */
function freshnessError(deps: InboundDeps, msg: InboundMessage): DomainError | null {
  const skew = Math.abs(Date.parse(deps.clock()) - Date.parse(msg.receivedAt));
  return Number.isNaN(skew) || skew > (deps.freshnessMs ?? DEFAULT_FRESHNESS_MS)
    ? new Unauthorized('message outside freshness window (stale/replayed)')
    : null;
}

/**
 * Map a raw InboundMessage into an authenticated InteractionRequest, or a typed DomainError. Order is
 * security-first: signature → freshness → allow-list → replay → rate → firewall → parse. Complexity kept
 * < 10 by delegating each check to a helper.
 */
/** Build the authenticated request (extracted for the complexity ceiling). Locale is presentation-only. */
function toRequest(
  msg: InboundMessage,
  role: InteractionRequest['actorRole'],
  command: InteractionRequest['command'],
  receivedAt: string,
): InteractionRequest {
  return {
    channel: msg.transport,
    actorRole: role,
    command,
    receivedAt,
    ...(msg.locale !== undefined ? { locale: msg.locale } : {}),
  };
}

export function mapInbound(
  msg: InboundMessage,
  deps: InboundDeps,
): Result<InteractionRequest, DomainError> {
  if (!verifySignature(deps.secret, msg)) {
    return err(new Unauthorized('invalid transport signature'));
  }
  const stale = freshnessError(deps, msg);
  if (stale) return err(stale);
  const role = deps.allowList[msg.senderId];
  if (role === undefined) {
    return err(new Unauthorized(`sender not on allow-list: ${msg.senderId}`));
  }
  const replayKey = `${msg.transport}:${msg.senderId}:${msg.signature ?? ''}`;
  if (deps.store.seen.has(replayKey)) {
    return err(new DomainError('CONFLICT', 'replayed message rejected'));
  }
  const rated = admitRate(deps, msg.senderId);
  if (!rated.ok) return rated;
  const hit = scanInput(msg.text, deps.blocked ?? []);
  if (hit) {
    return err(new Unauthorized(`input firewall blocked message (${hit.kind})`));
  }
  const parsed = parseMessageToCommand(msg.text);
  if (!parsed.ok) return parsed;

  deps.store.seen.add(replayKey); // consume the replay slot only on a fully-accepted message
  return ok<InteractionRequest>(toRequest(msg, role, parsed.value, deps.clock()));
}
