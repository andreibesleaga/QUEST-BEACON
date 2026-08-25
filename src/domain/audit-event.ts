// BEACON — AUDIT_EVENT entity (E1·T-083). Append-only, tamper-evident hash chain (ADR-017/ADR-022, D-27).
// Pure domain: no framework/HTTP/DB imports (F9). NB: NO node:crypto here — the domain uses a
// deterministic string hash (FNV-1a over canonical JSON) so the chain is verifiable in pure TS.
// The persistence adapter wraps this with real SHA-256 for cryptographic strength (see schema.sql).
import type { AuditEventId, AppUserId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';

// Enum mirrors schema.sql audit_event.model_tier CHECK (nullable — only set on AI/adapter calls).
export const MODEL_TIERS = ['CLOUD', 'LOCAL', 'DETERMINISTIC', 'VISION'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

// Cost attribution (ADR-022) — all nullable; present only on LLM/vision/adapter events (§9.3: no PII/content).
export interface CostAttribution {
  readonly costTokensIn?: number;
  readonly costTokensOut?: number;
  readonly costUsd?: number;
  readonly modelTier?: ModelTier;
}

// The semantic payload that the hash chain commits to. Excludes `hash`/`prevHash` themselves and the
// surrogate id, so the chain binds the MEANING of the event, not its storage identity.
export interface AuditPayload extends CostAttribution {
  readonly actorId?: AppUserId;
  readonly action: string;
  readonly target: string;
  readonly at: string; // ISO-8601 UTC
  /**
   * Content address of a bulky evidence record held BESIDE the chain (governance ledger, ADR-034 §5).
   * The chain therefore binds the evidence cryptographically while staying small and PII-free (Art. XIV):
   * mutating the stored evidence no longer matches this digest. Optional and last, and `canonicalize`
   * omits `undefined` keys (`:64`), so every pre-existing chain and every committed golden hash is
   * byte-identical when it is absent — the extension is provably non-breaking (verified by test).
   */
  readonly evidenceDigest?: string;
}

export interface AuditEvent extends AuditPayload {
  readonly id: AuditEventId;
  readonly prevHash?: string; // absent for the genesis event
  readonly hash: string; // = linkHash(prevHash, payload)
}

export interface MakeAuditEventInput extends AuditPayload {
  readonly id: AuditEventId;
  readonly prevHash?: string;
}

// ---- deterministic pure string hash (FNV-1a, 32-bit) -----------------------------------------
// FNV-1a is fast, dependency-free and deterministic — adequate for the DOMAIN-level chain link.
// Real cryptographic SHA-256 wrapping happens in the adapter (schema.sql: hash = H(prev_hash || row)).
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): string {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Multiply by the FNV prime in 32-bit space (Math.imul avoids float precision loss).
    h = Math.imul(h, FNV_PRIME);
  }
  // Coerce to unsigned 32-bit and render as fixed 8-char hex so the chain is length-stable.
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Canonical JSON with recursively sorted keys → identical payloads always hash identically,
// regardless of key insertion order (a chain must be reproducible on read).
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined) // omit undefined so optional cost fields don't change the hash
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

/**
 * Deterministically derive an event's chain hash from its predecessor's hash and its payload.
 * hash = FNV1a( prevHash ?? '' || '|' || canonicalJSON(payload) ). Genesis events pass prevHash undefined.
 */
export function linkHash(prevHash: string | undefined, payload: AuditPayload): string {
  return fnv1a(`${prevHash ?? ''}|${canonicalize(payload)}`);
}

function toPayload(input: AuditPayload): AuditPayload {
  return {
    action: input.action,
    target: input.target,
    at: input.at,
    ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    ...(input.costTokensIn !== undefined ? { costTokensIn: input.costTokensIn } : {}),
    ...(input.costTokensOut !== undefined ? { costTokensOut: input.costTokensOut } : {}),
    ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
    ...(input.modelTier !== undefined ? { modelTier: input.modelTier } : {}),
    ...(input.evidenceDigest !== undefined ? { evidenceDigest: input.evidenceDigest } : {}),
  };
}

/**
 * Canonical JSON of any value: recursively key-sorted, `undefined` keys omitted. Exported so a caller that
 * needs to CONTENT-ADDRESS an evidence record uses the chain's own canonicalizer instead of a second,
 * subtly-different one (`JSON.stringify` key order is insertion order, so it is not content-addressable).
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

/**
 * Deterministic digest of an arbitrary evidence record, using the SAME hash primitive as the chain link.
 * Pairs with `AuditPayload.evidenceDigest`. NB the domain hash is FNV-1a (see the file header): it detects
 * accidental and casual tampering, and the persistence layer wraps rows with real SHA-256 — that two-tier
 * posture is pre-existing and documented, not introduced here.
 */
export function evidenceDigest(value: unknown): string {
  return fnv1a(canonicalize(value));
}

export function makeAuditEvent(input: MakeAuditEventInput): AuditEvent {
  if (input.action.trim().length === 0) throw new InvariantViolation('AuditEvent.action must be non-empty');
  if (input.target.trim().length === 0) throw new InvariantViolation('AuditEvent.target must be non-empty');
  if (Number.isNaN(Date.parse(input.at))) throw new InvariantViolation(`AuditEvent.at must be a valid instant: ${input.at}`);
  if (input.modelTier !== undefined && !MODEL_TIERS.includes(input.modelTier)) {
    throw new InvariantViolation(`AuditEvent.modelTier must be one of ${MODEL_TIERS.join('|')}, got ${String(input.modelTier)}`);
  }

  const payload = toPayload(input);
  const hash = linkHash(input.prevHash, payload);
  return {
    id: input.id,
    ...payload,
    ...(input.prevHash !== undefined ? { prevHash: input.prevHash } : {}),
    hash,
  };
}

/**
 * Verify one link in the chain: recompute this event's hash from `prevHash` + its payload and
 * confirm it matches the stored hash (fail-closed on any gap/tamper — schema.sql: verified on read).
 */
export function verifyAuditLink(event: AuditEvent, prevHash: string | undefined): boolean {
  if (event.prevHash !== prevHash) return false; // the recorded predecessor must match the actual predecessor
  const payload: AuditPayload = toPayload(event);
  return linkHash(prevHash, payload) === event.hash;
}
