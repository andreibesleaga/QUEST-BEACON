// BEACON — CameraFeed factory tests (E11 · CW0). Invariants: non-empty id/title/provider/license, valid
// closed WGS84 position, a valid kind, boolean isLive, and — the headline guard — an https-ONLY viewUrl
// (the link-out href-injection defence: http/javascript:/data:/mailto:/garbage are all rejected).
import { describe, it, expect } from 'vitest';
import { makeCameraFeed, CAMERA_FEED_KINDS, type MakeCameraFeedInput } from './camera-feed.js';
import { InvariantViolation } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { CameraFeedId } from './value-objects/ids.js';
import { LINK_POLICY_MAX_LENGTH } from './shared/link-policy.js';

const ID = asId<CameraFeedId>('alertca:cam-2');

const base: MakeCameraFeedInput = {
  id: ID,
  position: [-121.62, 39.76],
  kind: 'FIRE_CAMERA',
  title: 'Colby Fire — Camera 2',
  provider: 'ALERTCalifornia',
  viewUrl: 'https://cameras.alertcalifornia.org/cam/colby-2',
  license: 'ALERTCalifornia | UC San Diego (CC BY-NC-ND)',
  isLive: true,
};

describe('makeCameraFeed', () => {
  it('builds a valid live camera feed', () => {
    const cam = makeCameraFeed(base);
    expect(cam.id).toBe(ID);
    expect(cam.position).toEqual([-121.62, 39.76]);
    expect(cam.kind).toBe('FIRE_CAMERA');
    expect(cam.title).toBe('Colby Fire — Camera 2');
    expect(cam.provider).toBe('ALERTCalifornia');
    expect(cam.viewUrl).toBe('https://cameras.alertcalifornia.org/cam/colby-2');
    expect(cam.license).toContain('UC San Diego');
    expect(cam.isLive).toBe(true);
  });

  it('drops an absent observedAt (exactOptionalPropertyTypes) and keeps a present one', () => {
    expect('observedAt' in makeCameraFeed(base)).toBe(false);
    const stamped = makeCameraFeed({ ...base, observedAt: '2026-07-05T22:00:00Z' });
    expect(stamped.observedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('accepts every declared camera kind', () => {
    for (const kind of CAMERA_FEED_KINDS) {
      expect(makeCameraFeed({ ...base, kind }).kind).toBe(kind);
    }
  });

  it('accepts an isLive=false snapshot camera', () => {
    expect(makeCameraFeed({ ...base, isLive: false }).isLive).toBe(false);
  });

  // ── the https-only href-injection guard (the security-critical invariant) ──
  it('rejects an http:// viewUrl (must be https)', () => {
    expect(() => makeCameraFeed({ ...base, viewUrl: 'http://cameras.example.org/cam/1' })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a javascript: viewUrl (script-injection href)', () => {
    expect(() => makeCameraFeed({ ...base, viewUrl: 'javascript:alert(1)' })).toThrow(InvariantViolation);
  });

  it('rejects a data: viewUrl', () => {
    expect(() =>
      makeCameraFeed({ ...base, viewUrl: 'data:text/html,<script>alert(1)</script>' }),
    ).toThrow(InvariantViolation);
  });

  it('rejects a mailto: viewUrl', () => {
    expect(() => makeCameraFeed({ ...base, viewUrl: 'mailto:ops@example.org' })).toThrow(InvariantViolation);
  });

  it('rejects an unparseable / relative viewUrl', () => {
    expect(() => makeCameraFeed({ ...base, viewUrl: 'not a url' })).toThrow(InvariantViolation);
    expect(() => makeCameraFeed({ ...base, viewUrl: '/relative/path' })).toThrow(InvariantViolation);
  });

  it('rejects an empty viewUrl', () => {
    expect(() => makeCameraFeed({ ...base, viewUrl: '' })).toThrow(InvariantViolation);
  });

  // ── F-153: the guard IS the shared link policy, not a private https check ────────────────────────────
  // The private `isHttpsUrl` this factory used to declare accepted both of the URLs below (they really are
  // absolute `https:` URLs). They are rejected now only because the invariant is `assertLinkOnlyUrl` from
  // @/domain/shared/link-policy — so these two cases are the observable proof of the convergence.
  it('F-153 rejects an IP-LITERAL host (SSRF / cloud-metadata pivot) — v4 dotted-quad and bracketed v6', () => {
    expect(() => makeCameraFeed({ ...base, viewUrl: 'https://169.254.169.254/cam/1' })).toThrow(InvariantViolation);
    expect(() => makeCameraFeed({ ...base, viewUrl: 'https://127.0.0.1/cam/1' })).toThrow(InvariantViolation);
    expect(() => makeCameraFeed({ ...base, viewUrl: 'https://[::1]/cam/1' })).toThrow(InvariantViolation);
  });

  it('F-153 rejects a viewUrl over the shared LINK_POLICY_MAX_LENGTH cap, and accepts one exactly at it', () => {
    const prefix = 'https://cameras.alertcalifornia.org/';
    const atCap = prefix + 'a'.repeat(LINK_POLICY_MAX_LENGTH - prefix.length);
    expect(atCap).toHaveLength(LINK_POLICY_MAX_LENGTH);
    expect(makeCameraFeed({ ...base, viewUrl: atCap }).viewUrl).toBe(atCap);
    expect(() => makeCameraFeed({ ...base, viewUrl: `${atCap}a` })).toThrow(InvariantViolation);
  });

  // ── the remaining structural invariants ──
  it('rejects an empty or whitespace id', () => {
    expect(() => makeCameraFeed({ ...base, id: asId<CameraFeedId>('') })).toThrow(InvariantViolation);
    expect(() => makeCameraFeed({ ...base, id: asId<CameraFeedId>('   ') })).toThrow(InvariantViolation);
  });

  it('rejects an empty title', () => {
    expect(() => makeCameraFeed({ ...base, title: '' })).toThrow(InvariantViolation);
  });

  it('rejects an empty provider', () => {
    expect(() => makeCameraFeed({ ...base, provider: '  ' })).toThrow(InvariantViolation);
  });

  it('rejects an empty license (attribution is mandatory)', () => {
    expect(() => makeCameraFeed({ ...base, license: '' })).toThrow(InvariantViolation);
  });

  it('rejects an invalid kind', () => {
    expect(() =>
      makeCameraFeed({ ...base, kind: 'DRONE' as unknown as MakeCameraFeedInput['kind'] }),
    ).toThrow(InvariantViolation);
  });

  it('rejects a non-boolean isLive', () => {
    expect(() =>
      makeCameraFeed({ ...base, isLive: 'yes' as unknown as boolean }),
    ).toThrow(InvariantViolation);
  });

  // ── position invariants (finite, in WGS84 range, well-formed) ──
  it('rejects a longitude out of [-180,180]', () => {
    expect(() => makeCameraFeed({ ...base, position: [181, 39.76] })).toThrow(InvariantViolation);
    expect(() => makeCameraFeed({ ...base, position: [-181, 39.76] })).toThrow(InvariantViolation);
  });

  it('rejects a latitude out of [-90,90]', () => {
    expect(() => makeCameraFeed({ ...base, position: [-121.62, 91] })).toThrow(InvariantViolation);
    expect(() => makeCameraFeed({ ...base, position: [-121.62, -91] })).toThrow(InvariantViolation);
  });

  it('rejects a non-finite coordinate', () => {
    expect(() => makeCameraFeed({ ...base, position: [Number.POSITIVE_INFINITY, 39.76] })).toThrow(
      InvariantViolation,
    );
    expect(() => makeCameraFeed({ ...base, position: [-121.62, Number.NaN] })).toThrow(InvariantViolation);
  });

  it('rejects a malformed position (not a 2-tuple)', () => {
    expect(() =>
      makeCameraFeed({ ...base, position: [-121.62] as unknown as MakeCameraFeedInput['position'] }),
    ).toThrow(InvariantViolation);
  });
});
