// @vitest-environment happy-dom
// BEACON — F-366: the MUTATION hooks, driven through the REAL server.
//
// `hooks.ts` exports 17 hooks and exactly ONE of them had a test. Every panel test mocks the whole module,
// so the layer that ASSEMBLES the request body and owns optimistic-update/invalidation was exercised by
// nothing but Playwright — and was invisible to coverage. Five live defects shipped through that gap in a
// single wave (F-360 every SOS coordinate silently discarded behind a 201 OK; F-361 the routing panel 400-ing
// on every submit; F-362 "Approve + CAP" as client-only fiction).
//
// The instrument therefore matters as much as the coverage. A test that mocks `api.ts` and asserts the mock
// was called REPRODUCES the blindness it claims to close. Every mutation below is driven the way a real
// click drives it — `renderHook` → `mutateAsync` → the real `api.ts` → the real `handleHttp` — with only the
// transport socket stubbed (`__testing__/real-server-fetch.ts`). Wherever possible the assertion is an
// OBSERVABLE OUTCOME read back through another hook, not "the request was made".
//
// DETERMINISTIC: fixed past clock, counter ids, the built-in offline seed. No network, no wall clock, no
// ordering dependence (every test builds its own server and its own QueryClient).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeQueryClient } from './query-client.js';
import { useUiStore } from './store.js';
import {
  queryKeys,
  useAlerts,
  useApproveAlert,
  useDraftAlert,
  useReports,
  useRequestRoute,
  useResources,
  useSubmitReport,
  useTaskResource,
  useVerifyReport,
} from './hooks.js';
import type { ApiError, FetchImpl } from './api.js';
import type { ActorRole, ReportsData } from './types.js';
import type { Envelope } from '@/ports/interaction.js';
import {
  CA_ENGINE,
  CA_INCIDENT,
  CA_REGION,
  gatedFetch,
  realServerDeps,
  realServerFetch,
  repairCapProfileSchemaPath,
} from './__testing__/real-server-fetch.js';

// The CAP emit path reads its profile schema off disk; see the helper's own comment for the one
// `happy-dom`-only path artifact this repairs (and for why no assertion is weakened by it).
repairCapProfileSchemaPath();

/** A precise SOS location inside the CA demo region — asserted BY VALUE, so a dropped coordinate cannot pass. */
const SOS_LAT = 38.5816;
const SOS_LON = -121.4944;

interface Harness {
  readonly qc: QueryClient;
  readonly wrapper: (props: { children: ReactNode }) => ReactNode;
  /** How many real requests this test has issued, per URL fragment — the honest "did it refetch?" probe. */
  readonly countOf: (fragment: string) => number;
}

/**
 * One fully-composed server + one QueryClient per test. `globalThis.fetch` is stubbed with the real-server
 * adapter because that is the seam the hooks actually use: `api.ts` defaults `fetchImpl` to `globalThis.fetch`
 * at CALL time, so the production code path is unchanged — nothing is injected into the hooks themselves.
 */
function harness(wrap?: (base: FetchImpl) => FetchImpl): Harness {
  const deps = realServerDeps();
  const calls: string[] = [];
  const base = realServerFetch(deps, (url) => calls.push(url));
  vi.stubGlobal('fetch', wrap ? wrap(base) : base);
  const qc = makeQueryClient();
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper, countOf: (f) => calls.filter((u) => u.includes(f)).length };
}

/**
 * Switch the acting principal. Wrapped in `act` because the role-scoped query hooks SUBSCRIBE to this store
 * (that subscription is what re-keys their query, F-366) — a bare `setRole` would update React state outside
 * an act scope and the re-key would race the assertion that follows it.
 */
function asRole(role: ActorRole): void {
  act(() => {
    useUiStore.getState().setRole(role);
  });
}

/** Run an async mutation inside `act` and return its value (React state updates stay inside the act scope). */
async function actValue<T>(fn: () => Promise<T>): Promise<T> {
  let out: T | undefined;
  await act(async () => {
    out = await fn();
  });
  return out as T;
}

/** Run an async call inside `act`, swallowing the rejection (the hook's error state is what gets asserted). */
async function actRejects(fn: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await fn().catch(() => undefined);
  });
}

/**
 * Submit an SOS through the real hook and advance it to TRIAGED — the real lifecycle a verifier walks.
 * `UNVERIFIED → VERIFIED` is not a legal hop (the domain rejects it), so the emitCap cases must pass through
 * TRIAGED exactly as a human does; short-cutting it would test a state the product never reaches.
 */
async function submitAndTriage(h: Harness, text: string, linked = true): Promise<{ readonly id: string }> {
  asRole('PUBLIC');
  const submit = renderHook(() => useSubmitReport(), { wrapper: h.wrapper });
  const created = await actValue(() =>
    submit.result.current.mutateAsync({
      consent: true,
      text,
      lat: SOS_LAT,
      lng: SOS_LON,
      ...(linked ? { incidentId: CA_INCIDENT } : {}),
    }),
  );
  asRole('VERIFIER');
  const verify = renderHook(() => useVerifyReport(CA_REGION), { wrapper: h.wrapper });
  await actValue(() => verify.result.current.mutateAsync({ id: created.data.id, body: { decision: 'TRIAGED' } }));
  return { id: created.data.id };
}

/** The seeded queue row a verifier acts on — selected by STATE, never by array position. */
function triagedRow(env: Envelope<ReportsData> | undefined): { readonly id: string; readonly status: string } {
  const row = env?.data.reports.find((r) => r.status === 'TRIAGED');
  if (row === undefined) throw new Error('the offline seed must carry a TRIAGED report for the verifier');
  return row;
}

const initialUi = useUiStore.getState();
afterEach(() => {
  cleanup();
  useUiStore.setState(initialUi, true);
  vi.unstubAllGlobals();
});

// ── useSubmitReport — POST /reports (the citizen SOS path, F-360) ──────────────────────────────────

describe('useSubmitReport', () => {
  it('carries the coordinate a citizen typed all the way to the store — read back BY VALUE through the ' +
    'RBAC-gated verifier queue, not out of the request the client just sent', async () => {
    const h = harness();
    asRole('PUBLIC');

    const submit = renderHook(() => useSubmitReport(), { wrapper: h.wrapper });
    const created = await actValue(() =>
      submit.result.current.mutateAsync({
        consent: true,
        text: 'Trapped by fire on the ridge road, need evacuation assistance.',
        lat: SOS_LAT,
        lng: SOS_LON,
        incidentId: CA_INCIDENT,
      }),
    );
    expect(created.data.status).toBe('UNVERIFIED'); // EV4 — intake NEVER creates anything already trusted

    // The read back travels through TWO independent server-side gates the client cannot fake: GET /reports is
    // VERIFIER+ (Art. XIII) and `geomPrecise` is revealed only to RESPONDER+ (Art. XIV). Asserting the
    // coordinate by VALUE is what makes this a proof — the defect this covers answered a perfectly valid 201
    // with no coordinate at all, so any presence-only assertion would have passed against the bug.
    asRole('EM');
    const queue = renderHook(() => useReports(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));
    const row = queue.result.current.data?.data.reports.find((r) => r.id === created.data.id);
    expect(row?.geomPrecise).toEqual({ type: 'Point', coordinates: [SOS_LON, SOS_LAT] });
  });

  it('surfaces a server rejection as a LABELLED typed error rather than a silent no-op (Art. XVI)', async () => {
    const h = harness();
    asRole('PUBLIC');

    const submit = renderHook(() => useSubmitReport(), { wrapper: h.wrapper });
    // A real server rejection, not a stubbed one: `reportCommand` requires non-blank text.
    await actRejects(() => submit.result.current.mutateAsync({ consent: true, text: '   ' }));

    await waitFor(() => expect(submit.result.current.isError).toBe(true));
    const err = submit.result.current.error as ApiError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('text is required');
  });
});

// ── useRequestRoute — POST /routes (the evacuation panel, F-361) ───────────────────────────────────

describe('useRequestRoute', () => {
  it('returns a real route AND the server-ranked shelters for the body the panel builds (destination ' +
    'omitted ⇒ the SERVER picks the nearest open shelter — the client never ranks, Art. XII)', async () => {
    const h = harness();
    asRole('PUBLIC');

    const route = renderHook(() => useRequestRoute(), { wrapper: h.wrapper });
    const env = await actValue(() =>
      route.result.current.mutateAsync({ origin: [SOS_LON, SOS_LAT], incidentId: CA_INCIDENT }),
    );

    expect(env.data.route.geom.coordinates.length).toBeGreaterThan(1);
    expect(env.data.shelters.length).toBeGreaterThan(0);
    expect(env.provenance.length).toBeGreaterThan(0); // F1 — an ungrounded response is not renderable data
  });

  it('a malformed origin is REJECTED by the server and the hook reports it — the panel can never render a ' +
    'route it did not receive', async () => {
    const h = harness();
    asRole('PUBLIC');

    const route = renderHook(() => useRequestRoute(), { wrapper: h.wrapper });
    // A deliberately wrong body: `{lat, lon}` is the exact shape F-361 shipped. It no longer typechecks,
    // which is the fix — the cast proves the SERVER also still refuses it, so the guard is two-sided.
    await actRejects(() =>
      route.result.current.mutateAsync({
        origin: { lat: SOS_LAT, lon: SOS_LON } as never,
        incidentId: CA_INCIDENT,
      }),
    );

    await waitFor(() => expect(route.result.current.isError).toBe(true));
    expect((route.result.current.error as ApiError).status).toBe(400);
    expect(route.result.current.data).toBeUndefined();
  });
});

// ── useVerifyReport — PATCH /reports/:id (optimistic + rollback + invalidation) ────────────────────

describe('useVerifyReport', () => {
  it('shows the verifier decision BEFORE the server answers, then keeps it once the server confirms ' +
    '(the optimistic window is held open by gating the transport, never by mocking the server)', async () => {
    let release = (): void => undefined;
    // Only the PATCH is held; the list GET flows through normally, so the window under observation is
    // exactly the one between `onMutate` and `onSettled`.
    const h = harness((base) => {
      const g = gatedFetch(base, (_url, init) => (init?.method ?? 'GET') === 'PATCH');
      release = g.release;
      return g.fetchImpl;
    });
    asRole('VERIFIER');

    const queue = renderHook(() => useReports(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));
    const target = triagedRow(queue.result.current.data);

    const verify = renderHook(() => useVerifyReport(CA_REGION), { wrapper: h.wrapper });
    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = verify.result.current
        .mutateAsync({ id: target.id, body: { decision: 'VERIFIED' } })
        .catch(() => undefined);
    });

    // The optimistic write landed on the SAME key `useReports` reads from. If the key ever drifts, this
    // fails — and a drifted key is a queue that silently stops updating, which no rendering test would catch.
    await waitFor(() =>
      expect(queue.result.current.data?.data.reports.find((r) => r.id === target.id)?.status).toBe('VERIFIED'),
    );
    expect(verify.result.current.isPending).toBe(true); // …and the server has NOT answered yet

    release();
    await act(async () => {
      await settled;
    });
    await waitFor(() => expect(verify.result.current.isSuccess).toBe(true));
    // onSettled invalidated the queue, and the queue view asks the server for `?status=pending`
    // (WP-C1, 2026-08-05) — so once the SERVER answers, the decided row is GONE from the queue
    // entirely rather than lingering with a VERIFIED badge. Decided means decided.
    await waitFor(() => expect(h.countOf('/reports')).toBeGreaterThan(1));
    await waitFor(() =>
      expect(queue.result.current.data?.data.reports.find((r) => r.id === target.id)).toBeUndefined(),
    );
  });

  // CONTRACT CHANGED 2026-08-05 (WP-C1): the hop this test used to force a refusal with
  // (UNVERIFIED→VERIFIED) is now the SUPPORTED one-click decision — the router performs the mandatory
  // TRIAGED hop itself. The refusal path under test is therefore the one that is STILL illegal at every
  // layer: re-deciding a report that is already terminal. The invariant is unchanged — after a server
  // refusal the cached queue tells the truth (no phantom row, no lingering optimistic value).
  it('one-click decision on a fresh UNVERIFIED report SUCCEEDS; re-deciding it is refused and the ' +
    'queue cache never lies about either outcome', async () => {
    const h = harness();
    asRole('PUBLIC');

    const submit = renderHook(() => useSubmitReport(), { wrapper: h.wrapper });
    const created = await actValue(() =>
      submit.result.current.mutateAsync({
        consent: true,
        text: 'Smoke column visible north of the ridge, unconfirmed.',
        incidentId: CA_INCIDENT,
      }),
    );

    asRole('VERIFIER');
    const queue = renderHook(() => useReports(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));
    expect(
      queue.result.current.data?.data.reports.find((r) => r.id === created.data.id)?.status,
    ).toBe('UNVERIFIED');

    // The judge's actual click: one terminal decision on the fresh report — persists (WP-C1).
    const verify = renderHook(() => useVerifyReport(CA_REGION), { wrapper: h.wrapper });
    await actValue(() =>
      verify.result.current.mutateAsync({ id: created.data.id, body: { decision: 'REJECTED' } }),
    );
    // Rejected means GONE from the pending queue after the server-confirmed refetch — never resurrected.
    await waitFor(() =>
      expect(queue.result.current.data?.data.reports.find((r) => r.id === created.data.id)).toBeUndefined(),
    );

    // Re-deciding the now-terminal report is refused (409) and the refusal leaves the cache truthful:
    // the decided row must NOT reappear as an optimistic phantom.
    await actRejects(() =>
      verify.result.current.mutateAsync({ id: created.data.id, body: { decision: 'VERIFIED' } }),
    );
    await waitFor(() => expect(verify.result.current.isError).toBe(true));
    expect(queue.result.current.data?.data.reports.find((r) => r.id === created.data.id)).toBeUndefined();
  });

  it('scopes the optimistic write to the region it was made for — another region’s cached queue is ' +
    'untouched (a blanket write would corrupt a COP the operator is not even looking at)', async () => {
    const h = harness();
    asRole('VERIFIER');

    const queue = renderHook(() => useReports(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));
    const target = triagedRow(queue.result.current.data);

    // A second region's queue, primed with the SAME row so a leaked write would be unmistakable.
    const otherKey = queryKeys.reports('ro', 'VERIFIER');
    h.qc.setQueryData(otherKey, queue.result.current.data);

    const verify = renderHook(() => useVerifyReport(CA_REGION), { wrapper: h.wrapper });
    await actValue(() => verify.result.current.mutateAsync({ id: target.id, body: { decision: 'REJECTED' } }));

    const other = h.qc.getQueryData<Envelope<ReportsData>>(otherKey);
    expect(other?.data.reports.find((r) => r.id === target.id)?.status).toBe('TRIAGED');
  });

  it('approve-with-CAP drafts a real alert server-side and hands it back in meta (Art. XIII: DRAFT only — ' +
    'promotion to ACTUAL stays a separate authenticated approval)', async () => {
    const h = harness();
    const { id } = await submitAndTriage(h, 'Structure fire spreading toward the eastern subdivision.');

    const verify = renderHook(() => useVerifyReport(CA_REGION), { wrapper: h.wrapper });
    const env = await actValue(() =>
      verify.result.current.mutateAsync({ id, body: { decision: 'VERIFIED', emitCap: true } }),
    );

    const emitted = env.meta?.emittedAlert as
      | { readonly id?: string; readonly capStatus?: string; readonly incidentId?: string }
      | undefined;
    expect(emitted?.id).toBeTruthy();
    // Scoped to the incident the reporter was looking at — proof the intake link is carried end to end and
    // that the alert is not attached to some arbitrary incident.
    expect(emitted?.incidentId).toBe(CA_INCIDENT);
    // If this ever reads 'ACTUAL', the human-in-the-loop emit gate has been bypassed.
    expect(emitted?.capStatus).toBe('DRAFT');
  });

  it('verifying WITHOUT emitCap emits nothing — the flag is the decision, not a formality', async () => {
    const h = harness();
    const { id } = await submitAndTriage(h, 'Smoke visible over the ridge, no structures threatened yet.');

    const verify = renderHook(() => useVerifyReport(CA_REGION), { wrapper: h.wrapper });
    const env = await actValue(() =>
      verify.result.current.mutateAsync({ id, body: { decision: 'VERIFIED' } }),
    );
    expect(env.meta?.emittedAlert).toBeUndefined();
  });

  it('an UNLINKED report drafts nothing and SAYS SO — no alert is invented to make the control look like ' +
    'it worked (Art. XVI: the degraded rung is LABELLED)', async () => {
    const h = harness();
    // No incidentId: a citizen may report before any incident exists. That is a real state, not an error.
    const { id } = await submitAndTriage(h, 'Water rising fast on the low road by the old mill.', false);

    const verify = renderHook(() => useVerifyReport(CA_REGION), { wrapper: h.wrapper });
    const env = await actValue(() =>
      verify.result.current.mutateAsync({ id, body: { decision: 'VERIFIED', emitCap: true } }),
    );

    expect(env.meta?.emittedAlert).toBeUndefined();
    expect(String(env.meta?.capNotEmitted)).toContain('not linked to an incident');
  });
});

// ── useTaskResource — POST /resource-tasks (no optimistic write; PREFIX invalidation, F-201) ───────

describe('useTaskResource', () => {
  it('creates the task the SERVER confirms (PROPOSED — the one start state the domain allows) and ' +
    'refreshes the board it belongs to', async () => {
    const h = harness();
    asRole('EM');

    const board = renderHook(() => useResources(CA_INCIDENT, 'EM'), { wrapper: h.wrapper });
    await waitFor(() => expect(board.result.current.isSuccess).toBe(true));
    expect(board.result.current.data?.data.resources.map((r) => r.id)).toContain(CA_ENGINE);
    const loadsBefore = h.countOf('/resources');

    const task = renderHook(() => useTaskResource(CA_INCIDENT), { wrapper: h.wrapper });
    const env = await actValue(() =>
      task.result.current.mutateAsync({ resourceId: CA_ENGINE, incidentId: CA_INCIDENT, status: 'PROPOSED' }),
    );

    expect(env.data.task.status).toBe('PROPOSED');
    // Deliberately NOT an optimistic write (the task's lifecycle vocabulary is not the resource's status
    // vocabulary) — so the ONLY thing that can refresh the board is the invalidation, and it must fire.
    await waitFor(() => expect(h.countOf('/resources')).toBeGreaterThan(loadsBefore));
  });

  it('invalidates EVERY role’s copy of that incident’s list and NO other incident’s (the F-201 prefix ' +
    'contract: a task changes what all roles see, and changes nothing elsewhere)', async () => {
    const h = harness();
    asRole('EM');

    const board = renderHook(() => useResources(CA_INCIDENT, 'EM'), { wrapper: h.wrapper });
    await waitFor(() => expect(board.result.current.isSuccess).toBe(true));

    // Two more cached copies: the same incident under a DIFFERENT role, and a DIFFERENT incident.
    const sameIncidentOtherRole = queryKeys.resources(CA_INCIDENT, 'RESPONDER');
    const otherIncident = queryKeys.resources('ro-flood-demo', 'EM');
    h.qc.setQueryData(sameIncidentOtherRole, board.result.current.data);
    h.qc.setQueryData(otherIncident, board.result.current.data);

    const task = renderHook(() => useTaskResource(CA_INCIDENT), { wrapper: h.wrapper });
    await actValue(() =>
      task.result.current.mutateAsync({ resourceId: CA_ENGINE, incidentId: CA_INCIDENT, status: 'PROPOSED' }),
    );

    expect(h.qc.getQueryState(sameIncidentOtherRole)?.isInvalidated).toBe(true);
    expect(h.qc.getQueryState(otherIncident)?.isInvalidated).toBe(false);
  });
});

// ── useDraftAlert + useApproveAlert — the Art. XIII two-step ───────────────────────────────────────

describe('useDraftAlert', () => {
  it('drafts a real alert for a real incident and it is DRAFT — never ACTUAL, on the highest-stakes path ' +
    'in the product', async () => {
    const h = harness();
    asRole('VERIFIER');

    const draft = renderHook(() => useDraftAlert(), { wrapper: h.wrapper });
    const env = await actValue(() =>
      draft.result.current.mutateAsync({
        incidentId: CA_INCIDENT,
        headline: 'Evacuation warning for the eastern subdivision',
      }),
    );

    // `capStatus` (not `state`) is the alert's CAP lifecycle marker — the key F-407 proved the client had
    // been reading wrong, so it is asserted by name here rather than through a defaulted display.
    expect(env.data.alert.capStatus).toBe('DRAFT');
    expect(env.data.headline).toBe('Evacuation warning for the eastern subdivision');
    expect(String(env.meta?.note)).toContain('requires authenticated approval');
  });

  it('is refused for a RESPONDER — the alert/CAP family is VERIFIER+ and the gate is the SERVER’s', async () => {
    const h = harness();
    asRole('RESPONDER');

    const draft = renderHook(() => useDraftAlert(), { wrapper: h.wrapper });
    await actRejects(() =>
      draft.result.current.mutateAsync({ incidentId: CA_INCIDENT, headline: 'unauthorized attempt' }),
    );

    await waitFor(() => expect(draft.result.current.isError).toBe(true));
    expect((draft.result.current.error as ApiError).status).toBe(403);
  });
});

describe('useApproveAlert', () => {
  it('promotes a real DRAFT to ACTUAL and REFRESHES the review queue — the invalidation is the only thing ' +
    'that can make the list stop showing a decision the operator already took', async () => {
    const h = harness();
    asRole('VERIFIER');

    const alerts = renderHook(() => useAlerts(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(alerts.result.current.isSuccess).toBe(true));
    const draft = alerts.result.current.data?.data.alerts.find((a) => a.state === 'DRAFT');
    expect(draft, 'the offline seed must COMPUTE at least one DRAFT alert (FR-11)').toBeDefined();
    const draftId = draft!.id;
    const loadsBefore = h.countOf('/alerts');

    const approve = renderHook(() => useApproveAlert(CA_REGION), { wrapper: h.wrapper });
    const env = await actValue(() => approve.result.current.mutateAsync(draftId));

    expect(env.data.alert?.capStatus).toBe('ACTUAL'); // the HITL gate did what the operator asked
    await waitFor(() => expect(h.countOf('/alerts')).toBeGreaterThan(loadsBefore));
    // The refreshed queue reflects the promotion. This is asserted against the SERVER's re-read rather than
    // against the mutation's own response — the F-362 failure mode was a test that fed a component the
    // answer it was about to assert.
    await waitFor(() =>
      expect(alerts.result.current.data?.data.alerts.find((a) => a.id === draftId)?.state).toBe('ACTUAL'),
    );
  });

  it('refuses to approve the SAME alert twice — the second attempt is a real server CONFLICT, so a double ' +
    'click cannot emit a second public message (Art. XIII)', async () => {
    const h = harness();
    asRole('VERIFIER');

    const alerts = renderHook(() => useAlerts(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(alerts.result.current.isSuccess).toBe(true));
    const draftId = alerts.result.current.data!.data.alerts.find((a) => a.state === 'DRAFT')!.id;

    const approve = renderHook(() => useApproveAlert(CA_REGION), { wrapper: h.wrapper });
    await actValue(() => approve.result.current.mutateAsync(draftId));
    await actRejects(() => approve.result.current.mutateAsync(draftId));

    await waitFor(() => expect(approve.result.current.isError).toBe(true));
    expect((approve.result.current.error as ApiError).status).toBe(409);
  });

  it('is refused for a RESPONDER — approval is VERIFIER+, and the client cannot talk its way past it', async () => {
    const h = harness();
    asRole('VERIFIER');
    const alerts = renderHook(() => useAlerts(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(alerts.result.current.isSuccess).toBe(true));
    const draftId = alerts.result.current.data!.data.alerts.find((a) => a.state === 'DRAFT')!.id;

    asRole('RESPONDER');
    const approve = renderHook(() => useApproveAlert(CA_REGION), { wrapper: h.wrapper });
    await actRejects(() => approve.result.current.mutateAsync(draftId));

    await waitFor(() => expect(approve.result.current.isError).toBe(true));
    expect((approve.result.current.error as ApiError).status).toBe(403);
  });
});
