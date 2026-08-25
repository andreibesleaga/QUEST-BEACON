// BEACON — Caltrans CCTV ACL tests. Real-fixture parse count (12 recorded rows: 10 Butte-County streaming
// cameras + 1 no-stream-but-in-service + 1 out-of-service), mapping correctness (https guard, isLive
// semantics per view-url source), and the lenient-drop paths (out-of-service, no usable https view-link,
// unparseable position, missing id/title) — each SKIPPED and COUNTED, never silently vanished (Art. XII).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { caltransCctvMapper, parseCaltransCameras, CALTRANS_CCTV_LICENSE, CALTRANS_CCTV_PROVIDER } from './caltrans-cctv-acl.js';
import type { CaltransCameraRow } from './caltrans-cctv-acl.js';
import type { LinkOnlyUrl } from '@/domain/shared/link-policy.js';
import { LINK_POLICY_MAX_LENGTH, assertLinkOnlyUrl } from '@/domain/shared/link-policy.js';

const FIXTURES_DIR = fileURLToPath(new URL('./__fixtures__', import.meta.url));
const REAL_FIXTURE = readFileSync(join(FIXTURES_DIR, 'cameras.json'), 'utf8');
const CTX = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-caltrans-cctv' };

interface RawDocOpts {
  readonly index?: string | number | null;
  readonly inService?: string | boolean | null;
  readonly locationName?: string | null;
  readonly nearbyPlace?: string | null;
  readonly longitude?: string | number | null;
  readonly latitude?: string | number | null;
  readonly streamingVideoURL?: string | null;
  readonly currentImageURL?: string | null;
  readonly district?: string | null;
}

// A well-formed baseline row (real fixture's index-117 camera) — each test overrides only the field(s) it
// exercises, keeping `buildRawDoc` itself branch-free (a plain merge, not a chain of per-field defaults).
const DEFAULT_OPTS: Required<RawDocOpts> = {
  index: '117',
  inService: 'true',
  locationName: 'Hwy 32 at Main St Chico',
  nearbyPlace: 'Chico',
  longitude: '-121.834856',
  latitude: '39.725615',
  streamingVideoURL: 'https://wzmedia.dot.ca.gov/D3/32_Main_St_Chico_BUT32_EB.stream/playlist.m3u8',
  currentImageURL: 'https://cwwp2.dot.ca.gov/data/d3/cctv/image/hwy32atmainstchico/hwy32atmainstchico.jpg',
  district: '3',
};

function row(overrides: RawDocOpts = {}): string {
  return JSON.stringify(buildRawDoc({ ...DEFAULT_OPTS, ...overrides }));
}

function buildRawDoc(opts: Required<RawDocOpts>): { data: unknown[] } {
  const { index, inService, locationName, nearbyPlace, longitude, latitude, streamingVideoURL, currentImageURL, district } = opts;
  return {
    data: [
      {
        cctv: {
          index,
          location: { district, locationName, nearbyPlace, longitude, latitude, county: 'Butte', route: 'SR-32', direction: 'West' },
          inService,
          imageData: { streamingVideoURL, static: { currentImageURL } },
        },
      },
    ],
  };
}

describe('parseCaltransCameras — real recorded fixture (2026-07-17, District 3)', () => {
  it('parses 11 usable rows and skips the 1 out-of-service row (12 recorded cameras total)', () => {
    const { rows, skipped } = parseCaltransCameras(REAL_FIXTURE);
    expect(rows).toHaveLength(11);
    expect(skipped).toBe(1);
  });

  it('maps the streaming Butte-County cameras with isLive=true (streamingVideoURL wins)', () => {
    const { rows } = parseCaltransCameras(REAL_FIXTURE);
    const streaming = rows.filter((r) => r.isLive);
    expect(streaming).toHaveLength(10);
    expect(streaming.every((r) => r.viewUrl.includes('.stream/playlist.m3u8'))).toBe(true);
    expect(streaming.every((r) => r.viewUrl.startsWith('https://'))).toBe(true);
  });

  it('maps the no-stream-but-in-service camera with isLive=false and viewUrl=currentImageURL', () => {
    const { rows } = parseCaltransCameras(REAL_FIXTURE);
    const snapshot = rows.find((r) => r.id.includes(':130'));
    expect(snapshot).toBeDefined();
    expect(snapshot?.isLive).toBe(false);
    expect(snapshot?.viewUrl).toBe('https://cwwp2.dot.ca.gov/data/d3/cctv/image/hwy5attwincities/hwy5attwincities.jpg');
  });

  it('drops the out-of-service camera (index 147, Hwy 70 at Feather River) entirely', () => {
    const { rows } = parseCaltransCameras(REAL_FIXTURE);
    expect(rows.some((r) => r.id.includes(':147'))).toBe(false);
  });

  it('gives every row a stable, district-scoped id', () => {
    const { rows } = parseCaltransCameras(REAL_FIXTURE);
    expect(rows[0]?.id).toMatch(/^caltrans-cctv:3:\d+$/);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
});

describe('parseCaltransCameras — lenient drop paths (synthetic rows)', () => {
  it('drops a row with inService="false"', () => {
    const { rows, skipped } = parseCaltransCameras(row({ inService: 'false' }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('drops a row with inService missing (treated as not-in-service, the safe default)', () => {
    const { rows, skipped } = parseCaltransCameras(row({ inService: null }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('drops a row whose only URLs are non-https (http streamingVideoURL AND currentImageURL)', () => {
    const { rows, skipped } = parseCaltransCameras(
      row({ streamingVideoURL: 'http://insecure.example/stream.m3u8', currentImageURL: 'http://insecure.example/still.jpg' }),
    );
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('falls back to currentImageURL (isLive=false) when streamingVideoURL is non-https but currentImageURL is https', () => {
    const { rows } = parseCaltransCameras(row({ streamingVideoURL: 'http://insecure.example/stream.m3u8' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isLive).toBe(false);
    expect(rows[0]?.viewUrl.startsWith('https://')).toBe(true);
  });

  // ── F-153: this ACL enforces the SHARED link policy, not a private https check ───────────────────────
  // These two cases are the PROOF of convergence: both are `https:` URLs that `new URL(x).protocol ===
  // 'https:'` — the private predicate this file used to carry — would have ACCEPTED. They are rejected now
  // only because the drop decision is made by @/domain/shared/link-policy. Revert the import and they pass.
  it('F-153 DROPS a row whose only https URLs have IP-LITERAL hosts (SSRF/cloud-metadata pivot)', () => {
    const { rows, skipped } = parseCaltransCameras(
      row({ streamingVideoURL: 'https://169.254.169.254/stream.m3u8', currentImageURL: 'https://10.0.0.5/still.jpg' }),
    );
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('F-153 DROPS a row whose only URL exceeds the shared LINK_POLICY_MAX_LENGTH cap', () => {
    const tooLong = `https://cwwp2.dot.ca.gov/${'a'.repeat(LINK_POLICY_MAX_LENGTH)}.jpg`;
    expect(tooLong.length).toBeGreaterThan(LINK_POLICY_MAX_LENGTH);
    const { rows, skipped } = parseCaltransCameras(row({ streamingVideoURL: tooLong, currentImageURL: tooLong }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('drops a row with neither streamingVideoURL nor currentImageURL', () => {
    const { rows, skipped } = parseCaltransCameras(row({ streamingVideoURL: '', currentImageURL: '' }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('drops a row with an unparseable (non-numeric) longitude/latitude', () => {
    const { rows, skipped } = parseCaltransCameras(row({ longitude: 'not-a-number', latitude: '39.7' }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('drops a row with an out-of-range latitude', () => {
    const { rows, skipped } = parseCaltransCameras(row({ latitude: '95.0' }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('drops a row with a missing/blank locationName (cannot build a title)', () => {
    const { rows, skipped } = parseCaltransCameras(row({ locationName: '' }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('drops a row with a missing/blank index (cannot build a stable id)', () => {
    const { rows, skipped } = parseCaltransCameras(row({ index: '' }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('builds the title from locationName + nearbyPlace when both present', () => {
    const { rows } = parseCaltransCameras(row({}));
    expect(rows[0]?.title).toBe('Hwy 32 at Main St Chico (Chico)');
  });

  it('falls back to bare locationName when nearbyPlace is blank', () => {
    const { rows } = parseCaltransCameras(row({ nearbyPlace: '' }));
    expect(rows[0]?.title).toBe('Hwy 32 at Main St Chico');
  });

  it('returns nothing when there are no data rows', () => {
    expect(parseCaltransCameras(JSON.stringify({}))).toEqual({ rows: [], skipped: 0 });
  });

  it('skips a row whose cctv element is missing', () => {
    const { rows, skipped } = parseCaltransCameras(JSON.stringify({ data: [{}] }));
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

/** F-153: `CaltransCameraRow.viewUrl` is the branded `LinkOnlyUrl`, so even a hand-written test row must go
 *  through the SHARED policy to exist — a fixture link that violated it would throw right here. This is the
 *  only sanctioned way to mint one outside the parser (the `asId` idiom), and it is deliberately greppable. */
function link(raw: string): LinkOnlyUrl {
  assertLinkOnlyUrl(raw, 'test fixture link');
  return raw;
}

describe('caltransCctvMapper.toCanonical', () => {
  const ROW: CaltransCameraRow = {
    id: 'caltrans-cctv:3:117',
    title: 'Hwy 32 at Main St Chico (Chico)',
    position: [-121.834856, 39.725615],
    viewUrl: link('https://wzmedia.dot.ca.gov/D3/32_Main_St_Chico_BUT32_EB.stream/playlist.m3u8'),
    isLive: true,
  };

  it('maps a row to a CameraFeed with kind TRAFFIC_CCTV, provider Caltrans and the manifest license', () => {
    const feed = caltransCctvMapper.toCanonical(ROW, CTX);
    expect(feed.id).toBe('caltrans-cctv:3:117');
    expect(feed.kind).toBe('TRAFFIC_CCTV');
    expect(feed.provider).toBe(CALTRANS_CCTV_PROVIDER);
    expect(feed.license).toBe(CALTRANS_CCTV_LICENSE);
    expect(feed.viewUrl).toBe(ROW.viewUrl);
    expect(feed.isLive).toBe(true);
    expect(feed.position).toEqual([-121.834856, 39.725615]);
  });

  it('maps a snapshot (isLive=false) row honestly', () => {
    const feed = caltransCctvMapper.toCanonical({ ...ROW, isLive: false, viewUrl: link('https://cwwp2.dot.ca.gov/still.jpg') }, CTX);
    expect(feed.isLive).toBe(false);
    expect(feed.viewUrl).toBe('https://cwwp2.dot.ca.gov/still.jpg');
  });
});
