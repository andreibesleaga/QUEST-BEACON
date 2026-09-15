// BEACON — PUBLIC_REPORT invariant tests (E1·T-060). Consent + status machine + confidence range.
import { describe, it, expect } from 'vitest';
import { asId } from './value-objects/ids.js';
import type { PublicReportId } from './value-objects/ids.js';
import { InvariantViolation, InvalidTransition } from './errors.js';
import {
  makePublicReport,
  transitionPublicReport,
  PUBLIC_REPORT_CATEGORIES,
  REPORT_TEXT_MAX_LENGTH,
} from './public-report.js';
import { DAMAGE_REPORT_CATEGORIES } from './damage-assessment.js';
import { LINK_POLICY_MAX_LENGTH } from './shared/link-policy.js';

const id = asId<PublicReportId>('11111111-1111-1111-1111-111111111111');
const base = { id, source: 'WEB', consent: true, purgeAfter: '2026-01-01T00:00:00.000Z' } as const;

describe('makePublicReport', () => {
  it('constructs a consented UNVERIFIED report by default', () => {
    const rep = makePublicReport({ ...base });
    expect(rep.status).toBe('UNVERIFIED');
    expect(rep.consent).toBe(true);
    expect(rep.purgeAfter).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects consent=false (EV4 intake invariant)', () => {
    expect(() => makePublicReport({ ...base, consent: false })).toThrow(InvariantViolation);
  });

  it('rejects confidence > 1', () => {
    expect(() => makePublicReport({ ...base, confidence: 1.5 })).toThrow(InvariantViolation);
  });

  it('rejects confidence < 0', () => {
    expect(() => makePublicReport({ ...base, confidence: -0.1 })).toThrow(InvariantViolation);
  });

  it('accepts confidence within [0,1]', () => {
    expect(makePublicReport({ ...base, confidence: 0.42 }).confidence).toBe(0.42);
  });

  it('rejects an invalid source enum', () => {
    // @ts-expect-error — exercising the runtime guard with an out-of-enum value
    expect(() => makePublicReport({ ...base, source: 'CARRIER_PIGEON' })).toThrow(
      InvariantViolation,
    );
  });

  it('keeps geomPrecise separate from geomGeneralized (Art. XIV split)', () => {
    const rep = makePublicReport({
      ...base,
      geomGeneralized: { type: 'Point', coordinates: [0, 0] },
      geomPrecise: { type: 'Point', coordinates: [1, 1] },
    });
    expect(rep.geomGeneralized?.type).toBe('Point');
    expect(rep.geomPrecise?.coordinates).toEqual([1, 1]);
  });
});

// Live Views v1.2 (ADR-029): optional citizen live-view link — https-only, non-IP host, ≤2048 chars.
describe('makePublicReport — liveViewUrl (Live Views v1.2)', () => {
  it('omits liveViewUrl when absent (byte-identical to a pre-feature report)', () => {
    const rep = makePublicReport({ ...base });
    expect('liveViewUrl' in rep).toBe(false);
  });

  it('accepts a valid https live-view link', () => {
    const rep = makePublicReport({ ...base, liveViewUrl: 'https://youtube.com/live/abc123' });
    expect(rep.liveViewUrl).toBe('https://youtube.com/live/abc123');
  });

  it('rejects a non-https (http) link', () => {
    expect(() => makePublicReport({ ...base, liveViewUrl: 'http://youtube.com/live/abc' })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects an IPv4-literal host (SSRF pivot)', () => {
    expect(() =>
      makePublicReport({ ...base, liveViewUrl: 'https://169.254.169.254/live' }),
    ).toThrow(InvariantViolation);
  });

  it('rejects an IPv6-literal host', () => {
    expect(() => makePublicReport({ ...base, liveViewUrl: 'https://[::1]/live' })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a link over the 2048-char cap', () => {
    const tooLong = `https://youtube.com/live/${'a'.repeat(2048)}`;
    expect(() => makePublicReport({ ...base, liveViewUrl: tooLong })).toThrow(InvariantViolation);
  });

  // F-153: this file's private `assertValidLiveViewUrl` (the strictest of the six copies) is gone — the
  // invariant is now `assertLinkOnlyUrl` from @/domain/shared/link-policy. The three tests above are the
  // behavioural proof that NOTHING was loosened by that convergence; this one pins the boundary itself, so
  // a future edit to the shared cap cannot silently relax the SSRF-adjacent field it was written for.
  it('F-153 enforces exactly the shared LINK_POLICY_MAX_LENGTH boundary: at the cap passes, one over throws', () => {
    expect(LINK_POLICY_MAX_LENGTH).toBe(2048);
    const prefix = 'https://youtube.com/live/';
    const atCap = prefix + 'a'.repeat(LINK_POLICY_MAX_LENGTH - prefix.length);
    expect(atCap).toHaveLength(LINK_POLICY_MAX_LENGTH);
    expect(makePublicReport({ ...base, liveViewUrl: atCap }).liveViewUrl).toBe(atCap);
    expect(() => makePublicReport({ ...base, liveViewUrl: `${atCap}a` })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a non-URL string', () => {
    expect(() => makePublicReport({ ...base, liveViewUrl: 'not a url' })).toThrow(
      InvariantViolation,
    );
  });

  it('is purged with the report — the field rides on the same row governed by purgeAfter', () => {
    // No separate lifecycle: liveViewUrl is a plain field on the report, dropped when the row is purged.
    const rep = makePublicReport({ ...base, liveViewUrl: 'https://twitch.tv/somechannel' });
    expect(rep.purgeAfter).toBe(base.purgeAfter);
    expect(rep.liveViewUrl).toBe('https://twitch.tv/somechannel');
  });
});

// receivedAt — optional receipt instant stamped at intake (powers the live-view chip's ~2h TTL fade).
describe('makePublicReport — receivedAt (Live Views v1.2)', () => {
  it('omits receivedAt when absent (byte-identical to a pre-feature report)', () => {
    expect(makePublicReport({ ...base })).not.toHaveProperty('receivedAt');
  });

  it('accepts and preserves a valid ISO-8601 receipt instant', () => {
    const rep = makePublicReport({ ...base, receivedAt: '2026-07-05T22:00:00.000Z' });
    expect(rep.receivedAt).toBe('2026-07-05T22:00:00.000Z');
  });

  it('rejects an unparseable receivedAt (mirrors the purgeAfter timestamp invariant)', () => {
    expect(() => makePublicReport({ ...base, receivedAt: 'not-a-date' })).toThrow(
      InvariantViolation,
    );
  });
});

describe('makePublicReport — text (the claim under review, Art. XIII)', () => {
  it('omits text when absent (rows predating migration 0006 stay byte-identical)', () => {
    expect(makePublicReport({ ...base })).not.toHaveProperty('text');
  });

  it('preserves the reporter claim verbatim — never normalised or truncated silently', () => {
    const claim = 'Smoke on the ridge.\nRoad out is blocked.';
    expect(makePublicReport({ ...base, text: claim }).text).toBe(claim);
  });

  it('accepts a claim exactly at the cap (boundary is inclusive)', () => {
    const claim = 'x'.repeat(REPORT_TEXT_MAX_LENGTH);
    expect(makePublicReport({ ...base, text: claim }).text).toHaveLength(REPORT_TEXT_MAX_LENGTH);
  });

  it('rejects a claim over the cap — the transport edge only checks non-empty, so the domain bounds it', () => {
    const claim = 'x'.repeat(REPORT_TEXT_MAX_LENGTH + 1);
    expect(() => makePublicReport({ ...base, text: claim })).toThrow(InvariantViolation);
  });

  it('rejects a blank/whitespace-only claim — the invariant must hold for non-HTTP callers too', () => {
    expect(() => makePublicReport({ ...base, text: '   \n\t ' })).toThrow(InvariantViolation);
    expect(() => makePublicReport({ ...base, text: '' })).toThrow(InvariantViolation);
  });
});

describe('transitionPublicReport', () => {
  it('rejects the UNVERIFIED→VERIFIED direct hop (must pass through TRIAGED)', () => {
    const rep = makePublicReport({ ...base });
    expect(() => transitionPublicReport(rep, 'VERIFIED')).toThrow(InvalidTransition);
  });

  it('allows UNVERIFIED→TRIAGED→VERIFIED', () => {
    const rep = makePublicReport({ ...base });
    const triaged = transitionPublicReport(rep, 'TRIAGED');
    expect(triaged.status).toBe('TRIAGED');
    const verified = transitionPublicReport(triaged, 'VERIFIED');
    expect(verified.status).toBe('VERIFIED');
  });

  it('allows TRIAGED→REJECTED but treats REJECTED as terminal', () => {
    const rep = makePublicReport({ ...base });
    const triaged = transitionPublicReport(rep, 'TRIAGED');
    const rejected = transitionPublicReport(triaged, 'REJECTED');
    expect(rejected.status).toBe('REJECTED');
    expect(() => transitionPublicReport(rejected, 'VERIFIED')).toThrow(InvalidTransition);
  });
});

// ── FR-D4-4 category (ADR-036 §7 / G14; finding F-151). `source` is the CHANNEL; `category` is the KIND. ──
describe('PublicReport.category', () => {
  it('is absent by default — an uncategorised report is not a silently-assumed SOS', () => {
    expect(makePublicReport({ ...base }).category).toBeUndefined();
  });

  it('accepts every category in the closed vocabulary', () => {
    for (const category of PUBLIC_REPORT_CATEGORIES) {
      expect(makePublicReport({ ...base, category }).category).toBe(category);
    }
  });

  it('rejects a category outside the vocabulary, naming the allowed set', () => {
    expect(() => makePublicReport({ ...base, category: 'FLOODED' as 'DAMAGE' })).toThrow(
      InvariantViolation,
    );
    expect(() => makePublicReport({ ...base, category: 'FLOODED' as 'DAMAGE' })).toThrow(
      /SOS\|DAMAGE\|NEED/,
    );
  });

  it('is the ONE definition the damage-assessment view aliases — not a second copy', () => {
    // Identity, not equality: `DAMAGE_REPORT_CATEGORIES` must BE this array, or the two can drift apart.
    expect(DAMAGE_REPORT_CATEGORIES).toBe(PUBLIC_REPORT_CATEGORIES);
  });
});
