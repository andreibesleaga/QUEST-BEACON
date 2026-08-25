// BEACON — TanStack Query client factory (E8·T-352; ADR-002). One place to tune server-cache behavior.
// The envelope-typed fetch wrapper (T-352, built by the state/data workstream) rejects any data response
// missing provenance[] (F1) — the client here only configures caching/retry defaults.
import { QueryClient } from '@tanstack/react-query';

/** Create a QueryClient with crisis-appropriate defaults (short stale time; degrade, don't hammer). */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000, // near-real-time; SSE/polling drives fresher updates
        retry: 1, // fail fast to the last-known-good/degraded UI rather than spin
        refetchOnWindowFocus: false,
      },
    },
  });
}
