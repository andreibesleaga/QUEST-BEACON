// BEACON — Windy Webcams ACL tests (E11 "Live Views" · CW1 windy-webcams lane; ADR-027, FR-CAM-1/2/3).
// The schema-crafted fixture (see __fixtures__/webcams.json header) round-trips to valid CameraFeed
// entities (kind WEBCAM, provider windy.com, mandatory attribution license, https-only viewUrl);
// structurally malformed webcams (missing/invalid id or lat/lon) are SKIPPED and COUNTED at parse time
// (never silently dropped, never fail the whole batch); a malformed row handed directly to the mapper
// still raises a typed PARSE; an inactive webcam maps with isLive:false (kept, not dropped — an inactive
// Windy webcam still has a valid last-image view page, so linking out remains useful; Art. XVI —
// honest-degrade, never a dead layer); a Romania webcam maps identically to a US-CA one (coverage GLOBAL).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { parseWindyWebcams, windyWebcamsMapper } from './windy-webcams-acl.js';
import { LINK_POLICY_MAX_LENGTH } from '@/domain/shared/link-policy.js';

// Schema-crafted from the documented Windy Webcams API v3 `GET /webcams/api/v3/webcams` response shape
// (verified 2026-07-17) — NOT a captured live response (keyed API; no key used in tests). See the fixture
// file's `_provenance` header for full citation detail. 8 webcams: 5 US-CA + 3 Romania, one inactive.
const fixtureText = readFileSync(
  fileURLToPath(new URL('./__fixtures__/webcams.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseWindyWebcams', () => {
  it('parses the 8 well-formed fixture webcams with zero skipped', () => {
    const { rows, skipped } = parseWindyWebcams(fixtureText);
    expect(rows).toHaveLength(8);
    expect(skipped).toBe(0);
    expect(rows[0]?.webcamId).toBe(1358084658);
    expect(rows[0]?.location?.latitude).toBe(37.8199);
    expect(rows[0]?.location?.longitude).toBe(-122.4783);
  });

  it('returns rows: [] when there is no webcams array', () => {
    expect(parseWindyWebcams('{}')).toEqual({ rows: [], skipped: 0 });
  });

  it('skips and counts structurally malformed webcams without dropping the well-formed ones', () => {
    const text = JSON.stringify({
      webcams: [
        { webcamId: 1, title: 'A', status: 'active', location: { latitude: 44.4, longitude: 26.1 } }, // ok
        { webcamId: 2, title: 'B', status: 'active', location: { latitude: 45.6, longitude: 25.5 } }, // ok
        { webcamId: 3, title: 'C', status: 'active', location: { latitude: null, longitude: 26.1 } }, // malformed: no lat
        { webcamId: 4, title: 'D', status: 'active', location: { latitude: 44.4, longitude: 'nope' } }, // malformed: bad lon
        { webcamId: 5, title: 'E', status: 'active' }, // malformed: no location at all
        { title: 'F', status: 'active', location: { latitude: 44.4, longitude: 26.1 } }, // malformed: no webcamId
        'not-an-object', // malformed
        null, // malformed
      ],
    });
    const { rows, skipped } = parseWindyWebcams(text);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(6);
  });
});

describe('windyWebcamsMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture webcam to a valid CameraFeed (kind WEBCAM, https viewUrl, attribution license)', () => {
    const { rows } = parseWindyWebcams(fixtureText);
    const feeds = rows.map((r) => windyWebcamsMapper.toCanonical(r, ctx));
    expect(feeds).toHaveLength(8);
    for (const f of feeds) {
      expect(f.kind).toBe('WEBCAM');
      expect(f.provider).toBe('windy.com');
      expect(f.license).toBe('Windy Webcams API ToS (link-only; attribution required)');
      expect(f.viewUrl.startsWith('https://')).toBe(true);
      expect(f.position).toHaveLength(2);
    }
  });

  it('maps the Golden Gate webcam with the id/position/viewUrl/title/isLive it carries', () => {
    const { rows } = parseWindyWebcams(fixtureText);
    const golden = rows.find((r) => r.webcamId === 1358084658);
    expect(golden).toBeDefined();
    const feed = windyWebcamsMapper.toCanonical(golden!, ctx);
    expect(feed.id).toBe('windy:1358084658');
    expect(feed.position).toEqual([-122.4783, 37.8199]); // [lon,lat]
    expect(feed.title).toBe('Golden Gate Bridge View');
    expect(feed.viewUrl).toBe('https://www.windy.com/webcams/1358084658');
    expect(feed.isLive).toBe(true);
    expect(feed.observedAt).toBe('2026-07-05T21:40:00.000Z');
  });

  it('maps an inactive webcam with isLive:false rather than dropping it (honest-degrade, Art. XVI)', () => {
    const { rows } = parseWindyWebcams(fixtureText);
    const tahoe = rows.find((r) => r.webcamId === 1400000003);
    expect(tahoe).toBeDefined();
    expect(tahoe?.status).toBe('inactive');
    const feed = windyWebcamsMapper.toCanonical(tahoe!, ctx);
    expect(feed.isLive).toBe(false);
    expect(feed.viewUrl).toBe('https://www.windy.com/webcams/1400000003'); // still a valid link-out target
  });

  it('maps a Romania webcam identically to a US-CA one (coverage is source-global)', () => {
    const { rows } = parseWindyWebcams(fixtureText);
    const bucharest = rows.find((r) => r.webcamId === 1400000005);
    expect(bucharest).toBeDefined();
    const feed = windyWebcamsMapper.toCanonical(bucharest!, ctx);
    expect(feed.position).toEqual([26.1039, 44.4325]);
    expect(feed.title).toBe('Bucharest Old Town Square');
    expect(feed.kind).toBe('WEBCAM');
    expect(feed.isLive).toBe(true);
  });

  it('constructs the windy.com detail URL from the id when urls.detail is absent (documented pattern)', () => {
    const feed = windyWebcamsMapper.toCanonical(
      { webcamId: 999, title: 'No-URL Cam', status: 'active', location: { latitude: 10, longitude: 20 } },
      ctx,
    );
    expect(feed.viewUrl).toBe('https://www.windy.com/webcams/999');
  });

  it('falls back to the constructed detail URL when urls.detail is not a parseable URL at all', () => {
    const feed = windyWebcamsMapper.toCanonical(
      {
        webcamId: 1003,
        title: 'Unparseable-URL Cam',
        status: 'active',
        location: { latitude: 10, longitude: 20 },
        urls: { detail: 'not-a-valid-url-at-all' },
      },
      ctx,
    );
    expect(feed.viewUrl).toBe('https://www.windy.com/webcams/1003');
  });

  it('falls back to the constructed detail URL when urls.detail is present but not https', () => {
    const feed = windyWebcamsMapper.toCanonical(
      {
        webcamId: 1000,
        title: 'Bad-URL Cam',
        status: 'active',
        location: { latitude: 10, longitude: 20 },
        urls: { detail: 'http://www.windy.com/webcams/1000' },
      },
      ctx,
    );
    expect(feed.viewUrl).toBe('https://www.windy.com/webcams/1000');
  });

  // F-153 convergence proof: an upstream `urls.detail` that is an https URL to an IP LITERAL, or one over
  // the shared length cap, is REFUSED and the safe windy.com pattern is used instead. The private
  // `new URL(x).protocol === 'https:'` predicate this ACL used to carry would have echoed both straight into
  // the COP's href — these cases pass only because the check is now @/domain/shared/link-policy.
  it('F-153 refuses an IP-LITERAL urls.detail and falls back to the constructed windy.com URL', () => {
    const feed = windyWebcamsMapper.toCanonical(
      {
        webcamId: 1004,
        title: 'SSRF-bait Cam',
        status: 'active',
        location: { latitude: 10, longitude: 20 },
        urls: { detail: 'https://169.254.169.254/latest/meta-data/' },
      },
      ctx,
    );
    expect(feed.viewUrl).toBe('https://www.windy.com/webcams/1004');
  });

  it('F-153 refuses a urls.detail over the shared LINK_POLICY_MAX_LENGTH cap and falls back', () => {
    const feed = windyWebcamsMapper.toCanonical(
      {
        webcamId: 1005,
        title: 'Over-long Cam',
        status: 'active',
        location: { latitude: 10, longitude: 20 },
        urls: { detail: `https://www.windy.com/webcams/${'a'.repeat(LINK_POLICY_MAX_LENGTH)}` },
      },
      ctx,
    );
    expect(feed.viewUrl).toBe('https://www.windy.com/webcams/1005');
  });

  it('falls back to a synthesized title when title is blank/missing (defensive; upstream should always supply one)', () => {
    const feed = windyWebcamsMapper.toCanonical(
      { webcamId: 1001, title: '  ', status: 'active', location: { latitude: 10, longitude: 20 } },
      ctx,
    );
    expect(feed.title).toBe('Windy webcam 1001');
  });

  it('falls back to ctx.fetchedAt for observedAt when lastUpdatedOn is absent', () => {
    const feed = windyWebcamsMapper.toCanonical(
      { webcamId: 1002, title: 'No-Timestamp Cam', status: 'active', location: { latitude: 10, longitude: 20 } },
      ctx,
    );
    expect(feed.observedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('raises a typed PARSE when lat/lon is missing', () => {
    try {
      windyWebcamsMapper.toCanonical({ webcamId: 1, title: 'X', status: 'active' }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE on a non-finite lat/lon', () => {
    try {
      windyWebcamsMapper.toCanonical(
        { webcamId: 1, title: 'X', status: 'active', location: { latitude: 'NaN', longitude: 20 } },
        ctx,
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE when webcamId is missing', () => {
    try {
      windyWebcamsMapper.toCanonical(
        { title: 'X', status: 'active', location: { latitude: 10, longitude: 20 } } as never,
        ctx,
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
