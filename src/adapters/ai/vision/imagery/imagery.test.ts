// BEACON — imagery-fetch tests (S2·Lane V; ADR-008a, Art. XIV/XVI). NO live network anywhere: every fetch is
// injected, so these run identically air-gapped and in CI (plan §1.6). What they pin is the set of ways an
// imagery fetch can lie to a vision model — an error document served as pixels, a truncated oversized image,
// an un-screened photo, a silent sensor substitution — and the honest behaviour in each case.
import { describe, expect, it } from 'vitest';
import {
  assertIsoDate,
  assertWithinSizeBudget,
  bboxToString,
  parseBbox,
  readImageResponse,
  toDataUri,
  type ImageryEnv,
} from './imagery-source.js';
import { GIBS_DEFAULT_LAYER, gibsImageRef, makeGibsFetcher, parseGibsRef } from './gibs.js';
import { makeCopernicusFetcher, parseCdseRef } from './copernicus.js';
import { makeFixtureImagery, parseFixtureId } from './fixture-imagery.js';
import { cdseToGibsRef, gibsLayerForTask, makeImageryResolver } from './resolver.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** A fetch stub that records the URLs it was asked for and replies from a scripted queue. */
function stubFetch(replies: readonly Response[]): {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  urls: string[];
  inits: (RequestInit | undefined)[];
} {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  let i = 0;
  return {
    urls,
    inits,
    fetchImpl: (url: string, init?: RequestInit): Promise<Response> => {
      urls.push(url);
      inits.push(init);
      const reply = replies[Math.min(i, replies.length - 1)];
      i += 1;
      return Promise.resolve(reply as Response);
    },
  };
}

function imageReply(bytes: Uint8Array = PNG, mediaType = 'image/png'): Response {
  return new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: { 'content-type': mediaType },
  });
}

const BASE_ENV: ImageryEnv = { VISION_MAX_IMAGE_MB: 8, VISION_PII_SCREEN: 'on' };

describe('imagery-source — the shared guards every fetcher inherits', () => {
  it('parses and re-serialises a lon/lat bbox', () => {
    const bbox = parseBbox('-122.2,39.2,-121.0,40.2');
    expect(bbox).toEqual({ minLon: -122.2, minLat: 39.2, maxLon: -121, maxLat: 40.2 });
    expect(bboxToString(bbox)).toBe('-122.2,39.2,-121,40.2');
  });

  it('rejects a bbox that is short, non-numeric, out of range, or inverted', () => {
    for (const raw of [
      '1,2,3',
      'a,b,c,d',
      '-200,39,-121,40',
      '-121,39,-122,40',
      '-122,41,-121,40',
    ]) {
      expect(() => parseBbox(raw)).toThrow();
    }
  });

  it('rejects a non-ISO acquisition date', () => {
    expect(assertIsoDate('2026-07-05', 'gibs:x')).toBe('2026-07-05');
    expect(() => assertIsoDate('05/07/2026', 'gibs:x')).toThrow(/non-ISO date/);
  });

  it('REFUSES an oversized image rather than truncating it (VISION_MAX_IMAGE_MB)', () => {
    const twoMb = new Uint8Array(2 * 1024 * 1024);
    expect(() => assertWithinSizeBudget(twoMb, 8, 'gibs:x')).not.toThrow();
    expect(() => assertWithinSizeBudget(twoMb, 1, 'gibs:x')).toThrow(
      /exceeds VISION_MAX_IMAGE_MB=1/,
    );
  });

  it('rejects a 200-OK response whose body is an error document, not an image', async () => {
    // GIBS answers a bad layer with HTTP 200 + application/vnd.ogc.se_xml (verified live 2026-08-08).
    const xml = new Response('<ServiceExceptionReport/>', {
      status: 200,
      headers: { 'content-type': 'application/vnd.ogc.se_xml' },
    });
    await expect(readImageResponse(xml, 'gibs:bad')).rejects.toThrow(/not an image/);
  });

  it('rejects a non-2xx response', async () => {
    await expect(readImageResponse(new Response('', { status: 503 }), 'gibs:x')).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it('encodes bytes as a data URI carrying the upstream media type', () => {
    expect(
      toDataUri({ imageRef: 'fixture:a', bytes: PNG, mediaType: 'image/png', attribution: 'x' }),
    ).toBe('data:image/png;base64,iVBORw==');
  });
});

describe('gibs — the keyless default imagery rung', () => {
  it('builds a WMS 1.1.1 GetMap for the requested layer, bbox and date', async () => {
    const stub = stubFetch([imageReply()]);
    const image = await makeGibsFetcher({ fetchImpl: stub.fetchImpl, pixels: 256 }).fetch(
      'gibs:MODIS_Terra_CorrectedReflectance_TrueColor:-122.2,39.2,-121,40.2:2026-07-05',
    );
    const url = stub.urls[0] ?? '';
    expect(url).toContain('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?');
    // VERSION 1.1.1 + SRS (not CRS) is the axis-order guarantee: 1.3.0 would flip EPSG:4326 to lat/lon and
    // silently return a real image of the wrong place.
    expect(url).toContain('VERSION=1.1.1');
    expect(url).toContain('SRS=EPSG%3A4326');
    expect(url).toContain('LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor');
    expect(url).toContain('BBOX=-122.2%2C39.2%2C-121%2C40.2');
    expect(url).toContain('TIME=2026-07-05');
    expect(url).toContain('WIDTH=256');
    expect(stub.inits[0]?.redirect).toBe('manual'); // SSRF hardening, mirroring http-client.ts
    expect(image.mediaType).toBe('image/png');
    expect(image.attribution).toMatch(/NASA EOSDIS GIBS/);
  });

  it('falls back to the fire false-colour default layer when the ref names none', () => {
    expect(parseGibsRef('gibs::-122.2,39.2,-121,40.2:2026-07-05', GIBS_DEFAULT_LAYER).layer).toBe(
      GIBS_DEFAULT_LAYER,
    );
  });

  it('rejects a malformed ref, a foreign scheme, and an injected layer id', () => {
    expect(() => parseGibsRef('gibs:layer:-1,-1,1,1', GIBS_DEFAULT_LAYER)).toThrow(/malformed/);
    expect(() => parseGibsRef('cdse:-1,-1,1,1:2026-07-05', GIBS_DEFAULT_LAYER)).toThrow(
      /not a gibs/,
    );
    // A layer id carrying URL syntax would smuggle extra GetMap parameters into the request.
    expect(() =>
      parseGibsRef('gibs:bad&FORMAT=text:-1,-1,1,1:2026-07-05', GIBS_DEFAULT_LAYER),
    ).toThrow(/invalid GIBS layer/);
  });

  it('builds a handle the UI can hand back (round-trip)', () => {
    const ref = gibsImageRef(
      { minLon: -122.2, minLat: 39.2, maxLon: -121, maxLat: 40.2 },
      '2026-07-05',
    );
    expect(ref).toBe('gibs::-122.2,39.2,-121,40.2:2026-07-05');
    expect(parseGibsRef(ref, GIBS_DEFAULT_LAYER).date).toBe('2026-07-05');
  });
});

describe('copernicus — the optional credentialed rung', () => {
  const credentials = { clientId: 'id', clientSecret: 'secret' };
  const tokenReply = (): Response =>
    new Response(JSON.stringify({ access_token: 'tok', expires_in: 600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('mints a client-credentials token, then POSTs a Sentinel-2 L2A process request', async () => {
    const stub = stubFetch([tokenReply(), imageReply()]);
    const image = await makeCopernicusFetcher({
      fetchImpl: stub.fetchImpl,
      credentials,
      pixels: 256,
      now: () => 0,
    }).fetch('cdse:-122.2,39.2,-121,40.2:2026-07-05');
    expect(stub.urls[0]).toContain('identity.dataspace.copernicus.eu');
    expect(String(stub.inits[0]?.body)).toContain('grant_type=client_credentials');
    expect(stub.urls[1]).toContain('sh.dataspace.copernicus.eu');
    const body = JSON.parse(String(stub.inits[1]?.body)) as {
      input: { data: { type: string }[] };
      evalscript: string;
    };
    expect(body.input.data[0]?.type).toBe('sentinel-2-l2a');
    expect(body.evalscript).toContain('B04'); // true colour, and never caller-supplied
    expect(image.attribution).toMatch(/Copernicus Sentinel-2 L2A/);
  });

  it('CACHES the token across images — CDSE rate-limits token requests (documented 429 risk)', async () => {
    const stub = stubFetch([tokenReply(), imageReply(), imageReply()]);
    const fetcher = makeCopernicusFetcher({ fetchImpl: stub.fetchImpl, credentials, now: () => 0 });
    await fetcher.fetch('cdse:-122.2,39.2,-121,40.2:2026-07-05');
    await fetcher.fetch('cdse:-122.2,39.2,-121,40.2:2026-07-06');
    expect(stub.urls.filter((u) => u.includes('identity.dataspace'))).toHaveLength(1);
  });

  it('re-mints once the cached token has expired', async () => {
    const stub = stubFetch([tokenReply(), imageReply(), tokenReply(), imageReply()]);
    let clock = 0;
    const fetcher = makeCopernicusFetcher({
      fetchImpl: stub.fetchImpl,
      credentials,
      now: () => clock,
    });
    await fetcher.fetch('cdse:-122.2,39.2,-121,40.2:2026-07-05');
    clock = 10 * 60 * 1000;
    await fetcher.fetch('cdse:-122.2,39.2,-121,40.2:2026-07-06');
    expect(stub.urls.filter((u) => u.includes('identity.dataspace'))).toHaveLength(2);
  });

  it('fails honestly on a rejected credential and on a token response with no token', async () => {
    const rejected = stubFetch([new Response('', { status: 401 })]);
    await expect(
      makeCopernicusFetcher({ fetchImpl: rejected.fetchImpl, credentials }).fetch(
        'cdse:-1,-1,1,1:2026-07-05',
      ),
    ).rejects.toThrow(/token request failed: HTTP 401/);
    const empty = stubFetch([
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ]);
    await expect(
      makeCopernicusFetcher({ fetchImpl: empty.fetchImpl, credentials }).fetch(
        'cdse:-1,-1,1,1:2026-07-05',
      ),
    ).rejects.toThrow(/no access_token/);
  });

  it('rejects a malformed or foreign cdse ref', () => {
    expect(parseCdseRef('cdse:-1,-1,1,1:2026-07-05').date).toBe('2026-07-05');
    expect(() => parseCdseRef('cdse:-1,-1,1,1')).toThrow(/malformed/);
    expect(() => parseCdseRef('gibs::-1,-1,1,1:2026-07-05')).toThrow(/not a cdse/);
  });
});

describe('fixture imagery — the offline/gate path', () => {
  it('reads the recorded tile named by a fixture: handle', async () => {
    const image = await makeFixtureImagery({
      fixturesDir: '/tiles/',
      readFileImpl: (p) =>
        p === '/tiles/burn-001.png' ? Promise.resolve(PNG) : Promise.reject(new Error('nope')),
    }).fetch('fixture:burn-001');
    expect(image.bytes).toEqual(PNG);
    expect(image.mediaType).toBe('image/png');
  });

  it('reports a MISSING tile honestly instead of returning an empty image', async () => {
    const fetcher = makeFixtureImagery({
      fixturesDir: '/tiles/',
      readFileImpl: () => Promise.reject(new Error('ENOENT')),
    });
    await expect(fetcher.fetch('fixture:absent')).rejects.toThrow(/not recorded on disk/);
  });

  it('refuses a path-traversal id (this reader opens a FILE)', () => {
    expect(parseFixtureId('fixture:burn-001')).toBe('burn-001');
    for (const bad of ['fixture:../../etc/passwd', 'fixture:a/b'])
      expect(() => parseFixtureId(bad)).toThrow(/invalid fixture id/);
    expect(() => parseFixtureId('https://example.org/x.png')).toThrow(/not a fixture/);
  });

  it('resolves the REAL recorded tiles that ship in fixtures/vision (the honesty check for deliverable 5)', async () => {
    const image = await makeFixtureImagery().fetch('fixture:gibs-modis721-burn-area-us-ca-001');
    expect(image.bytes.byteLength).toBeGreaterThan(1000);
    expect(Array.from(image.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]); // a real PNG header
  });
});

describe('imagery resolver — scheme routing, size ceiling, PII posture', () => {
  it('routes each scheme to its fetcher and refuses an unknown one', async () => {
    const stub = stubFetch([imageReply()]);
    const resolver = makeImageryResolver({
      fetchImpl: stub.fetchImpl,
      config: BASE_ENV,
      fixturesDir: '/tiles/',
      readFileImpl: () => Promise.resolve(PNG),
    });
    expect((await resolver.resolve('fixture:a')).imageRef).toBe('fixture:a');
    expect((await resolver.resolve('gibs::-1,-1,1,1:2026-07-05')).imageRef).toBe(
      'gibs::-1,-1,1,1:2026-07-05',
    );
    await expect(resolver.resolve('s3://bucket/x.png')).rejects.toThrow();
  });

  it('DEGRADES cdse: to GIBS when Copernicus credentials are absent — and says so in the attribution', async () => {
    const stub = stubFetch([imageReply()]);
    const resolver = makeImageryResolver({ fetchImpl: stub.fetchImpl, config: BASE_ENV });
    const image = await resolver.resolve('cdse:-122.2,39.2,-121,40.2:2026-07-05');
    expect(stub.urls[0]).toContain('gibs.earthdata.nasa.gov');
    expect(image.attribution).toMatch(/credentials absent/);
    expect(image.attribution).toMatch(/NASA EOSDIS GIBS/);
  });

  it('uses Copernicus when credentials ARE present', async () => {
    const stub = stubFetch([
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      imageReply(),
    ]);
    const resolver = makeImageryResolver({
      fetchImpl: stub.fetchImpl,
      config: { ...BASE_ENV, COPERNICUS_CLIENT_ID: 'id', COPERNICUS_CLIENT_SECRET: 'secret' },
      now: () => 0,
    });
    const image = await resolver.resolve('cdse:-122.2,39.2,-121,40.2:2026-07-05');
    expect(stub.urls[1]).toContain('sh.dataspace.copernicus.eu');
    expect(image.attribution).not.toMatch(/credentials absent/);
  });

  it('enforces VISION_MAX_IMAGE_MB centrally — an oversized tile is refused, never downscaled', async () => {
    const big = new Uint8Array(2 * 1024 * 1024);
    const stub = stubFetch([imageReply(big)]);
    const resolver = makeImageryResolver({
      fetchImpl: stub.fetchImpl,
      config: { ...BASE_ENV, VISION_MAX_IMAGE_MB: 1 },
    });
    await expect(resolver.resolve('gibs::-1,-1,1,1:2026-07-05')).rejects.toThrow(
      /exceeds VISION_MAX_IMAGE_MB/,
    );
  });

  it('VISION_PII_SCREEN=on refuses an arbitrary https:// image (no automated screen exists for a raw photo)', async () => {
    const stub = stubFetch([imageReply()]);
    const resolver = makeImageryResolver({ fetchImpl: stub.fetchImpl, config: BASE_ENV });
    await expect(resolver.resolve('https://example.org/photo.jpg')).rejects.toThrow(
      /VISION_PII_SCREEN=on/,
    );
    expect(stub.urls).toHaveLength(0); // refused BEFORE any egress
  });

  it('VISION_PII_SCREEN=off admits no NEW scheme — the screen can only tighten, never loosen', async () => {
    const stub = stubFetch([imageReply()]);
    const resolver = makeImageryResolver({
      fetchImpl: stub.fetchImpl,
      config: { ...BASE_ENV, VISION_PII_SCREEN: 'off' },
    });
    // Still unsupported: turning the screen off removes the posture check, not the requirement that a
    // scheme have a fetcher. Consent/PII gating in VisionAdapter is untouched by this flag either way.
    await expect(resolver.resolve('https://example.org/photo.jpg')).rejects.toThrow(
      /unsupported scheme/,
    );
  });

  it('maps a vision task to a fire- or water-visible GIBS product', () => {
    expect(gibsLayerForTask('burn-area')).toBe(GIBS_DEFAULT_LAYER);
    expect(gibsLayerForTask('flood-extent')).toBe('MODIS_Terra_CorrectedReflectance_TrueColor');
    expect(gibsLayerForTask('scene')).toBe(''); // no opinion ⇒ the fetcher's default
  });

  it('rewrites a cdse handle to the equivalent gibs handle', () => {
    expect(cdseToGibsRef('cdse:-1,-1,1,1:2026-07-05')).toBe('gibs::-1,-1,1,1:2026-07-05');
  });
});
