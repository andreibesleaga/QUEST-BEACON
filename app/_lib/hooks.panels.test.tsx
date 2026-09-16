// @vitest-environment happy-dom
// BEACON — the five dock-panel query hooks (S3·U1/U2) over the REAL server transport (F-366 instrument:
// the only thing stubbed is the fetch socket; request bytes and response bytes are the production ones).
//
// Three properties per hook, the same three the F-201/F-366 class demands:
//   • ROLE-KEYED: all five endpoints 403 below RESPONDER, so a PUBLIC 403 must not survive the switch to
//     RESPONDER — the panel fills in for a now-authorized operator instead of keeping a cached rejection.
//   • ENABLED GATE: `enabled=false` (the panel's display gate) issues NO request at all — a query whose
//     only possible answer is the flag-off 404 is never fired (Art. XVI).
//   • GROUNDED: every success carries a non-empty provenance[] (F1) — enforced by fetchEnvelope, proven
//     here against the real dispatcher output.
// DETERMINISTIC: fixed clock, counter ids, offline seed, no network, no wall clock.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeQueryClient } from './query-client.js';
import { useUiStore } from './store.js';
import {
  queryKeys,
  useDamageReports,
  useEmsOverlay,
  useShelterStatus,
  useSupplies,
  useVolunteerTeams,
} from './hooks.js';
import type { ApiError } from './api.js';
import type { ActorRole } from './types.js';
import { realServerDeps, realServerFetch } from './__testing__/real-server-fetch.js';

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

/** Switch the acting principal inside act — the hooks subscribe to this store (see hooks.queries.test.tsx). */
function asRole(role: ActorRole): void {
  act(() => {
    useUiStore.getState().setRole(role);
  });
}

/** Widened error wait: makeQueryClient retries once with TanStack's ~1 s default delay (production policy). */
const ERROR_WAIT = { timeout: 5_000 } as const;

const initialUi = useUiStore.getState();
afterEach(() => {
  cleanup();
  useUiStore.setState(initialUi, true);
  vi.unstubAllGlobals();
});

describe('the dock-panel query keys are ROLE-scoped (the F-201/F-366 rule)', () => {
  it('names the role — the one scope all five responses vary on', () => {
    expect(queryKeys.supplies('RESPONDER')).toEqual(['supplies', 'RESPONDER']);
    expect(queryKeys.volunteerTeams('RESPONDER')).toEqual(['volunteer-teams', 'RESPONDER']);
    expect(queryKeys.shelterStatus('EM')).toEqual(['shelter-status', 'EM']);
    expect(queryKeys.damageReports('RESPONDER')).toEqual(['damage-reports', 'RESPONDER']);
    expect(queryKeys.emsOverlay('PUBLIC')).toEqual(['ems-overlay', 'PUBLIC']);
  });
});

describe('a PUBLIC 403 does not survive the switch to RESPONDER — every panel fills in (F-201)', () => {
  // One loop-friendly row per hook: [route fragment, hook, a data probe proving the REAL payload arrived].
  const CASES = [
    ['/supplies', useSupplies, (d: unknown) => (d as { supplies: unknown[] }).supplies.length > 0],
    [
      '/volunteer-teams',
      useVolunteerTeams,
      (d: unknown) => (d as { teams: unknown[] }).teams.length > 0,
    ],
    [
      '/shelter-status',
      useShelterStatus,
      (d: unknown) => (d as { board: { rows: unknown[] } }).board.rows.length > 0,
    ],
    [
      '/damage-reports',
      useDamageReports,
      (d: unknown) =>
        (d as { assessment: { verified: { entries: number } } }).assessment.verified.entries > 0,
    ],
    [
      '/ems-overlay',
      useEmsOverlay,
      (d: unknown) => (d as { overlay: { products: unknown[] } }).overlay.products.length > 0,
    ],
  ] as const;

  for (const [fragment, useHook, probe] of CASES) {
    it(`${fragment}: 403 as PUBLIC, then a grounded envelope as RESPONDER`, async () => {
      const h = harness();
      asRole('PUBLIC');

      const view = renderHook(() => useHook(), { wrapper: h.wrapper });
      await waitFor(() => expect(view.result.current.isError).toBe(true), ERROR_WAIT);
      expect((view.result.current.error as ApiError).status).toBe(403);

      asRole('RESPONDER');

      await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
      expect(view.result.current.data!.provenance.length).toBeGreaterThan(0); // F1
      expect(probe(view.result.current.data!.data)).toBe(true);
    });
  }
});

describe('the enabled gate (the panel display flag doubles as the query gate)', () => {
  it('enabled=false fires NO request on any of the five; enabling fires exactly the expected route', async () => {
    const h = harness();
    asRole('RESPONDER');

    renderHook(() => useSupplies(false), { wrapper: h.wrapper });
    renderHook(() => useVolunteerTeams(false), { wrapper: h.wrapper });
    renderHook(() => useShelterStatus(false), { wrapper: h.wrapper });
    renderHook(() => useDamageReports(false), { wrapper: h.wrapper });
    renderHook(() => useEmsOverlay(false), { wrapper: h.wrapper });

    await act(async () => {
      await Promise.resolve();
    });
    for (const fragment of [
      '/supplies',
      '/volunteer-teams',
      '/shelter-status',
      '/damage-reports',
      '/ems-overlay',
    ]) {
      expect(h.countOf(fragment), fragment).toBe(0);
    }

    renderHook(() => useSupplies(true), { wrapper: h.wrapper });
    await waitFor(() => expect(h.countOf('/supplies')).toBeGreaterThan(0));
  });
});
