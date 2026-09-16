// BEACON — F-360/F-361/F-362 write-seam guard (E3 re-audit). The READ seam was closed by F-140/F-192 with
// `api.task-resource.e2e.test.ts`; this is the same instrument pointed at the three WRITE paths, and it is
// the test whose absence let all three ship green.
//
// F-364 proved the root cause rather than inferring it: `app/_lib/types.ts` DERIVES two wire types from the
// server and hand-duplicates three — and those three were exactly the three broken contracts. 3-for-3. A
// hand-written mirror can be wrong in a way `tsc` cannot see, because both sides typecheck perfectly against
// their own private idea of the wire.
//
// Every existing test missed all three for the same structural reason: component tests mock the mutation
// hook (they never reach `api.ts`), and the server-side integration tests hand-build their request bodies
// with the CORRECT keys (they never see what the browser client actually sends). Nothing in the suite ever
// put the REAL client body in front of the REAL server parser. That is precisely what this file does — the
// only thing stubbed is the transport socket, never the request or response CONTENTS.
//
// DETERMINISTIC: fixed past clock '2026-07-05T22:00:00Z', counter newId, DEFAULT_FEATURE_SEED ids. No
// network, no wall clock, no ordering dependence.
import { describe, it, expect, afterEach } from 'vitest';
import { getReports, requestRoute, submitReport, verifyReport } from './api.js';
import type { FetchImpl } from './api.js';
import { useUiStore } from './store.js';
import { createHttpDeps, handleHttp } from '@/adapters/channels/http/http-dispatcher.js';
import type { HttpDeps } from '@/adapters/channels/http/http-types.js';
import type { RequestRouteBody, SubmitReportBody, VerifyReportBody } from './types.js';

const FIXED = '2026-07-05T22:00:00Z';
const CA_INCIDENT = 'us-ca-wildfire-demo';
/** A precise SOS location inside the CA demo region — asserted by VALUE, so a dropped coordinate cannot pass. */
const SOS_LAT = 38.5816;
const SOS_LON = -121.4944;

function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

function deps(): HttpDeps {
  return createHttpDeps({
    core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_DEV_TRUST_HEADER: 'on' } },
    rateLimit: { capacity: 1000, refillPerSec: 0 },
  });
}

/**
 * A `fetchImpl` that forwards to the REAL `handleHttp` dispatcher instead of a network call. The client
 * builds URL/method/headers/body exactly as it would for a browser `fetch`; this decodes them back into an
 * `HttpRequest` and returns a real `Response` wrapping whatever the server actually decided — so a body the
 * client builds wrong meets the server's real validation, and the rejection returns through the real
 * `fetchEnvelope`/`ApiError` path. Same adapter as `api.task-resource.e2e.test.ts` (F-140).
 */
function realServerFetch(d: HttpDeps): FetchImpl {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
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

/**
 * Read the submitted report back from the triage queue as EM. Two independent server-side gates apply and
 * EM is the role that clears both: `GET /reports` is VERIFIER+ (Art. XIII — only a verifier/EM triages) and
 * `geomPrecise` is revealed only to RESPONDER+ (Art. XIV). Asserting through the REAL gated read, rather
 * than reaching into the store, is what makes this a proof that the coordinate survived the whole round trip.
 */
async function readBackPrecise(id: string, fetchImpl: FetchImpl): Promise<unknown> {
  useUiStore.getState().setRole('EM');
  const queue = await getReports(fetchImpl);
  return queue.data.reports.find((r) => r.id === id)?.geomPrecise;
}

/**
 * Submit an SOS linked to the CA demo incident and advance it to TRIAGED — the real lifecycle a verifier
 * walks. `UNVERIFIED → VERIFIED` is NOT a legal hop (the domain rejects it), so the emitCap cases below must
 * pass through TRIAGED exactly as a human does; short-cutting it would test a state the product never reaches.
 */
async function submitAndTriage(text: string, fetchImpl: FetchImpl): Promise<string> {
  useUiStore.getState().setRole('PUBLIC');
  const submitted = await submitReport(
    { consent: true, text, lat: SOS_LAT, lng: SOS_LON, incidentId: CA_INCIDENT },
    fetchImpl,
  );
  useUiStore.getState().setRole('VERIFIER');
  await verifyReport(submitted.data.id, { decision: 'TRIAGED' }, fetchImpl);
  return submitted.data.id;
}

describe('the WRITE seam — real client bodies through the real server (F-360/361/362)', () => {
  const initialUi = useUiStore.getState();
  afterEach(() => {
    useUiStore.setState(initialUi, true);
  });

  // ── F-360 — POST /reports ────────────────────────────────────────────────────────────────────────
  //
  // The citizen-SOS path. The client sent a NESTED `location: {lat, lon}`; the server reads TOP-LEVEL
  // `lat`/`lng`. Two mismatches at once (nesting AND the `lon`/`lng` spelling), and because the coordinate
  // is OPTIONAL the server saw a location-less report and answered **201 Created**. Silent live data loss
  // on the one path where a coordinate is the whole point of the message.

  it('F-360: a coordinate typed into the real SOS form actually reaches the server and is stored', async () => {
    useUiStore.getState().setRole('PUBLIC');
    const d = deps();
    const fetchImpl = realServerFetch(d);

    const body: SubmitReportBody = {
      consent: true,
      text: 'Trapped by fire on the ridge road, need evacuation assistance.',
      lat: SOS_LAT,
      lng: SOS_LON,
    };
    const submitted = await submitReport(body, fetchImpl);

    // Asserted by VALUE, not merely "a geometry exists": the defect returned a perfectly valid 201 with no
    // coordinate at all, so any presence-only assertion would have passed against the bug.
    const precise = await readBackPrecise(submitted.data.id, fetchImpl);
    expect(precise).toEqual({ type: 'Point', coordinates: [SOS_LON, SOS_LAT] });
  });

  // ── F-361 — POST /routes ─────────────────────────────────────────────────────────────────────────
  //
  // The evacuation-routing panel. The client sent `origin: {lat, lon}` and no destination; the server
  // required `origin` as a `[lon, lat]` Position AND hard-required a destination. Every submit 400'd. The
  // panel's own component test was a GREEN assertion that the client sends a payload the server refuses.
  //
  // Note the server was ALSO wrong here, against its own published contract: `openapi.yaml` documents
  // `destination` as optional — "if omitted, the nearest open shelter is the destination". The UI collects
  // only an origin and renders ranked shelters, so the documented behaviour is the one both sides intended.
  // Deriving the client type alone would have made the panel stop offering a feature the product claims;
  // the server had to learn the destination-less case it always promised.

  it('F-361: the real routing panel body returns a route — destination omitted, server picks the shelter', async () => {
    useUiStore.getState().setRole('PUBLIC');
    const d = deps();
    const fetchImpl = realServerFetch(d);

    const body: RequestRouteBody = { origin: [SOS_LON, SOS_LAT], incidentId: CA_INCIDENT };
    const env = await requestRoute(body, fetchImpl);

    // A route AND the ranked shelters the panel renders — the server chose the destination deterministically
    // (Art. XII); the client never ranks or picks.
    expect(env.data.route.geom.coordinates.length).toBeGreaterThan(1);
    expect(env.data.shelters.length).toBeGreaterThan(0);
    expect(env.provenance.length).toBeGreaterThan(0);
  });

  it('F-361: an explicit destination still routes to THAT destination (the fix added a case, it removed none)', async () => {
    useUiStore.getState().setRole('PUBLIC');
    const d = deps();
    const fetchImpl = realServerFetch(d);

    const body: RequestRouteBody = {
      origin: [SOS_LON, SOS_LAT],
      destination: [SOS_LON + 0.05, SOS_LAT + 0.05],
      incidentId: CA_INCIDENT,
    };
    const env = await requestRoute(body, fetchImpl);
    expect(env.data.route.geom.coordinates.length).toBeGreaterThan(1);
  });

  // ── F-362 — PATCH /reports/:id ───────────────────────────────────────────────────────────────────
  //
  // The Art. XIII CAP-emission path — the most consequential of the three. The verifier queue's
  // "Approve + CAP" control sent `emitCap: true`; the server's verify parser never read the field, and
  // `emitCap` appeared nowhere under `src/` at all. The control was client-only fiction. The test that
  // "proved" it worked supplied the server's response to itself through a mock.
  //
  // Art. XIII is preserved exactly: what VERIFIED + emitCap produces is a **DRAFT** alert. Promotion to
  // ACTUAL remains a separate authenticated human approval (POST /alerts/:id/approve).

  it('F-362: approve-with-CAP actually emits a DRAFT alert server-side and returns it in meta', async () => {
    const fetchImpl = realServerFetch(deps());
    const id = await submitAndTriage(
      'Structure fire spreading toward the eastern subdivision, multiple homes at risk.',
      fetchImpl,
    );

    const body: VerifyReportBody = { decision: 'VERIFIED', emitCap: true };
    const env = await verifyReport(id, body, fetchImpl);

    const emitted = env.meta?.emittedAlert as
      | { readonly id?: string; readonly capStatus?: string; readonly incidentId?: string }
      | undefined;
    expect(emitted).toBeDefined();
    expect(emitted?.id).toBeTruthy();
    // Scoped to the incident the reporter was looking at — proof the intake link is carried end to end and
    // that the alert is not attached to some arbitrary incident.
    expect(emitted?.incidentId).toBe(CA_INCIDENT);
    // Art. XIII: DRAFT only. A VERIFIED report may PROPOSE a public alert; only a separate authenticated
    // approval promotes it to ACTUAL. If this ever reads 'ACTUAL', the HITL gate has been bypassed.
    // `capStatus` (not `state`) is the alert's CAP lifecycle marker — see F-407.
    expect(emitted?.capStatus).toBe('DRAFT');
  });

  it('F-362 + Art. XIII: verifying WITHOUT emitCap emits nothing — the flag is the decision, not a formality', async () => {
    const fetchImpl = realServerFetch(deps());
    const id = await submitAndTriage(
      'Smoke visible over the ridge, no structures threatened yet.',
      fetchImpl,
    );

    const env = await verifyReport(id, { decision: 'VERIFIED' }, fetchImpl);
    expect(env.meta?.emittedAlert).toBeUndefined();
  });

  it(
    'F-362 + Art. XIII: a REJECTED report emits nothing even when emitCap is set — no outbound action ' +
      'from a report that was never verified',
    async () => {
      const fetchImpl = realServerFetch(deps());
      const id = await submitAndTriage(
        'Unconfirmed second-hand claim of a levee breach downstream.',
        fetchImpl,
      );

      const env = await verifyReport(id, { decision: 'REJECTED', emitCap: true }, fetchImpl);
      expect(env.meta?.emittedAlert).toBeUndefined();
    },
  );

  it(
    'F-362 + Art. XIII: an UNLINKED report drafts nothing and SAYS SO — an unattached alert is never ' +
      'invented to make the control appear to work',
    async () => {
      const fetchImpl = realServerFetch(deps());
      useUiStore.getState().setRole('PUBLIC');
      // No incidentId: a citizen may report before any incident exists. That is a real state, not an error.
      const submitted = await submitReport(
        {
          consent: true,
          text: 'Water rising fast on the low road by the old mill crossing.',
          lat: SOS_LAT,
          lng: SOS_LON,
        },
        fetchImpl,
      );
      useUiStore.getState().setRole('VERIFIER');
      await verifyReport(submitted.data.id, { decision: 'TRIAGED' }, fetchImpl);

      const env = await verifyReport(
        submitted.data.id,
        { decision: 'VERIFIED', emitCap: true },
        fetchImpl,
      );
      expect(env.meta?.emittedAlert).toBeUndefined();
      // Art. XVI: the degraded rung is LABELLED, never a silent no-op the verifier would mistake for success.
      expect(env.meta?.capNotEmitted).toContain('not linked to an incident');
    },
  );
});
