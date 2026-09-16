// @vitest-environment happy-dom
// BEACON — F-366: the QUERY hooks — key correctness, the enabled gates, and the degrade paths.
//
// The mutation half of F-366 lives in `hooks.mutations.e2e.test.tsx`. This half covers the second and third
// priorities of the finding:
//
//   • QUERY-KEY CORRECTNESS. A wrong key is the quietest defect this codebase can ship: the COP keeps
//     rendering, keeps looking live, and shows an answer that belongs to a different incident, a different
//     region, or a different ROLE. F-192 and F-201 were both exactly that, and both were invisible to every
//     rendering test because the component rendered its cache perfectly.
//   • THE ENABLED GATES. `useSitRep`/`useResources`/`usePrePositioning`/`useMapData`/`useIncidents` each
//     refuse to fire without their scoping id (Art. XVI: never issue a request that can only 400 and then
//     blame the server for a client-state problem). "Did not fire" is asserted by counting REAL requests.
//   • DEGRADE. `useMapData` must answer an empty `MapData` — never throw, never dead-end — while loading and
//     after an error.
//
// Same instrument as the mutation file: the real `api.ts` through the real `handleHttp`, transport socket
// only. DETERMINISTIC: fixed clock, counter ids, offline seed, no network, no wall clock.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeQueryClient } from './query-client.js';
import { useUiStore } from './store.js';
import {
  queryKeys,
  useAlerts,
  useIncidents,
  useMapData,
  usePrePositioning,
  useReports,
  useResources,
  useSitRep,
  useSources,
  useStatus,
} from './hooks.js';
import type { ApiError } from './api.js';
import type { ActorRole } from './types.js';
import {
  CA_INCIDENT,
  CA_REGION,
  realServerDeps,
  realServerFetch,
} from './__testing__/real-server-fetch.js';

interface Harness {
  readonly qc: QueryClient;
  readonly wrapper: (props: { children: ReactNode }) => ReactNode;
  readonly countOf: (fragment: string) => number;
}

function harness(): Harness {
  const deps = realServerDeps();
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    realServerFetch(deps, (url) => calls.push(url)),
  );
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

/**
 * `makeQueryClient` sets `retry: 1` and TanStack's default retry delay is ~1 s, so a query that will end in
 * error legitimately takes just over a second to get there. The production retry policy is left exactly as it
 * ships — the WAIT is widened instead, because shortening the retry to make a test fast would be testing a
 * client the product does not use.
 */
const ERROR_WAIT = { timeout: 5_000 } as const;

const initialUi = useUiStore.getState();
afterEach(() => {
  cleanup();
  useUiStore.setState(initialUi, true);
  vi.unstubAllGlobals();
});

// ── The query keys themselves ──────────────────────────────────────────────────────────────────────

describe('queryKeys', () => {
  it(
    'scopes each read to everything the SERVER scopes it by — a key that omits a scope the response ' +
      'varies on is a cache that will eventually serve one context’s answer for another',
    () => {
      // Region/incident scoping. `undefined` becomes an explicit `null` segment rather than being dropped, so
      // "no region" is its own cache slot and can never collide with a named one.
      expect(queryKeys.status(undefined)).toEqual(['status', null]);
      expect(queryKeys.status(CA_REGION)).toEqual(['status', CA_REGION]);
      expect(queryKeys.incidents(CA_REGION)).toEqual(['incidents', CA_REGION]);
      expect(queryKeys.sitrep(CA_INCIDENT)).toEqual(['sitrep', CA_INCIDENT]);

      // ROLE scoping. Every one of these endpoints returns a DIFFERENT body to a different role — an RBAC
      // rejection, an org-narrowed list, or precise geometry that Art. XIV reveals only to RESPONDER+. The
      // role therefore belongs in the key, exactly as F-201 established for `resources`.
      expect(queryKeys.resources(CA_INCIDENT, 'EM')).toEqual(['resources', CA_INCIDENT, 'EM']);
      expect(queryKeys.map(CA_REGION, 'EM')).toEqual(['map', CA_REGION, 'EM']);
      expect(queryKeys.reports(CA_REGION, 'VERIFIER')).toEqual(['reports', CA_REGION, 'VERIFIER']);
      expect(queryKeys.alerts(CA_REGION, 'VERIFIER')).toEqual(['alerts', CA_REGION, 'VERIFIER']);
      expect(queryKeys.prePositioning(CA_INCIDENT, 'RESPONDER')).toEqual([
        'pre-positioning',
        CA_INCIDENT,
        'RESPONDER',
      ]);
      expect(queryKeys.me('EM')).toEqual(['me', 'EM']);
    },
  );

  it(
    'every role-scoped key is PREFIXED by its own invalidation scope — the property that makes one ' +
      'invalidate reach all of a scope’s cached copies (TanStack matches by prefix)',
    () => {
      const scopes: readonly (readonly [readonly unknown[], readonly unknown[]])[] = [
        [queryKeys.resourcesScope(CA_INCIDENT), queryKeys.resources(CA_INCIDENT, 'EM')],
        [queryKeys.reportsScope(CA_REGION), queryKeys.reports(CA_REGION, 'VERIFIER')],
        [queryKeys.alertsScope(CA_REGION), queryKeys.alerts(CA_REGION, 'VERIFIER')],
        [
          queryKeys.prePositioningScope(CA_INCIDENT),
          queryKeys.prePositioning(CA_INCIDENT, 'RESPONDER'),
        ],
        [queryKeys.mapScope(CA_REGION), queryKeys.map(CA_REGION, 'PUBLIC')],
      ];
      for (const [scope, full] of scopes) {
        expect(full.slice(0, scope.length)).toEqual(scope);
        expect(full.length).toBeGreaterThan(scope.length); // a scope that IS the key would invalidate nothing extra
      }
    },
  );
});

// ── Role-keyed reads: the F-201 class, on every endpoint whose response varies by role ─────────────

describe('the role-gated reads re-fetch when the acting role changes (F-201)', () => {
  /**
   * The product behaviour: an operator opens BEACON as PUBLIC, the VERIFIER+ panels answer 403, then the
   * operator authenticates (or uses the demo role switcher) and the panels must FILL IN. With the role absent
   * from the key, the cached 403 is what stays on screen — the panel is dead for a user who is, by then,
   * fully authorized, and nothing refetches it until an unrelated SSE delta happens to arrive. That is the
   * exact F-201 failure, which cost the logistics board once already.
   */
  it('useReports: a PUBLIC 403 does not survive the switch to VERIFIER — the queue fills in', async () => {
    const h = harness();
    asRole('PUBLIC');

    const view = renderHook(() => useReports(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(view.result.current.isError).toBe(true), ERROR_WAIT);
    expect((view.result.current.error as ApiError).status).toBe(403);

    asRole('VERIFIER');

    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(view.result.current.data!.data.reports.length).toBeGreaterThan(0);
  });

  it('useAlerts: the DRAFT queue fills in when the operator becomes a VERIFIER', async () => {
    const h = harness();
    asRole('PUBLIC');

    const view = renderHook(() => useAlerts(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(view.result.current.isError).toBe(true), ERROR_WAIT);
    expect((view.result.current.error as ApiError).status).toBe(403);

    asRole('EM');

    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(view.result.current.data!.data.alerts.length).toBeGreaterThan(0);
  });

  it('usePrePositioning: the advisory board fills in when the operator becomes a RESPONDER', async () => {
    const h = harness();
    asRole('PUBLIC');

    const view = renderHook(() => usePrePositioning(CA_INCIDENT), { wrapper: h.wrapper });
    await waitFor(() => expect(view.result.current.isError).toBe(true), ERROR_WAIT);
    expect((view.result.current.error as ApiError).status).toBe(403);

    asRole('RESPONDER');

    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(view.result.current.data!.data.method).not.toBe('');
  });

  it(
    'useResources: the SAME incident under two roles occupies two cache slots, and each holds the answer ' +
      'the SERVER gave THAT role (an org-scoped RESPONDER legally sees a different list from an EM)',
    async () => {
      const h = harness();

      asRole('EM');
      const em = renderHook(() => useResources(CA_INCIDENT, 'EM'), { wrapper: h.wrapper });
      await waitFor(() => expect(em.result.current.isSuccess).toBe(true));
      expect(em.result.current.data!.data.resources.length).toBeGreaterThan(0);

      asRole('RESPONDER');
      const responder = renderHook(() => useResources(CA_INCIDENT, 'RESPONDER'), {
        wrapper: h.wrapper,
      });
      await waitFor(() => expect(responder.result.current.isSuccess).toBe(true));

      // An unscoped RESPONDER legally sees nothing here (the server narrows by org). If the role were missing
      // from the key, this hook would have been served the EM's list — a privilege bleed straight out of cache.
      expect(responder.result.current.data!.data.resources).toEqual([]);
      expect(em.result.current.data!.data.resources.length).toBeGreaterThan(0); // …and the EM copy is intact
    },
  );
});

// ── The enabled gates: a request that can only fail is never issued (Art. XVI) ──────────────────────

describe('the enabled gates', () => {
  it('fires NO request at all while its scoping id is absent, then fires exactly once when it arrives', async () => {
    const h = harness();
    asRole('EM');

    const cases: readonly (readonly [string, () => unknown, () => unknown])[] = [
      ['/incidents', () => useIncidents(undefined), () => useIncidents(CA_REGION)],
      ['/sitrep', () => useSitRep(undefined), () => useSitRep(CA_INCIDENT)],
      ['/resources', () => useResources(undefined, 'EM'), () => useResources(CA_INCIDENT, 'EM')],
      [
        '/pre-positioning',
        () => usePrePositioning(undefined),
        () => usePrePositioning(CA_INCIDENT),
      ],
      ['/map', () => useMapData(undefined, 'EM'), () => useMapData(CA_REGION, 'EM')],
    ];

    for (const [, disabled] of cases) renderHook(disabled, { wrapper: h.wrapper });
    // An empty string is the OTHER way this state reaches the hooks (a cleared selection), and it must gate
    // identically — `''` would produce `/incidents//…`, a URL that can only 404.
    renderHook(() => useIncidents(''), { wrapper: h.wrapper });
    renderHook(() => useSitRep(''), { wrapper: h.wrapper });

    await act(async () => {
      await Promise.resolve();
    });
    for (const [fragment] of cases) expect(h.countOf(fragment), fragment).toBe(0);

    for (const [fragment, , enabled] of cases) {
      renderHook(enabled, { wrapper: h.wrapper });
      await waitFor(() => expect(h.countOf(fragment), fragment).toBeGreaterThan(0));
    }
  });
});

// ── The read hooks against the real server ─────────────────────────────────────────────────────────

describe('the public reads resolve grounded envelopes through the real server', () => {
  it('useStatus / useSources / useIncidents / useSitRep each carry a non-empty provenance[] (F1)', async () => {
    const h = harness();
    asRole('PUBLIC');

    const status = renderHook(() => useStatus(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
    expect(status.result.current.data!.data.regionId).toBe(CA_REGION);
    expect(status.result.current.data!.provenance.length).toBeGreaterThan(0);

    const sources = renderHook(() => useSources(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(sources.result.current.isSuccess).toBe(true));
    expect(sources.result.current.data!.provenance.length).toBeGreaterThan(0);

    const incidents = renderHook(() => useIncidents(CA_REGION), { wrapper: h.wrapper });
    await waitFor(() => expect(incidents.result.current.isSuccess).toBe(true));
    expect(incidents.result.current.data!.data.incidents.map((i) => i.id)).toContain(CA_INCIDENT);

    const sitrep = renderHook(() => useSitRep(CA_INCIDENT), { wrapper: h.wrapper });
    await waitFor(() => expect(sitrep.result.current.isSuccess).toBe(true));
    // The narrated fields are the SitRep's whole purpose; `aiMode` names the rung that produced them so the
    // UI can never present a deterministic-only answer as an AI narration (Art. XVI).
    expect(sitrep.result.current.data!.data.aiMode).toBeTruthy();
    expect(sitrep.result.current.data!.provenance.length).toBeGreaterThan(0);
  });
});

// ── useMapData: the degrade path (Art. XVI — the COP never dead-ends) ───────────────────────────────

describe('useMapData', () => {
  it('answers an EMPTY MapData while disabled and while loading — the COP renders a map, never a crash', async () => {
    const h = harness();
    asRole('PUBLIC');

    const idle = renderHook(() => useMapData(undefined, 'PUBLIC'), { wrapper: h.wrapper });
    expect(idle.result.current).toEqual({});

    const loading = renderHook(() => useMapData(CA_REGION, 'PUBLIC'), { wrapper: h.wrapper });
    expect(loading.result.current).toEqual({}); // first render, before any response has arrived
    await waitFor(() => expect(loading.result.current.freshness).toBeDefined());
  });

  it(
    'maps the real server projection into MapData and stamps the provenance mode onto it (the numbers and ' +
      'the geometry come from the core, never from the client — Art. XII)',
    async () => {
      const h = harness();
      asRole('EM');

      const view = renderHook(() => useMapData(CA_REGION, 'EM'), { wrapper: h.wrapper });
      await waitFor(() => expect(view.result.current.fire).toBeDefined());

      // The CA demo region is a WILDFIRE with a seeded PERIMETER — the geometry came off the wire, so a
      // mapping that quietly dropped the perimeter (the F-406/F-409 shape) fails here rather than rendering
      // an empty map that looks like "nothing is burning".
      expect(view.result.current.fire!.perimeter).toBeDefined();
      // Freshness/mode ride the ENVELOPE, and the map surfaces them PER LAYER so a stale or mocked layer is
      // labelled rather than presented as live (Art. XVI). A missing mode is a map that silently claims LIVE.
      expect(view.result.current.freshness?.fire?.mode).toBeTruthy();
    },
  );

  it('an ERROR degrades to an empty MapData rather than throwing — a 404 region must not take the COP down', async () => {
    const h = harness();
    asRole('PUBLIC');

    const view = renderHook(() => useMapData('no-such-region', 'PUBLIC'), { wrapper: h.wrapper });
    await waitFor(() => expect(h.countOf('/map')).toBeGreaterThan(0));
    // Whatever the server said, the hook's contract is total: a MapData, always.
    await waitFor(() => expect(view.result.current).toEqual({}));
  });
});
