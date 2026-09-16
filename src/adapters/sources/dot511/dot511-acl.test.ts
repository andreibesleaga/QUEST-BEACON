// BEACON — 511 DOT ACL tests (E11 "Live Views" · CW1; adapter-contract §4, CameraDirectoryPort P16). The
// schema-crafted fixture (see cameras.json header in dot511-adapter.ts) round-trips to valid CameraFeed
// DTOs ([lon,lat] positions, https-only viewUrl, kind TRAFFIC_CCTV); drop-worthy cameras (no Views, every
// view disabled, every view non-https) are SKIPPED and COUNTED at parse time (never silently dropped,
// never fail the whole batch); a malformed camera handed directly to the mapper still raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { dot511Mapper, parseDot511Cameras, DOT511_PROVIDER, DOT511_LICENSE } from './dot511-acl.js';
import { LINK_POLICY_MAX_LENGTH } from '@/domain/shared/link-policy.js';

// Schema-crafted from the documented 511 `get/cameras` (format=json) response shape (LIVE_VIEWS_FEATURE_PLAN
// §3.3) — NOT a captured live response. A keyless `curl -sS
// 'https://511ga.org/api/v2/get/cameras?format=json'` returned HTTP 400 `Invalid Key` (2026-07-17
// evidence), confirming the developer-key requirement; no key was available in this environment, so the
// fixture is hand-authored from the documented schema. 10 GA-area cameras: 7 valid (enabled https view), 1
// with no Views at all, 1 with only a Disabled view, 1 with only a non-https (http://) view.
const fixtureText = readFileSync(
  fileURLToPath(new URL('./__fixtures__/cameras.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseDot511Cameras', () => {
  it('parses the 7 usable fixture cameras, skipping+counting the 3 drop-worthy ones', () => {
    const { rows, skipped } = parseDot511Cameras(fixtureText);
    expect(rows).toHaveLength(7);
    expect(skipped).toBe(3);
    expect(rows[0]?.Id).toBe(1001);
    expect(rows[0]?.Latitude).toBe(33.7756);
    expect(rows[0]?.Longitude).toBe(-84.3963);
  });

  it('drops a camera with an empty Views array', () => {
    const { rows } = parseDot511Cameras(fixtureText);
    expect(rows.some((r) => r.Id === 1008)).toBe(false);
  });

  it('drops a camera whose only view is Disabled', () => {
    const { rows } = parseDot511Cameras(fixtureText);
    expect(rows.some((r) => r.Id === 1009)).toBe(false);
  });

  it('drops a camera whose only view is non-https (http://)', () => {
    const { rows } = parseDot511Cameras(fixtureText);
    expect(rows.some((r) => r.Id === 1010)).toBe(false);
  });

  it('returns rows: [] when the body is not an array', () => {
    expect(parseDot511Cameras('{}')).toEqual({ rows: [], skipped: 0 });
  });

  it('skips and counts structurally malformed cameras without dropping the well-formed ones', () => {
    const text = JSON.stringify([
      {
        Id: 1,
        Latitude: 33.7,
        Longitude: -84.4,
        Views: [{ Url: 'https://511ga.org/map/Cctv/1', Status: 'Enabled' }],
      }, // ok
      { Id: 2, Latitude: null, Longitude: -84.4, Views: [{ Url: 'https://x', Status: 'Enabled' }] }, // no lat
      {
        Id: 3,
        Latitude: 33.7,
        Longitude: 'not-a-number',
        Views: [{ Url: 'https://x', Status: 'Enabled' }],
      }, // bad lon
      { Latitude: 33.7, Longitude: -84.4, Views: [{ Url: 'https://x', Status: 'Enabled' }] }, // no id at all
      'not-an-object',
      null,
    ]);
    const { rows, skipped } = parseDot511Cameras(text);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(5);
  });
});

describe('dot511Mapper.toCanonical (golden round-trip)', () => {
  it('maps every usable fixture camera to a valid CameraFeed with [lon,lat] position and https viewUrl', () => {
    const { rows } = parseDot511Cameras(fixtureText);
    const cameras = rows.map((r) => dot511Mapper.toCanonical(r, ctx));
    expect(cameras).toHaveLength(7);
    for (const c of cameras) {
      expect(c.kind).toBe('TRAFFIC_CCTV');
      expect(c.isLive).toBe(true);
      expect(c.provider).toBe(DOT511_PROVIDER);
      expect(c.license).toBe(DOT511_LICENSE);
      expect(new URL(c.viewUrl).protocol).toBe('https:');
      expect(c.observedAt).toBe('2026-07-05T22:00:00Z');
    }
    const first = cameras[0];
    expect(first?.position).toEqual([-84.3963, 33.7756]); // [lon,lat] — reversed from raw Latitude/Longitude
    expect(first?.title).toBe('I-75 NB at Downtown Connector');
    expect(first?.viewUrl).toBe('https://511ga.org/map/Cctv/1001');
    expect(first?.id).toBe('dot511-1001');
  });

  it('picks the first enabled+https view when a camera has multiple views', () => {
    const raw = {
      Id: 42,
      Latitude: 33.5,
      Longitude: -84.5,
      Location: 'Multi-view camera',
      Views: [
        { Url: 'http://insecure.example/1', Status: 'Enabled' }, // non-https: skipped
        { Url: 'https://511ga.org/map/Cctv/42a', Status: 'Disabled' }, // disabled: skipped
        { Url: 'https://511ga.org/map/Cctv/42b', Status: 'Enabled' }, // first usable
        { Url: 'https://511ga.org/map/Cctv/42c', Status: 'Enabled' },
      ],
    };
    const camera = dot511Mapper.toCanonical(raw, ctx);
    expect(camera.viewUrl).toBe('https://511ga.org/map/Cctv/42b');
  });

  // F-153 convergence proof: an Enabled view whose Url is an https IP LITERAL, or over the shared length
  // cap, is NOT usable. The private `new URL(x).protocol === 'https:'` this ACL used to carry accepted both;
  // they are refused now only because view selection defers to @/domain/shared/link-policy.
  it('F-153 does NOT treat an Enabled IP-LITERAL view as usable (SSRF/cloud-metadata pivot)', () => {
    const raw = {
      Id: 77,
      Latitude: 33.5,
      Longitude: -84.5,
      Views: [
        { Url: 'https://169.254.169.254/latest/meta-data/', Status: 'Enabled' }, // IP literal: NOT usable
        { Url: 'https://511ga.org/map/Cctv/77', Status: 'Enabled' }, // first genuinely usable view
      ],
    };
    expect(dot511Mapper.toCanonical(raw, ctx).viewUrl).toBe('https://511ga.org/map/Cctv/77');
    // …and a camera whose ONLY view is the IP literal is dropped+counted at parse time, not pinned.
    expect(parseDot511Cameras(JSON.stringify([{ ...raw, Views: [raw.Views[0]] }]))).toEqual({
      rows: [],
      skipped: 1,
    });
  });

  it('F-153 does NOT treat an Enabled over-long view Url as usable (shared LINK_POLICY_MAX_LENGTH cap)', () => {
    const tooLong = `https://511ga.org/map/Cctv/${'a'.repeat(LINK_POLICY_MAX_LENGTH)}`;
    const raw = {
      Id: 78,
      Latitude: 33.5,
      Longitude: -84.5,
      Views: [{ Url: tooLong, Status: 'Enabled' }],
    };
    expect(parseDot511Cameras(JSON.stringify([raw]))).toEqual({ rows: [], skipped: 1 });
  });

  it('falls back to Roadway+Direction, then a generic title, when Location is absent', () => {
    const view = { Url: 'https://511ga.org/map/Cctv/99', Status: 'Enabled' };
    const withRoadway = dot511Mapper.toCanonical(
      {
        Id: 99,
        Latitude: 33.1,
        Longitude: -84.1,
        Roadway: 'I-75',
        Direction: 'Northbound',
        Views: [view],
      },
      ctx,
    );
    expect(withRoadway.title).toBe('I-75 Northbound');

    const generic = dot511Mapper.toCanonical(
      { Id: 100, Latitude: 33.1, Longitude: -84.1, Views: [view] },
      ctx,
    );
    expect(generic.title).toBe('511 Camera 100');
  });

  it('raises a typed PARSE when Latitude/Longitude is missing', () => {
    try {
      dot511Mapper.toCanonical({ Id: 1, Views: [{ Url: 'https://x', Status: 'Enabled' }] }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE on a non-finite Latitude/Longitude', () => {
    try {
      dot511Mapper.toCanonical(
        {
          Id: 1,
          Latitude: 'NaN',
          Longitude: -84.4,
          Views: [{ Url: 'https://x', Status: 'Enabled' }],
        },
        ctx,
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE when handed directly a camera with no usable view', () => {
    try {
      dot511Mapper.toCanonical({ Id: 1, Latitude: 33.7, Longitude: -84.4, Views: [] }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
