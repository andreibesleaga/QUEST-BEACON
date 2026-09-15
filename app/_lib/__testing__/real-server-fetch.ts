// BEACON — the REAL-server test transport, extracted for reuse (F-366).
//
// `api.task-resource.e2e.test.ts` (F-140) and `api.write-seam.e2e.test.ts` (F-360/361/362) each carry their
// own copy of this adapter. Those copies are deliberately left alone — they are the two guards the E3 audit
// certified as trustworthy, and rewriting a certified guard to save nine lines is a bad trade. This module
// exists so the HOOK-level tests (F-366: 17 exported hooks, one tested) can use the same instrument without
// growing a third copy, and so the next test that needs it has an obvious place to import from.
//
// THE POINT OF THIS FILE, restated because it is the whole reason F-360/361/362 shipped green: a test that
// mocks `api.ts` and asserts the mock was called reproduces exactly the blindness it claims to cover. The
// ONLY thing stubbed here is the transport socket. The request bytes the client builds and the response
// bytes the server produces are never touched, so a body the client builds wrong meets the server's real
// validation and fails HERE — not in a browser with `tsc` reporting zero errors.
//
// DETERMINISTIC: fixed past clock, counter-minted ids, the built-in DEFAULT_FEATURE_SEED. No network, no
// wall clock, no ordering dependence.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHttpDeps, handleHttp } from '@/adapters/channels/http/http-dispatcher.js';
import type { HttpDeps } from '@/adapters/channels/http/http-types.js';
import { CAP_PROFILE_IDS, capProfilePath } from '@/adapters/interop/cap-profile.js';
import { validatorForSchema } from '@/adapters/interop/schema-validator.js';
import type { FetchImpl } from '../api.js';

/** The project-wide fixed test instant (AGENTS §determinism) — never `Date.now()`. */
export const FIXED_CLOCK = '2026-07-05T22:00:00Z';

/** Seeded demo ids the offline DEFAULT_FEATURE_SEED + core seed both carry. */
export const CA_REGION = 'us-ca';
export const CA_INCIDENT = 'us-ca-wildfire-demo';
export const CA_ENGINE = 'ca-engine-1';

/**
 * Repair ONE Vitest-environment artifact so the CAP emit path (`POST /alerts/:id/approve` — the Art. XIII
 * HITL gate) is reachable from a hook test, which must run in the `happy-dom` environment.
 *
 * `capProfilePath()` resolves its schema from `import.meta.url` — deliberately, so it does NOT depend on the
 * CWD the way the other interop schema reads do (ADR-036 finding G17). Under Vitest's browser-ish environment
 * an aliased `src/**` module's `import.meta.url` is root-relative rather than a real `file://` URL, so the
 * path comes out as `/schemas/cap-profiles/base.schema.json` and the read ENOENTs — `deps.sink.emit` throws
 * and the approve route answers a 500 that exists nowhere but in this environment. It resolves correctly in
 * the `node` environment and in the running server, which is the only place this code ever executes.
 *
 * NOTHING IS WEAKENED. The memo cache in `schema-validator` is keyed by string, so this registers the REAL,
 * unmodified published profile schema — read off disk at the correct path — under the key the environment
 * computed. Every emitted CAP document is still validated against the real profile; only the lookup path is
 * repaired. The `existsSync` guard makes it a no-op wherever the path already resolves (i.e. in `node`), so
 * this can never mask a genuine schema-resolution regression there.
 */
export function repairCapProfileSchemaPath(): void {
  for (const profile of CAP_PROFILE_IDS) {
    const resolved = capProfilePath(profile);
    if (existsSync(resolved)) continue;
    const onDisk = resolve(process.cwd(), `schemas/cap-profiles/${profile}.schema.json`);
    validatorForSchema(resolved, JSON.parse(readFileSync(onDisk, 'utf8')) as object);
  }
}

/** A deterministic id minter — `prefix-1`, `prefix-2`, … per deps instance. */
export function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

/**
 * A fresh, fully-composed server per call: fixed clock, counter ids, header-trust RBAC on (so the client's
 * `x-beacon-role` header is honoured exactly as the demo profile honours it), and an effectively unlimited
 * rate bucket so a test that issues many requests is never shaped by the limiter.
 */
export function realServerDeps(): HttpDeps {
  return createHttpDeps({
    core: { clock: () => FIXED_CLOCK, newId: counterIds(), env: { AUTH_DEV_TRUST_HEADER: 'on' } },
    rateLimit: { capacity: 10_000, refillPerSec: 0 },
  });
}

/**
 * A `fetchImpl` that forwards into the REAL `handleHttp` dispatcher instead of a network call. The client
 * builds URL/method/headers/body exactly as it would for a browser `fetch`; this decodes them back into an
 * `HttpRequest` — splitting pathname from query EXACTLY as the production Next delegator does
 * (`app/api/v1/[...path]/route.ts`) — and returns a real `Response` wrapping whatever the server decided, so
 * a rejection travels back through the real `fetchEnvelope`/`ApiError` path.
 *
 * `onRequest` is an optional OBSERVER (it sees the URL only and cannot alter anything) for tests that need to
 * count real requests — the honest way to assert "this query actually refetched".
 */
export function realServerFetch(d: HttpDeps, onRequest?: (url: string) => void): FetchImpl {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://beacon.test');
    onRequest?.(String(input));
    const method = init?.method ?? 'GET';
    const headers = (init?.headers as Record<string, string> | undefined) ?? {};
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const res = await handleHttp(
      {
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers,
        ...(body !== undefined ? { body } : {}),
      },
      d,
    );
    return new Response(JSON.stringify(res.body), { status: res.status });
  }) as FetchImpl;
}

/**
 * Wrap a fetch impl so the responses `shouldHold` selects are withheld until `release()` is called. The
 * request still travels through the REAL server and the real body is still what comes back — only its
 * DELIVERY is delayed. That is what makes an optimistic-cache assertion possible without mocking the server
 * away: the window between `onMutate` and `onSettled` becomes observable, and everything inside it is real.
 */
export function gatedFetch(
  inner: FetchImpl,
  shouldHold: (url: string, init?: RequestInit) => boolean = () => true,
): { readonly fetchImpl: FetchImpl; readonly release: () => void } {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await inner(input as RequestInfo, init);
    if (shouldHold(String(input), init)) await gate;
    return res;
  }) as FetchImpl;
  return { fetchImpl, release: () => open() };
}
