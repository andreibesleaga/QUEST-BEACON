// BEACON — CNADNR-RO ACL tests (CameraDirectoryPort P16; adapter-contract §4). The curated fixture rows
// round-trip to valid CameraFeed entities (TRAFFIC_CCTV, link-only viewUrl, honest provider/license); a
// malformed row raises a typed PARSE (never silently dropped).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import { cnadnrRoMapper, parseCnadnrRows } from './cnadnr-ro-acl.js';
import type { CnadnrCameraRow } from './cnadnr-ro-acl.js';
import { LINK_POLICY_MAX_LENGTH } from '@/domain/shared/link-policy.js';

const json = readFileSync(fileURLToPath(new URL('./__fixtures__/cameras.json', import.meta.url)), 'utf8');
const CTX = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseCnadnrRows', () => {
  it('parses the curated fixture cameras array', () => {
    const rows = parseCnadnrRows(json);
    expect(rows.length).toBe(5);
    expect(rows[0]?.id).toBe('fetesti-a2-camera-1');
  });

  it('returns [] when the document has no cameras array', () => {
    expect(parseCnadnrRows('{}')).toEqual([]);
  });
});

describe('cnadnrRoMapper.toCanonical (golden round-trip)', () => {
  it('maps every curated row to a TRAFFIC_CCTV CameraFeed with honest link-only attribution', () => {
    const rows = parseCnadnrRows(json);
    const cameras = rows.map((r) => cnadnrRoMapper.toCanonical(r, CTX));
    expect(cameras).toHaveLength(5);
    for (const c of cameras) {
      expect(c.kind).toBe('TRAFFIC_CCTV');
      expect(c.provider).toBe('CNAIR (cnadnr.ro)');
      expect(c.license).toBe('Official public agency pages (link-only)');
      expect(c.isLive).toBe(true);
      expect(c.viewUrl.startsWith('https://www.cnadnr.ro/ro/trafic-live/')).toBe(true);
      expect(c.observedAt).toBe(CTX.fetchedAt);
    }
    expect(cameras[0]).toMatchObject({
      id: 'fetesti-a2-camera-1',
      title: 'Fetesti: Bucuresti-Constanta (Camera 1)',
      position: [27.83, 44.38],
      viewUrl: 'https://www.cnadnr.ro/ro/trafic-live/fetesti-bucuresti-constanta-camera-1',
    });
    const giurgiu = cameras.find((c) => c.id === 'giurgiu-intrare');
    expect(giurgiu?.position).toEqual([25.97, 43.9]);
  });

  it('raises a typed PARSE on a row with a missing/invalid href', () => {
    const bad: CnadnrCameraRow = { id: 'x', title: 'X', lat: 44, lon: 27 };
    try {
      cnadnrRoMapper.toCanonical(bad, CTX);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  // F-153: this ACL's href rule is a HOST ALLOW-LIST — strictly stronger than the shared link policy, so it
  // was NOT replaced by it (that would have loosened a security check into "any named https host"). The
  // shared policy was added ON TOP. These two tests pin both halves: the allow-list still bites…
  it('raises a typed PARSE on a row whose href is not a cnadnr.ro url', () => {
    const bad: CnadnrCameraRow = { id: 'x', title: 'X', href: 'https://evil.example/x', lat: 44, lon: 27 };
    expect(() => cnadnrRoMapper.toCanonical(bad, CTX)).toThrow();
  });

  // …and the shared policy now bites too, on an over-long link the prefix check alone would have waved past.
  it('F-153 raises a typed PARSE on an over-long cnadnr.ro href (the shared link policy, applied on top)', () => {
    const bad: CnadnrCameraRow = {
      id: 'x',
      title: 'X',
      href: `https://www.cnadnr.ro/ro/trafic-live/${'a'.repeat(LINK_POLICY_MAX_LENGTH)}`,
      lat: 44,
      lon: 27,
    };
    try {
      cnadnrRoMapper.toCanonical(bad, CTX);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE on a row with a missing title', () => {
    const bad: CnadnrCameraRow = {
      id: 'x',
      href: 'https://www.cnadnr.ro/ro/trafic-live/x',
      lat: 44,
      lon: 27,
    };
    expect(() => cnadnrRoMapper.toCanonical(bad, CTX)).toThrow();
  });

  it('raises a typed PARSE on a row with a non-finite coordinate', () => {
    const bad: CnadnrCameraRow = {
      id: 'x',
      title: 'X',
      href: 'https://www.cnadnr.ro/ro/trafic-live/x',
      lat: Number.NaN,
      lon: 27,
    };
    try {
      cnadnrRoMapper.toCanonical(bad, CTX);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
