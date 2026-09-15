// BEACON — TanStack Query client factory (E8·T-352; ADR-002). One place to tune server-cache behavior.
// The envelope-typed fetch wrapper (T-352, built by the state/data workstream) rejects any data response
// missing provenance[] (F1) — the client here only configures caching/retry defaults.
import { QueryClient } from '@tanstack/react-query';
import { PWA_ENABLED } from './pwa/flag.js';

/**
 * Create a QueryClient with crisis-appropriate defaults (short stale time; degrade, don't hammer).
 *
 * `offlineFirst` (ADR-047): TanStack's default `networkMode: 'online'` never even CALLS the query function
 * while `navigator.onLine` is false — so with the service worker holding a saved picture, an offline reload
 * would sit on a skeleton forever. `offlineFirst` fires the fetch once (the worker answers from its cache)
 * and only then pauses retries. It is tied to the PWA flag so the default build keeps the default mode.
 */
export function makeQueryClient(offlineFirst: boolean = PWA_ENABLED): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000, // near-real-time; SSE/polling drives fresher updates
        retry: 1, // fail fast to the last-known-good/degraded UI rather than spin
        refetchOnWindowFocus: false,
        ...(offlineFirst ? { networkMode: 'offlineFirst' as const } : {}),
      },
    },
  });
}
