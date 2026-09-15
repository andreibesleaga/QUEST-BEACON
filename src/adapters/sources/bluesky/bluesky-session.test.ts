// BEACON — Bluesky authed-session tests (S2·Lane-A1; ADR-009, Art. XVI). The BYO-account rung's whole
// lifecycle under an INJECTED fetch — no live network, no wall-clock: createSession is called once and its
// accessJwt reused; an expired accessJwt (401) is refreshed via com.atproto.server.refreshSession and the
// request retried exactly once; a dead refresh token falls back to a fresh createSession; a second 401 or a
// non-2xx surfaces as a typed AdapterError so the redundancy ladder degrades instead of looping.
// Request/response bodies are HAND-AUTHORED from the documented AT Protocol lexicons (docs.bsky.app) — no
// live capture was made (and none is possible without an account, which the operator will not create).
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { FetchLike } from './bluesky-session.js';
import { BlueskySessionClient } from './bluesky-session.js';

const CREDENTIALS = { identifier: 'beacon-demo.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' };
const SERVICE = 'https://pds.test';
const SEARCH_URL = `${SERVICE}/xrpc/app.bsky.feed.searchPosts?q=wildfire&limit=25`;
const POSTS_BODY = JSON.stringify({ posts: [] });

/** `com.atproto.server.createSession` / `refreshSession` success shape (docs.bsky.app lexicon). */
const sessionBody = (n: number): string =>
  JSON.stringify({
    did: 'did:plc:examplebeacondemo00000000',
    handle: CREDENTIALS.identifier,
    accessJwt: `access-${n}`,
    refreshJwt: `refresh-${n}`,
  });

interface Call {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | undefined;
  readonly body: string | undefined;
}

/** Record every request and answer it from a scripted queue keyed by XRPC method / URL. */
function recorder(script: (call: Call, nth: number) => Response): {
  calls: Call[];
  fetchImpl: FetchLike;
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      authorization: headers.authorization,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    return Promise.resolve(script(call, calls.length));
  };
  return { calls, fetchImpl };
}

const res = (body: string, status = 200): Response => new Response(body, { status });

const client = (fetchImpl: FetchLike): BlueskySessionClient =>
  new BlueskySessionClient({
    credentials: CREDENTIALS,
    serviceUrl: SERVICE,
    fetchImpl,
    timeoutMs: 400,
  });

describe('BlueskySessionClient — authed live path', () => {
  it('creates a session with the APP PASSWORD, then GETs searchPosts with the accessJwt as a bearer', async () => {
    const { calls, fetchImpl } = recorder((call) =>
      call.url.includes('createSession') ? res(sessionBody(1)) : res(POSTS_BODY),
    );
    const body = await client(fetchImpl).getText(SEARCH_URL);
    expect(body).toBe(POSTS_BODY);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(`${SERVICE}/xrpc/com.atproto.server.createSession`);
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      identifier: CREDENTIALS.identifier,
      password: CREDENTIALS.appPassword, // the APP password, never an account password
    });
    expect(calls[1]?.url).toBe(SEARCH_URL);
    expect(calls[1]?.authorization).toBe('Bearer access-1');
  });

  it('reuses the established session across calls (createSession is not re-issued per request)', async () => {
    const { calls, fetchImpl } = recorder((call) =>
      call.url.includes('createSession') ? res(sessionBody(1)) : res(POSTS_BODY),
    );
    const session = client(fetchImpl);
    await session.getText(SEARCH_URL);
    await session.getText(SEARCH_URL);
    expect(calls.filter((c) => c.url.includes('createSession'))).toHaveLength(1);
    expect(calls.filter((c) => c.url === SEARCH_URL)).toHaveLength(2);
  });

  it('fails fast (AUTH) when the credentials are rejected — never retried as a network blip', async () => {
    const { fetchImpl } = recorder(() =>
      res(JSON.stringify({ error: 'AuthenticationRequired' }), 401),
    );
    try {
      await client(fetchImpl).getText(SEARCH_URL);
      expect.unreachable('should throw AUTH');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) {
        expect(e.kind).toBe('AUTH');
        expect(e.retryable).toBe(false);
      }
    }
  });

  it('fails fast (AUTH) when createSession answers 200 with no accessJwt/refreshJwt', async () => {
    const { fetchImpl } = recorder(() => res(JSON.stringify({ did: 'did:plc:x' })));
    await expect(client(fetchImpl).getText(SEARCH_URL)).rejects.toMatchObject({ kind: 'AUTH' });
  });
});

describe('BlueskySessionClient — access-token expiry', () => {
  it('refreshes an ExpiredToken 401 with the refreshJwt and retries the search exactly once', async () => {
    const { calls, fetchImpl } = recorder((call) => {
      if (call.url.includes('createSession')) return res(sessionBody(1));
      if (call.url.includes('refreshSession')) return res(sessionBody(2));
      return call.authorization === 'Bearer access-1'
        ? res(JSON.stringify({ error: 'ExpiredToken' }), 401)
        : res(POSTS_BODY);
    });
    const body = await client(fetchImpl).getText(SEARCH_URL);
    expect(body).toBe(POSTS_BODY);
    expect(calls.map((c) => c.url.replace(`${SERVICE}/xrpc/`, '').split('?')[0])).toEqual([
      'com.atproto.server.createSession',
      'app.bsky.feed.searchPosts',
      'com.atproto.server.refreshSession',
      'app.bsky.feed.searchPosts',
    ]);
    // refreshSession authenticates with the REFRESH token, and the retry carries the NEW access token.
    expect(calls[2]?.authorization).toBe('Bearer refresh-1');
    expect(calls[3]?.authorization).toBe('Bearer access-2');
  });

  it('re-creates the session from credentials when the refresh token is dead too', async () => {
    const { calls, fetchImpl } = recorder((call, nth) => {
      if (call.url.includes('createSession')) return res(sessionBody(nth === 1 ? 1 : 3));
      if (call.url.includes('refreshSession'))
        return res(JSON.stringify({ error: 'ExpiredToken' }), 400);
      return call.authorization === 'Bearer access-1'
        ? res(JSON.stringify({ error: 'ExpiredToken' }), 401)
        : res(POSTS_BODY);
    });
    const body = await client(fetchImpl).getText(SEARCH_URL);
    expect(body).toBe(POSTS_BODY);
    expect(calls.filter((c) => c.url.includes('createSession'))).toHaveLength(2);
    expect(calls[calls.length - 1]?.authorization).toBe('Bearer access-3');
  });

  it('keeps the renewed session for the NEXT call (the 401 dance happens once, not per request)', async () => {
    let expired = true;
    const { calls, fetchImpl } = recorder((call) => {
      if (call.url.includes('createSession')) return res(sessionBody(1));
      if (call.url.includes('refreshSession')) return res(sessionBody(2));
      if (call.authorization === 'Bearer access-1' && expired) {
        expired = false;
        return res(JSON.stringify({ error: 'ExpiredToken' }), 401);
      }
      return res(POSTS_BODY);
    });
    const session = client(fetchImpl);
    await session.getText(SEARCH_URL);
    await session.getText(SEARCH_URL);
    expect(calls.filter((c) => c.url.includes('refreshSession'))).toHaveLength(1);
    expect(calls[calls.length - 1]?.authorization).toBe('Bearer access-2');
  });

  it('surfaces a typed error (never an unbounded refresh loop) when the retry is also 401', async () => {
    const { calls, fetchImpl } = recorder((call) => {
      if (call.url.includes('createSession')) return res(sessionBody(1));
      if (call.url.includes('refreshSession')) return res(sessionBody(2));
      return res(JSON.stringify({ error: 'ExpiredToken' }), 401);
    });
    await expect(client(fetchImpl).getText(SEARCH_URL)).rejects.toMatchObject({ kind: 'AUTH' });
    expect(calls.filter((c) => c.url.startsWith(SEARCH_URL))).toHaveLength(2); // one retry, then stop
  });
});

describe('BlueskySessionClient — upstream failures', () => {
  it('maps a 429 on the authed search to RATE_LIMITED (retryable)', async () => {
    const { fetchImpl } = recorder((call) =>
      call.url.includes('createSession') ? res(sessionBody(1)) : res('slow down', 429),
    );
    await expect(client(fetchImpl).getText(SEARCH_URL)).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('maps a transport failure to a retryable UPSTREAM_UNAVAILABLE', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(client(fetchImpl).getText(SEARCH_URL)).rejects.toMatchObject({
      kind: 'UPSTREAM_UNAVAILABLE',
      retryable: true,
    });
  });

  it('never follows a redirect (SSRF hardening — a bearer token must not be replayed elsewhere)', async () => {
    const seen: RequestInit[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      seen.push(init ?? {});
      return Promise.resolve(
        String(url).includes('createSession') ? res(sessionBody(1)) : res(POSTS_BODY),
      );
    };
    await client(fetchImpl).getText(SEARCH_URL);
    for (const init of seen) expect(init.redirect).toBe('manual');
  });
});
