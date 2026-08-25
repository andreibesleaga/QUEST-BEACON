// BEACON — F-140 end-to-end tasking guard (E8·T-352; Art. XIII/ST1). This is the test that COULD NOT have
// existed before F-140's fix, and whose absence is exactly why F-140 shipped undetected:
//   • `logistics-board.test.tsx` mocks `useTaskResource` — it never touches `api.ts` or a real fetch body.
//   • `feature-router.integration.test.ts` (the real HTTP-boundary test) hand-builds its POST body with the
//     CORRECT `status` key — it never sees what the actual browser client sends.
// So a client that names the wrong field (or omits a field the server hard-requires) could 400 on every real
// click while every existing test stayed green. This test closes that gap by driving the REAL `api.taskResource`
// (app/_lib/api.ts, completely unmocked) through an injected `fetchImpl` that forwards straight into the REAL
// server handler (`handleHttp` — the same composition root feature-router.integration.test.ts drives), so a
// client/server field-name or optionality mismatch fails HERE, at the actual wire boundary, not in a mock.
// DETERMINISTIC: fixed past clock '2026-07-05T22:00:00Z', counter newId, the same DEFAULT_FEATURE_SEED ids
// feature-router.integration.test.ts uses (CA wildfire incident + its seeded RESPONDER-org engine) — no
// network, no wall clock.
import { describe, it, expect, afterEach } from 'vitest';
import { getResources, taskResource } from './api.js';
import type { FetchImpl } from './api.js';
import { useUiStore } from './store.js';
import { createHttpDeps, handleHttp } from '@/adapters/channels/http/http-dispatcher.js';
import type { HttpDeps } from '@/adapters/channels/http/http-types.js';
import { RESOURCE_TASK_STATUSES } from '@/domain/resource-task.js';
import type { ResourceTaskView, TaskResourceBody } from './types.js';

const FIXED = '2026-07-05T22:00:00Z';
// Same seeded ids feature-router.integration.test.ts exercises for POST /resource-tasks (DEFAULT_FEATURE_SEED).
const CA_INCIDENT = 'us-ca-wildfire-demo';
const CA_ENGINE = 'ca-engine-1';
const CA_ORG = 'cal-fire';

function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

/** The same deps shape as the HTTP-boundary integration test: header-trust RBAC on, unlimited rate bucket. */
function deps(): HttpDeps {
  return createHttpDeps({
    core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_DEV_TRUST_HEADER: 'on' } },
    rateLimit: { capacity: 1000, refillPerSec: 0 },
  });
}

/**
 * A `fetchImpl` that forwards to the REAL `handleHttp` dispatcher instead of a network call — the ONLY thing
 * stubbed is transport (no HTTP socket), never the request/response CONTENTS. `api.taskResource` builds the
 * URL/method/headers/body exactly as it would for a real browser `fetch`; this adapter decodes them back into
 * an `HttpRequest` and returns a real `Response` wrapping whatever `handleHttp` actually decided — so a body
 * the client builds wrong reaches the server's real validation, and a rejection reaches back through the
 * real `fetchEnvelope`/`ApiError` path, exactly as it would for an actual click in an actual browser.
 */
function realServerFetch(d: HttpDeps): FetchImpl {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Split path from query EXACTLY as the production Next delegator does
    // (app/api/v1/[...path]/route.ts: `path: url.pathname, query: Object.fromEntries(url.searchParams)`).
    // Without this the client's query string would never become `req.query` and GET /resources could not
    // be exercised end-to-end at all — the base URL is arbitrary, only pathname + search are read.
    const url = new URL(String(input), 'http://beacon.test');
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

describe('taskResource — the REAL client body through the REAL server handler (F-140 guard)', () => {
  const initialUi = useUiStore.getState();
  afterEach(() => {
    useUiStore.setState(initialUi, true);
  });

  it('a real click reaches the intended lifecycle status end-to-end (the ONE status a brand-new client-' +
    'created task may legally start at — EV9)', async () => {
    useUiStore.getState().setRole('RESPONDER');
    const d = deps();
    // A body with no task `id` CREATES, and the domain requires a brand-new task to start at PROPOSED
    // (memory-logistics.ts `createTask`). This is the creation half of the contract; the advance half —
    // the half the wire type used to hide (F-191) — is exercised by the full-flow test below.
    const body: TaskResourceBody = { resourceId: CA_ENGINE, incidentId: CA_INCIDENT, status: 'PROPOSED' };
    const env = await taskResource(body, realServerFetch(d));
    // The task ACTUALLY reached PROPOSED server-side (nested under `task` — F-190) — not just "no error thrown".
    expect(env.data.task.status).toBe('PROPOSED');
    expect(env.provenance.length).toBeGreaterThan(0);
  });

  it('F-191: creating a brand-new task DIRECTLY at TASKED is still refused — the fix did NOT relax the ' +
    'domain’s PROPOSED-first invariant, it taught the client to advance instead', async () => {
    useUiStore.getState().setRole('RESPONDER');
    const d = deps();
    const body: TaskResourceBody = { resourceId: CA_ENGINE, incidentId: CA_INCIDENT, status: 'TASKED' };
    const err = await taskResource(body, realServerFetch(d)).catch((e: unknown) => e);
    expect(err).toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'STATE_CONFLICT',
      message: 'a new resource task must start at PROPOSED, got TASKED',
    });
  });

  // ── F-192 + F-191: the ENTIRE board flow, client-first, through the real server ───────────────────────
  //
  // This is the shape of test that would have caught F-192 the day it shipped: it calls the REAL
  // `api.getResources` the way the board's hook calls it, so "the client sends no query at all while the
  // route hard-requires one" fails HERE rather than 400-ing silently in a browser with `tsc` at 0 errors.

  it('F-192: GET /resources loads through the REAL client helper — the query contract the route requires ' +
    'is now the one the client is TYPED to send', async () => {
    useUiStore.getState().setRole('EM'); // EM sees every org's assets (RESPONDER/VERIFIER are org-scoped)
    const d = deps();
    const env = await getResources({ incidentId: CA_INCIDENT }, realServerFetch(d));
    // The envelope `data` is an OBJECT keyed by `resources` (F-200) — the board maps over THIS, and the old
    // hand-written `readonly ResourceSummary[]` mirror made `.map()` a runtime TypeError.
    expect(env.data.resources.map((r) => r.id)).toContain(CA_ENGINE);
    expect(env.provenance.length).toBeGreaterThan(0);
  });

  it('F-192: the optional `org` scope param reaches the server too (a RESPONDER is org-scoped)', async () => {
    useUiStore.getState().setRole('RESPONDER');
    const d = deps();
    const scoped = await getResources({ incidentId: CA_INCIDENT, org: CA_ORG }, realServerFetch(d));
    expect(scoped.data.resources.map((r) => r.id)).toContain(CA_ENGINE);
    // Without the org scope the SAME responder legally sees nothing — proof the param is actually read,
    // not silently dropped (a dropped param would have returned the identical list).
    const unscoped = await getResources({ incidentId: CA_INCIDENT }, realServerFetch(d));
    expect(unscoped.data.resources).toEqual([]);
  });

  it('F-191/F-192 END TO END: load the resource list, create a task, then ADVANCE it through every legal ' +
    'lifecycle step by id — the complete flow a real user performs in a real browser', async () => {
    useUiStore.getState().setRole('EM');
    const d = deps();
    const fetchImpl = realServerFetch(d);

    // 1. The board's list load — the step that used to 400 before a user could touch anything (F-192).
    const listed = await getResources({ incidentId: CA_INCIDENT }, fetchImpl);
    const resourceId = listed.data.resources[0]?.id;
    expect(resourceId).toBe(CA_ENGINE);

    // 2. Walk the WHOLE domain machine one legal hop at a time, exactly as repeated clicks on the board do:
    //    the first POST omits `id` (create ⇒ PROPOSED); every later POST carries the id the SERVER returned,
    //    so it ADVANCES that task instead of trying to create a second one at an illegal start state.
    let confirmed: ResourceTaskView | undefined;
    const ids: string[] = [];
    for (const status of RESOURCE_TASK_STATUSES) {
      const body: TaskResourceBody = {
        ...(confirmed !== undefined ? { id: confirmed.id } : {}),
        resourceId: resourceId as string,
        incidentId: CA_INCIDENT,
        status,
      };
      const env = await taskResource(body, fetchImpl);
      confirmed = env.data.task;
      ids.push(confirmed.id);
      // The server CONFIRMED this step — asserted per hop, so a silently-ignored `id` (which would create a
      // fresh PROPOSED task on every click) fails here instead of looking like success.
      expect(confirmed.status).toBe(status);
    }
    expect(confirmed?.status).toBe(RESOURCE_TASK_STATUSES.at(-1));
    // Every hop landed on the SAME task — ONE lifecycle advanced, not five tasks created. Asserted
    // self-referentially (all ids equal the first) rather than against a literal `task-1`: the literal would
    // silently couple this guard to how many ids `createHttpDeps` happens to mint while seeding, which is a
    // detail another lane can change. This form has no such coupling and states the invariant directly.
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(confirmed?.id);
  });
});
