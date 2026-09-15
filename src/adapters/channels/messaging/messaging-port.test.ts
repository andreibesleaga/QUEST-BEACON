// BEACON — Telegram outbound transport tests (E10·T-456; ADR-023). Deterministic: an INJECTED fake fetch,
// no network. Asserts the real Bot API sendMessage request shape + every failure path returns a typed err
// (never throws), and that MOCK stays the default (RecordedTransport) when live/token is unset.
import { describe, it, expect } from 'vitest';
import {
  makeTelegramMessaging,
  RecordedTransport,
  type FetchLike,
  type MessagingConfig,
} from './messaging-port.js';

const TOKEN = '123456:ABC-DEF';
const LIVE: MessagingConfig = { mode: 'live', token: TOKEN };

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fake fetch that records the call and returns a canned Response (or throws for the network-error path). */
function fakeFetch(body: unknown, status = 200, calls: Call[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('TelegramLiveTransport — real Bot API sendMessage (injected fetch)', () => {
  it('POSTs {chat_id, text} JSON to the sendMessage endpoint and returns ok on {ok:true}', async () => {
    const calls: Call[] = [];
    const transport = makeTelegramMessaging(LIVE, fakeFetch({ ok: true, result: {} }, 200, calls));

    const res = await transport.send('999', 'flood crest rising');

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect(calls[0]?.init.redirect).toBe('manual'); // SSRF hardening: never follow a 3xx redirect
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      chat_id: '999',
      text: 'flood crest rising',
    });
  });

  it('returns a typed err (never throws) on a non-2xx HTTP status', async () => {
    const transport = makeTelegramMessaging(
      LIVE,
      fakeFetch({ ok: false, description: 'chat not found' }, 400),
    );
    const res = await transport.send('999', 'hi');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/chat not found/);
  });

  it('returns a typed err when the Bot API replies ok:false at HTTP 200', async () => {
    const transport = makeTelegramMessaging(
      LIVE,
      fakeFetch({ ok: false, description: 'blocked by user' }, 200),
    );
    const res = await transport.send('999', 'hi');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/blocked by user/);
  });

  it('returns a typed err on an unparseable body (json throws)', async () => {
    const badFetch: FetchLike = async () => new Response('<<not json>>', { status: 200 });
    const res = await makeTelegramMessaging(LIVE, badFetch).send('999', 'hi');
    expect(res.ok).toBe(false);
  });

  it('returns a typed err (never throws) when fetch itself rejects (network down)', async () => {
    const throwing: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));
    const res = await makeTelegramMessaging(LIVE, throwing).send('999', 'hi');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/ECONNREFUSED/);
  });

  it('defaults to the MOCK RecordedTransport (no network) when mode is not live', async () => {
    const calls: Call[] = [];
    const transport = makeTelegramMessaging(
      { mode: 'mock', token: TOKEN },
      fakeFetch({ ok: true }, 200, calls),
    );
    const res = await transport.send('999', 'hi');
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(0); // never touched the network
    expect(transport).toBeInstanceOf(RecordedTransport);
  });

  it('defaults to MOCK when live but no token (byte-identical offline behavior)', async () => {
    const transport = makeTelegramMessaging({ mode: 'live' }, fakeFetch({ ok: true }, 200));
    expect(transport).toBeInstanceOf(RecordedTransport);
  });
});
