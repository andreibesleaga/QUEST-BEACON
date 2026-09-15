// BEACON — envelope fetch wrapper contract (E8·T-352; F1). Stubbed fetch, no network. Asserts: a good
// envelope (incl. sitrep citations) parses; an ungrounded 2xx (missing/empty provenance) is rejected;
// an error envelope surfaces as a typed ApiError; helpers build the right method + path.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ApiError,
  devLogin,
  login,
  fetchEnvelope,
  getSitRep,
  getStatus,
  verifyReport,
  type FetchImpl,
} from './api.js';
import { useUiStore } from './store.js';
import type { Envelope } from '@/ports/interaction.js';
import type { SitRepData } from './types.js';

/** A fetch stub returning one canned JSON response; records the last call for assertions. */
function stubFetch(
  status: number,
  body: unknown,
): { fetch: FetchImpl; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as FetchImpl;
  return { fetch, calls };
}

const sitrepEnvelope: Envelope<SitRepData> = {
  data: {
    fields: [{ field: 'summary', claim: 'Fire advancing NE toward Ridgeline.' }],
    priorities: [{ rank: 1, label: 'substation-4', detail: 'blended risk score 0.92' }],
    aiMode: 'cloud',
  },
  provenance: [{ sourceId: 'firms', mode: 'LIVE', fetchedAt: '2026-07-07T12:00:00Z' }],
  freshness: '2026-07-07T12:00:00Z',
  citations: [{ field: 'summary', sourceId: 'firms' }],
};

describe('fetchEnvelope + helpers', () => {
  it('parses a grounded envelope including sitrep citations[]', async () => {
    const { fetch, calls } = stubFetch(200, sitrepEnvelope);
    const env = await getSitRep('inc-1', fetch);
    expect(env.data.priorities[0]?.rank).toBe(1);
    expect(env.provenance).toHaveLength(1);
    expect(env.citations?.[0]).toEqual({ field: 'summary', sourceId: 'firms' });
    expect(calls[0]?.url).toBe('/api/v1/incidents/inc-1/sitrep');
  });

  it('rejects a 2xx response with MISSING provenance (F1)', async () => {
    const { fetch } = stubFetch(200, { data: { regionId: 'r1', sources: [] } });
    await expect(getStatus('r1', fetch)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'MISSING_PROVENANCE',
    });
  });

  it('rejects a 2xx response with an EMPTY provenance[] (F1)', async () => {
    const { fetch } = stubFetch(200, { data: {}, provenance: [] });
    await expect(fetchEnvelope('/status', undefined, fetch)).rejects.toBeInstanceOf(ApiError);
  });

  it('surfaces an error envelope as a typed ApiError carrying status/code/message', async () => {
    const { fetch } = stubFetch(403, {
      data: null,
      provenance: [],
      errors: [{ code: 'FORBIDDEN', message: 'VERIFIER role required.' }],
    });
    const err = await verifyReport('rep-9', { decision: 'VERIFIED' }, fetch).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('VERIFIER role required.');
  });

  it('verifyReport issues a PATCH to the report path with a JSON body', async () => {
    const ok: Envelope<{ id: string; status: string }> = {
      data: { id: 'rep-9', status: 'VERIFIED' },
      provenance: [{ sourceId: 'triage', mode: 'LIVE', fetchedAt: '2026-07-07T12:00:00Z' }],
    };
    const { fetch, calls } = stubFetch(202, ok);
    await verifyReport('rep-9', { decision: 'VERIFIED', emitCap: true }, fetch);
    expect(calls[0]?.url).toBe('/api/v1/reports/rep-9');
    expect(calls[0]?.init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      decision: 'VERIFIED',
      emitCap: true,
    });
  });
});

describe('roleHeaders — Bearer when authToken set, x-beacon-role otherwise', () => {
  const initial = useUiStore.getState();
  beforeEach(() => {
    useUiStore.setState(initial, true);
  });

  function headersOf(init?: RequestInit): Record<string, string> {
    return (init?.headers as Record<string, string> | undefined) ?? {};
  }

  it('falls back to x-beacon-role when no authToken is set (offline demo posture)', async () => {
    useUiStore.getState().setRole('VERIFIER');
    const okEnv: Envelope<unknown> = {
      data: {},
      provenance: [{ sourceId: 's', mode: 'MOCK', fetchedAt: 'x' }],
    };
    const { fetch, calls } = stubFetch(200, okEnv);
    await getStatus(undefined, fetch);
    const h = headersOf(calls[0]?.init);
    expect(h['x-beacon-role']).toBe('VERIFIER');
    expect(h.authorization).toBeUndefined();
  });

  it('sends Authorization: Bearer <token> when an authToken is present (true identity)', async () => {
    useUiStore.getState().setRole('VERIFIER');
    useUiStore.getState().setAuthToken('jwt-abc');
    const okEnv: Envelope<unknown> = {
      data: {},
      provenance: [{ sourceId: 's', mode: 'MOCK', fetchedAt: 'x' }],
    };
    const { fetch, calls } = stubFetch(200, okEnv);
    await getStatus(undefined, fetch);
    const h = headersOf(calls[0]?.init);
    expect(h.authorization).toBe('Bearer jwt-abc');
    expect(h['x-beacon-role']).toBeUndefined();
  });
});

describe('login — named-account sign-in', () => {
  it('returns the token AND the SERVER-assigned role (never one the caller asked for)', async () => {
    const { fetch, calls } = stubFetch(200, {
      token: 'jwt-abc',
      role: 'EM',
      userId: 'em@beacon.demo',
    });
    const session = await login('em@beacon.demo', 'secret', fetch);
    expect(session).toEqual({ token: 'jwt-abc', role: 'EM', userId: 'em@beacon.demo' });
    expect(calls[0]?.url).toBe('/api/v1/auth/login');
    // The request carries NO role field — the account decides it.
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      userId: 'em@beacon.demo',
      password: 'secret',
    });
  });

  it('returns undefined on bad credentials (401)', async () => {
    const { fetch } = stubFetch(401, {
      errors: [{ code: 'UNAUTHORIZED', message: 'invalid credentials' }],
    });
    expect(await login('em@beacon.demo', 'wrong', fetch)).toBeUndefined();
  });

  it('returns undefined when login is not configured (404) — same outcome, no posture leak', async () => {
    const { fetch } = stubFetch(404, { errors: [{ code: 'NOT_FOUND', message: 'no such route' }] });
    expect(await login('em@beacon.demo', 'secret', fetch)).toBeUndefined();
  });

  it('returns undefined on a malformed 200 (missing token/role) rather than a half-session', async () => {
    const { fetch } = stubFetch(200, { role: 'EM' });
    expect(await login('em@beacon.demo', 'secret', fetch)).toBeUndefined();
  });
});

describe('devLogin — demo IdP token exchange', () => {
  it('returns the minted token on 200 and sends no auth header', async () => {
    const { fetch, calls } = stubFetch(200, { token: 'jwt-xyz' });
    const token = await devLogin('VERIFIER', 'user-alice', fetch);
    expect(token).toBe('jwt-xyz');
    expect(calls[0]?.url).toBe('/api/v1/auth/dev-login');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      role: 'VERIFIER',
      userId: 'user-alice',
    });
  });

  it('returns undefined when dev-login is disabled (404)', async () => {
    const { fetch } = stubFetch(404, { errors: [{ code: 'NOT_FOUND', message: 'disabled' }] });
    expect(await devLogin('VERIFIER', 'user-alice', fetch)).toBeUndefined();
  });
});
