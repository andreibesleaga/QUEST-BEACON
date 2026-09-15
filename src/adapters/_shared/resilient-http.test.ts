// BEACON — the redirect control, which is a SECURITY control and is therefore tested as one.
//
// `redirect: 'manual'` is deliberate: an upstream that is compromised, hijacked or simply misconfigured
// must not be able to 3xx BEACON into an internal address — the cloud metadata endpoint at
// 169.254.169.254 being the canonical prize. A 3xx is therefore a failure, and the ladder degrades.
//
// On 2026-09-12 one source forced the question. Every HDX download answers 302 with a Location pointing
// at a PRESIGNED S3 URL: a different host, a signature, and an expiry inside the hour. There is nothing
// static to configure, so "put the real URL in the config" — the first instinct, and what this project's
// own plan said to do — cannot work for it.
//
// The exception is therefore per-call and narrow, and these tests are the definition of narrow: one hop,
// https only, never an IP literal, and only to a host the calling adapter named. Every rejection case
// below was mutation-checked (the guard removed, the test watched to go red, the guard restored).
import { describe, expect, it } from 'vitest';
import { httpGetText, redirectTarget } from './resilient-http.js';

function res(status: number, location?: string): Response {
  const headers = location === undefined ? undefined : { location };
  return new Response(null, { status, ...(headers !== undefined ? { headers } : {}) });
}

const FROM = 'https://data.humdata.org/dataset/abc/resource/def/download/rou.csv';
const ALLOW = ['.amazonaws.com'];

describe('redirectTarget', () => {
  it('follows a publisher redirect to a host the caller allowed', () => {
    const to =
      'https://s3.us-east-1.amazonaws.com/hdx-production-filestore/resources/def/rou.csv?Signature=x';
    expect(redirectTarget(res(302, to), FROM, ALLOW)).toBe(to);
  });

  it('refuses everything when no allowlist was given — the default for every other adapter', () => {
    const to = 'https://s3.us-east-1.amazonaws.com/anything.csv';
    expect(redirectTarget(res(302, to), FROM, undefined)).toBeNull();
    expect(redirectTarget(res(302, to), FROM, [])).toBeNull();
  });

  it('refuses the cloud metadata endpoint even if an allowlist exists', () => {
    // The attack this whole control is for. 169.254.169.254 is where AWS/GCP/Azure hand out credentials
    // to anything that asks from inside the instance.
    expect(
      redirectTarget(res(302, 'https://169.254.169.254/latest/meta-data/'), FROM, ALLOW),
    ).toBeNull();
  });

  it('refuses loopback and any other bare address, v4 or v6', () => {
    // Refusing IP LITERALS outright is what makes this robust: there is no list of private ranges to keep
    // current, and a name that resolves to a private address still has to be on the allowlist to get here.
    expect(redirectTarget(res(302, 'https://127.0.0.1/admin'), FROM, ALLOW)).toBeNull();
    expect(redirectTarget(res(302, 'https://[::1]/admin'), FROM, ALLOW)).toBeNull();
    expect(redirectTarget(res(302, 'https://10.0.0.5/internal'), FROM, ALLOW)).toBeNull();
  });

  it('refuses a downgrade to plaintext, and a non-https scheme of any kind', () => {
    expect(
      redirectTarget(res(302, 'http://s3.us-east-1.amazonaws.com/x.csv'), FROM, ALLOW),
    ).toBeNull();
    expect(redirectTarget(res(302, 'file:///etc/passwd'), FROM, ALLOW)).toBeNull();
  });

  it('refuses a host that is merely similar to an allowed one', () => {
    // `.amazonaws.com` must not admit `evil-amazonaws.com`, and an exact entry must not admit a subdomain.
    expect(redirectTarget(res(302, 'https://evil-amazonaws.com/x.csv'), FROM, ALLOW)).toBeNull();
    expect(redirectTarget(res(302, 'https://cdn.example.org/x'), FROM, ['example.org'])).toBeNull();
  });

  it('refuses a 3xx that names nowhere to go', () => {
    expect(redirectTarget(res(302), FROM, ALLOW)).toBeNull();
    expect(redirectTarget(res(302, 'not a url'), FROM, ALLOW)).toBeNull();
  });
});

describe('httpGetText and redirects', () => {
  /** A fetch that answers each URL from a script, recording the order it was asked. */
  function scripted(script: Record<string, Response>): { fetch: typeof fetch; seen: string[] } {
    const seen: string[] = [];
    const impl = ((url: RequestInfo | URL) => {
      const key = String(url);
      seen.push(key);
      const answer = script[key];
      return answer === undefined
        ? Promise.reject(new Error(`unscripted: ${key}`))
        : Promise.resolve(answer);
    }) as typeof fetch;
    return { fetch: impl, seen };
  }

  async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      return await run();
    } finally {
      globalThis.fetch = original;
    }
  }

  const TO = 'https://s3.us-east-1.amazonaws.com/file.csv';

  it('follows one allowed hop and returns the body from the destination', async () => {
    const { fetch: impl, seen } = scripted({
      [FROM]: res(302, TO),
      [TO]: new Response('year,ISO3\n2022,ROU\n', { status: 200 }),
    });
    const body = await withFetch(impl, () => httpGetText(FROM, { followRedirectTo: ALLOW }));
    expect(body).toContain('ROU');
    expect(seen).toEqual([FROM, TO]);
  });

  it('follows exactly ONE hop — a chain ends as a failure, not a longer walk', async () => {
    const SECOND = 'https://s3.eu-west-1.amazonaws.com/file.csv';
    const { fetch: impl, seen } = scripted({ [FROM]: res(302, TO), [TO]: res(302, SECOND) });
    await expect(
      withFetch(impl, () => httpGetText(FROM, { followRedirectTo: ALLOW })),
    ).rejects.toMatchObject({ kind: 'UPSTREAM_UNAVAILABLE' });
    expect(seen).toEqual([FROM, TO]); // the third request was never made
  });

  it('leaves every other caller exactly as it was: a 3xx is a typed failure', async () => {
    const { fetch: impl, seen } = scripted({ [FROM]: res(301, TO) });
    await expect(withFetch(impl, () => httpGetText(FROM))).rejects.toMatchObject({
      kind: 'UPSTREAM_UNAVAILABLE',
    });
    expect(seen).toEqual([FROM]);
  });
});
