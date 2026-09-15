// BEACON — minimal AI-provider HTTP client tests (E6 support; ADR-007). Deterministic: an INJECTED fake
// fetch, no network. Asserts the JSON POST request shape and the SSRF-hardening redirect posture.
import { describe, it, expect } from 'vitest';
import { makeHttpClient } from './http-client.js';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fake fetch that records the call and returns a canned JSON Response. */
function fakeFetch(body: unknown, status = 200, calls: Call[] = []) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('makeHttpClient — postJson (injected fetch)', () => {
  it('POSTs JSON and passes redirect:manual (SSRF hardening — never follow a 3xx to an internal address)', async () => {
    const calls: Call[] = [];
    const client = makeHttpClient(fakeFetch({ ok: true }, 200, calls));

    const res = await client.postJson(
      'https://provider.example/v1/chat',
      { hello: 'world' },
      { authorization: 'Bearer x' },
    );

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.redirect).toBe('manual');
    expect((calls[0]?.init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer x');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ hello: 'world' });
  });

  it('a 3xx redirect surfaces as a non-ok response (res.ok false) — the caller treats it as a failure', async () => {
    const client = makeHttpClient(fakeFetch(null, 302));
    const res = await client.postJson('https://provider.example/v1/chat', {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(302);
  });
});
