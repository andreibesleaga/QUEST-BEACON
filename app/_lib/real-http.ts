// BEACON — REAL-handler test kit (E8·seam). NOT a fixture: this boots the ACTUAL HTTP dispatcher
// (createHttpDeps + handleHttp) with a fixed clock + the dev-trust RBAC flag, so component + contract tests
// exercise the SAME envelopes the browser receives. Imported only by tests; kept out of the `*.test` glob so
// Vitest does not collect it as a suite. This is the seam: if the wire shape drifts from the FE types, the
// mappers below stop compiling / the assertions fail — the class of bug that crashed the live COP.
import { createHttpDeps, handleHttp } from '@/adapters/channels/http/http-dispatcher.js';
import type { HttpDeps, HttpRequest } from '@/adapters/channels/http/http-types.js';
import type { Envelope } from '@/ports/interaction.js';
import type { ActorRole } from './types.js';

/** Fixed, safely-past instant — Freshness rejects future fetchedAt; deterministic across runs. */
export const FIXED_CLOCK = '2026-07-05T22:00:00Z';

/** The seeded demo incident id (CA wildfire) the offline core serves. */
export const DEMO_INCIDENT_ID = 'us-ca-wildfire-demo';
export const DEMO_REGION_ID = 'us-ca';

let counter = 0;

/** Deterministic deps with the demo-header RBAC flag on (real deployments use JWT — proven elsewhere). */
export function realDeps(): HttpDeps {
  return createHttpDeps({
    core: {
      clock: () => FIXED_CLOCK,
      newId: (p) => `${p}-${++counter}`,
      env: { AUTH_DEV_TRUST_HEADER: 'on' },
    },
    rateLimit: { capacity: 100_000, refillPerSec: 0 },
  });
}

/** Issue a real GET through handleHttp and return the parsed { status, envelope } exactly as the browser sees it. */
export async function realGet<T>(
  path: string,
  role: ActorRole = 'PUBLIC',
  deps: HttpDeps = realDeps(),
): Promise<{ status: number; env: Envelope<T> }> {
  const req: HttpRequest = { method: 'GET', path, query: {}, headers: { 'x-beacon-role': role } };
  const res = await handleHttp(req, deps);
  return { status: res.status, env: res.body as Envelope<T> };
}
