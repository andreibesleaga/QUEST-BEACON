// BEACON — `beacon-locale` cookie → InteractionRequest.locale through the HTTP dispatcher (ADR-030,
// FR-I18N-2). The ports contract documented this connection from day one ("HTTP: the `beacon-locale`
// cookie") and nothing implemented it, so the entire i18n-narration chain behind NarrativeRequest.locale
// sat dark (found 2026-08-04 — the declared-but-unhonoured-contract class). These tests pin BOTH ends:
// the cookie is parsed, and a request without one stays locale-less. DETERMINISTIC: spy port, no network.
import { describe, it, expect } from 'vitest';
import { handleHttp } from './http-dispatcher.js';
import { createTokenBucketLimiter } from './rate-limit.js';
import type { HttpDeps, HttpRequest } from './http-types.js';
import type { Envelope, InteractionPort, InteractionRequest } from '@/ports/interaction.js';

const FIXED = '2026-07-05T22:00:00Z';

/** Minimal deps around a SPY InteractionPort — captures the request the dispatcher actually built. */
function spyDeps(): { deps: HttpDeps; seen: InteractionRequest[] } {
  const seen: InteractionRequest[] = [];
  const interaction: InteractionPort = {
    handle: (request) => {
      seen.push(request);
      const envelope: Envelope = {
        data: {},
        provenance: [{ sourceId: 'spy', mode: 'MOCK', fetchedAt: FIXED }],
        freshness: FIXED,
      };
      return Promise.resolve({ ok: true, value: envelope } as never);
    },
  };
  const deps = {
    interaction,
    clock: () => FIXED,
    rateLimiter: createTokenBucketLimiter({ capacity: 1000, refillPerSec: 0, clock: () => FIXED }),
    env: { AUTH_DEV_TRUST_HEADER: 'on' },
    features: {} as HttpDeps['features'],
    reports: { list: () => Promise.resolve({ ok: true, value: [] } as never) },
  } as HttpDeps;
  return { deps, seen };
}

function get(path: string, headers: Record<string, string>): HttpRequest {
  return { method: 'GET', path, query: {}, headers } as HttpRequest;
}

describe('beacon-locale cookie → InteractionRequest.locale', () => {
  it('threads the cookie value onto the command request (the SitRep narration language)', async () => {
    const { deps, seen } = spyDeps();
    await handleHttp(get('/api/v1/incidents/inc-1/sitrep', { cookie: 'beacon-locale=ro' }), deps);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.locale).toBe('ro');
  });

  it('finds the cookie among others and URL-decodes it', async () => {
    const { deps, seen } = spyDeps();
    await handleHttp(
      get('/api/v1/status', { cookie: 'theme=dark; beacon-locale=pt-BR; other=1' }),
      deps,
    );
    expect(seen[0]?.locale).toBe('pt-BR');
  });

  it('omits locale entirely when no cookie is present — English by absence, never a guess', async () => {
    const { deps, seen } = spyDeps();
    await handleHttp(get('/api/v1/status', {}), deps);
    expect(seen[0]).not.toHaveProperty('locale');
  });

  it('degrades a malformed percent-encoding to "no locale" — a hostile Cookie header is never a 500', async () => {
    const { deps, seen } = spyDeps();
    // `%E0%A4%A` is truncated UTF-8: decodeURIComponent throws URIError on it. Presentation-only input
    // must degrade (Art. XVI), not crash the request that carried it.
    const res = await handleHttp(get('/api/v1/status', { cookie: 'beacon-locale=%E0%A4%A' }), deps);
    expect(res.status).toBe(200);
    expect(seen[0]).not.toHaveProperty('locale');
  });
});
