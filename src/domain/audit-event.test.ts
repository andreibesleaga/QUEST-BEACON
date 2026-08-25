// BEACON — AUDIT_EVENT hash-chain tests (E1·T-082). Deterministic link; tamper/gap detection; cost fields.
import { describe, it, expect } from 'vitest';
import {
  makeAuditEvent,
  linkHash,
  verifyAuditLink,
  MODEL_TIERS,
  canonicalJson,
  evidenceDigest,
} from './audit-event.js';
import type { AuditPayload } from './audit-event.js';
import { asId } from './value-objects/ids.js';
import type { AuditEventId, AppUserId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';

const id1 = asId<AuditEventId>('a-1');
const id2 = asId<AuditEventId>('a-2');
const actorId = asId<AppUserId>('u-1');
const base = { action: 'CREATE', target: 'incident:i-1', at: '2026-07-06T00:00:00Z' };

describe('makeAuditEvent', () => {
  it('creates a genesis event with a hash and no prevHash', () => {
    const e = makeAuditEvent({ id: id1, ...base });
    expect(e.prevHash).toBeUndefined();
    expect(e.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('rejects empty action / target and an invalid instant', () => {
    expect(() => makeAuditEvent({ id: id1, action: '', target: 't', at: base.at })).toThrow(InvariantViolation);
    expect(() => makeAuditEvent({ id: id1, action: 'A', target: '', at: base.at })).toThrow(InvariantViolation);
    expect(() => makeAuditEvent({ id: id1, action: 'A', target: 't', at: 'not-a-date' })).toThrow(InvariantViolation);
  });

  it('carries nullable cost attribution and validates modelTier enum', () => {
    const e = makeAuditEvent({ id: id1, ...base, costTokensIn: 10, costTokensOut: 20, costUsd: 0.003, modelTier: 'CLOUD' });
    expect(e.costTokensIn).toBe(10);
    expect(e.modelTier).toBe('CLOUD');
    for (const tier of MODEL_TIERS) {
      expect(makeAuditEvent({ id: id1, ...base, modelTier: tier }).modelTier).toBe(tier);
    }
    expect(() => makeAuditEvent({ id: id1, ...base, modelTier: 'GPU' as never })).toThrow(InvariantViolation);
  });
});

describe('hash chain', () => {
  it('is deterministic and order-independent over payload keys', () => {
    const a: AuditPayload = { action: 'X', target: 'y', at: base.at, actorId, costUsd: 1 };
    const b: AuditPayload = { at: base.at, costUsd: 1, target: 'y', action: 'X', actorId };
    expect(linkHash('prev', a)).toBe(linkHash('prev', b));
  });

  it('links each event to its predecessor and verifies the chain', () => {
    const e1 = makeAuditEvent({ id: id1, ...base });
    const e2 = makeAuditEvent({ id: id2, actorId, action: 'UPDATE', target: 'incident:i-1', at: '2026-07-06T01:00:00Z', prevHash: e1.hash });
    expect(e2.prevHash).toBe(e1.hash);
    expect(verifyAuditLink(e1, undefined)).toBe(true);
    expect(verifyAuditLink(e2, e1.hash)).toBe(true);
  });

  it('detects a broken chain (wrong predecessor hash)', () => {
    const e1 = makeAuditEvent({ id: id1, ...base });
    const e2 = makeAuditEvent({ id: id2, ...base, at: '2026-07-06T02:00:00Z', prevHash: e1.hash });
    expect(verifyAuditLink(e2, 'deadbeef')).toBe(false);
  });

  it('detects tampering (payload changed after hashing)', () => {
    const e1 = makeAuditEvent({ id: id1, ...base });
    const tampered = { ...e1, target: 'incident:HACKED' };
    expect(verifyAuditLink(tampered, undefined)).toBe(false);
  });

  it('canonicalizes null and array payload values deterministically', () => {
    // Exercises the null arm and the Array.isArray arm of canonicalize via linkHash: a payload
    // carrying a null field and an array field still hashes to a stable 8-char digest.
    const nested = { action: 'X', target: 'y', at: base.at, nullField: null, arr: [1, 'two', null] };
    const payload = nested as unknown as AuditPayload;
    const h1 = linkHash(undefined, payload);
    const h2 = linkHash(undefined, { ...nested } as unknown as AuditPayload);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
    expect(h1).toBe(h2); // deterministic across the null + array arms
  });
});

// ── The MW-D/D4 governance-ledger extension (ADR-034 §5): ONE additive optional field ────────────────
describe('evidenceDigest extension (additive, provably non-breaking)', () => {
  it('reproduces the PRE-CHANGE hash exactly when absent — every committed chain stays valid', () => {
    // `f726467d` was produced by running the PRE-EXTENSION implementation (`git show HEAD:` of this module)
    // against this exact payload; it is hard-coded on purpose, because recomputing it from the current code
    // would make the assertion vacuous. This is what "provably non-breaking" means here: every audit hash
    // already committed to disk still verifies, because `canonicalize` omits the absent optional key.
    expect(linkHash(undefined, { action: 'CREATE', target: 'incident:i-1', at: '2026-07-06T00:00:00Z' })).toBe(
      'f726467d',
    );
    const e = makeAuditEvent({ id: id1, ...base });
    expect(e.hash).toBe('f726467d');
    expect(Object.keys(e)).not.toContain('evidenceDigest');
    // Explicit `undefined` must also be omitted, not hashed as a key (canonicalize drops undefined).
    const absent: { evidenceDigest?: string } = {};
    expect(makeAuditEvent({ id: id1, ...base, ...absent }).hash).toBe('f726467d');
  });

  it('changes the hash when present, so the evidence is genuinely BOUND to the chain', () => {
    const withDigest = makeAuditEvent({ id: id1, ...base, evidenceDigest: 'cafebabe' });
    expect(withDigest.evidenceDigest).toBe('cafebabe');
    expect(withDigest.hash).not.toBe('f726467d');
    expect(verifyAuditLink(withDigest, undefined)).toBe(true);
    // Swapping the digest for a different evidence record breaks the link — this is the tamper detection.
    expect(verifyAuditLink({ ...withDigest, evidenceDigest: 'deadbeef' }, undefined)).toBe(false);
  });

  it('canonicalJson is key-order independent and omits undefined (so digests are content addresses)', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([1, null, 'x'])).toBe('[1,null,"x"]');
  });

  it('evidenceDigest is deterministic, order-independent and sensitive to any value change', () => {
    const evidence = { membersOverThreshold: 34, memberTotal: 51, cutoff: '2026-07-05T22:00:00.000Z' };
    expect(evidenceDigest(evidence)).toBe(evidenceDigest({ ...evidence }));
    expect(evidenceDigest(evidence)).toMatch(/^[0-9a-f]{8}$/);
    expect(evidenceDigest({ ...evidence, membersOverThreshold: 35 })).not.toBe(evidenceDigest(evidence));
  });
});
