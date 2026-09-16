// @vitest-environment happy-dom
// BEACON — COP page realtime-wiring acceptance (F-320). The finding was NOT "the SSE client is wrong" —
// `_lib/sse.ts` worked and had passing tests. The finding was that NOTHING MOUNTED IT: the only importer
// was its own test, so the shipped COP never refreshed after first load. A test that calls the hook
// directly would reproduce that defect exactly, so this file renders the REAL page component and drives it
// through the REAL EventSource seam (a fake constructor installed on globalThis, the same lookup the
// browser code performs). Delete the `<RegionStream/>` line from page.tsx and every assertion below fails.
//
// Determinism: no network (fetch is a routed stub), no real timers (the polling fallback runs on injected
// fake timers), no wall clock (FIXED_NOW). The real MapLibre/deck.gl engine is mocked to throw so the map
// takes its labelled no-WebGL fallback instead of pulling the GL bundle into the module graph.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeQueryClient } from './_lib/query-client.js';
import { useUiStore, DEFAULT_REGION_ID } from './_lib/store.js';
import type { EventSourceLike, MessageEventLike } from './_lib/sse.js';
import CopPage from './page.js';

// The toolbar's LocaleSwitcher calls next/navigation's useRouter, which throws outside an App Router tree.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock('./_components/map/map-engine.js', () => ({
  createMapEngine: () => {
    throw new Error('no WebGL in a unit test');
  },
}));

const FIXED_NOW = '2026-07-05T22:00:00Z';
const INCIDENT_ID = 'inc-1';

// ── The EventSource seam ──────────────────────────────────────────────────────
// `subscribeRegionStream` resolves `globalThis.EventSource` when no impl is injected — which is precisely
// what the mounted component does. Installing a fake here exercises that production path end to end.
class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  readonly url: string;
  private readonly listeners = new Map<string, (ev: MessageEventLike) => void>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (ev: MessageEventLike) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    this.listeners.get(type)?.({ data });
  }
}

function openStream(): FakeEventSource {
  const es = FakeEventSource.instances.at(-1);
  if (es === undefined) throw new Error('no EventSource was opened — the stream is not mounted');
  return es;
}

// ── The REST seam ─────────────────────────────────────────────────────────────
const PROVENANCE = [{ sourceId: 'firms', mode: 'LIVE' as const, fetchedAt: FIXED_NOW }];

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, provenance: PROVENANCE, freshness: FIXED_NOW }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const EMPTY_MAP = {
  regionId: DEFAULT_REGION_ID,
  incidentType: 'WILDFIRE',
  hazards: [],
  gauges: [],
  infrastructure: [],
  exposure: [],
  shelters: [],
  reports: [],
  predictions: [],
};

/** Every GET the COP makes, FIRST match wins (so `/sitrep` is matched before the `/incidents` prefix). */
const ROUTES: ReadonlyArray<readonly [string, unknown]> = [
  ['/sitrep', { incidentId: INCIDENT_ID, fields: [], priorities: [], aiMode: 'DETERMINISTIC' }],
  [
    '/incidents',
    {
      regionId: DEFAULT_REGION_ID,
      incidents: [{ id: INCIDENT_ID, type: 'WILDFIRE', status: 'ACTIVE', headline: 'Demo fire' }],
    },
  ],
  ['/map', EMPTY_MAP],
  ['/reports', { reports: [] }],
  ['/alerts', { alerts: [] }],
  ['/resources', { resources: [] }],
  ['/pre-positioning', { method: 'nearest', extentAvailable: false, suggestions: [] }],
  ['/sources', { sources: [] }],
  ['/status', { regionId: DEFAULT_REGION_ID, sources: [] }],
];

/** Anything unrouted still answers a GROUNDED envelope — a bare `{}` would trip the F1 provenance guard. */
function routeFetch(url: string): Response {
  return envelope(ROUTES.find(([fragment]) => url.includes(fragment))?.[1] ?? {});
}

let calls: string[] = [];

function countOf(fragment: string): number {
  return calls.filter((u) => u.includes(fragment)).length;
}

function renderCop(): void {
  const qc = makeQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<CopPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  calls = [];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  useUiStore.setState({
    activeRegionId: DEFAULT_REGION_ID,
    selectedIncidentId: undefined,
    actorRole: 'PUBLIC',
    authToken: undefined,
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return Promise.resolve(routeFetch(url));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (globalThis as { EventSource?: unknown }).EventSource;
});

describe('COP page — region delta channel is MOUNTED (F-320)', () => {
  it('opens the region-keyed stream for the active region on first render', async () => {
    renderCop();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(openStream().url).toBe(`/api/v1/stream?regionId=${DEFAULT_REGION_ID}&role=PUBLIC`);
    expect(screen.getByTestId('region-stream')).toHaveAttribute('data-transport', 'sse');
  });

  it('refetches the named entity over REST when a delta arrives (Art. XII: the delta carries no data)', async () => {
    renderCop();
    await waitFor(() => expect(countOf('/incidents')).toBeGreaterThan(0));
    await waitFor(() => expect(countOf('/map')).toBeGreaterThan(0));
    const incidentsBefore = countOf(`/regions/${DEFAULT_REGION_ID}/incidents`);
    const mapBefore = countOf(`/regions/${DEFAULT_REGION_ID}/map`);

    act(() =>
      openStream().emit(
        'delta',
        JSON.stringify({
          type: 'incident.updated',
          region: DEFAULT_REGION_ID,
          entity: INCIDENT_ID,
          at: FIXED_NOW,
        }),
      ),
    );

    // The COP refreshed itself: both region-scoped reads were re-issued against the REST API, which is
    // where provenance[]/freshness/RBAC live. Nothing was read OUT of the delta frame.
    await waitFor(() =>
      expect(countOf(`/regions/${DEFAULT_REGION_ID}/incidents`)).toBeGreaterThan(incidentsBefore),
    );
    await waitFor(() =>
      expect(countOf(`/regions/${DEFAULT_REGION_ID}/map`)).toBeGreaterThan(mapBefore),
    );
  });

  it('routes a report delta to the verifier queue read, not to every query', async () => {
    renderCop();
    await waitFor(() => expect(countOf('/reports')).toBeGreaterThan(0));
    // The SitRep read only fires once an incident is auto-selected — settle it BEFORE the baseline, or the
    // assertion below would be a race rather than a statement about invalidation scope.
    await waitFor(() => expect(countOf('/sitrep')).toBeGreaterThan(0));
    const reportsBefore = countOf('/reports');
    const sitrepBefore = countOf('/sitrep');

    act(() =>
      openStream().emit(
        'delta',
        JSON.stringify({
          type: 'report.verified',
          region: DEFAULT_REGION_ID,
          entity: 'rep-9',
          at: FIXED_NOW,
        }),
      ),
    );

    await waitFor(() => expect(countOf('/reports')).toBeGreaterThan(reportsBefore));
    expect(countOf('/sitrep')).toBe(sitrepBefore); // precise invalidation, not a blanket refetch
  });

  it('ignores a delta for another region (cross-region isolation, THREAT T13.1)', async () => {
    renderCop();
    await waitFor(() => expect(countOf('/incidents')).toBeGreaterThan(0));
    const before = calls.length;

    act(() =>
      openStream().emit(
        'delta',
        JSON.stringify({
          type: 'incident.updated',
          region: 'ro',
          entity: 'other-1',
          at: FIXED_NOW,
        }),
      ),
    );

    await Promise.resolve();
    expect(calls.length).toBe(before);
  });

  it('degrades to labelled polling when the stream drops, and the polling tick still refetches (Art. XVI)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderCop();
    await waitFor(() => expect(countOf('/incidents')).toBeGreaterThan(0));
    const before = countOf(`/regions/${DEFAULT_REGION_ID}/incidents`);

    act(() => openStream().onerror?.({ kind: 'drop' }));

    // Labelled, not silent — and never a dead-end: the ladder moved to its next rung.
    await waitFor(() =>
      expect(screen.getByTestId('region-stream')).toHaveAttribute('data-transport', 'polling'),
    );
    expect(openStream().closed).toBe(true);

    await vi.advanceTimersByTimeAsync(15_000);
    await waitFor(() =>
      expect(countOf(`/regions/${DEFAULT_REGION_ID}/incidents`)).toBeGreaterThan(before),
    );
  });

  it('re-subscribes to the new region when the operator switches regions', async () => {
    renderCop();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const first = openStream();

    act(() => useUiStore.getState().setRegion('ro'));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(first.closed).toBe(true);
    expect(openStream().url).toBe('/api/v1/stream?regionId=ro&role=PUBLIC');
  });
});

describe('COP page — shelter capacity widget is MOUNTED from map-projection data (FR-8)', () => {
  // The widget existed, was tested, and never rendered — page.tsx mounted LogisticsBoard without a
  // `shelters` prop (UNIMPLEMENTED_REGISTER row, closed 2026-08-08). This test pins the WIRING, not the
  // widget: the served map projection's shelter slice must reach the board as capacity rows, with the
  // projection's `demand` carried as `occupancy` (map-projection.ts:316 — same figure, renamed).
  it('renders capacity vs occupancy for a shelter served by GET /map', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/map')) {
        return Promise.resolve(
          envelope({
            ...EMPTY_MAP,
            shelters: [
              { id: 'sh-1', lat: 39.7, lon: -121.8, capacity: 100, demand: 40, status: 'OPEN' },
            ],
          }),
        );
      }
      return Promise.resolve(routeFetch(url));
    });

    renderCop();

    await waitFor(() => expect(screen.getByTestId('ratio-sh-1')).toHaveTextContent('40/100'));
  });

  it('drops a shelter row missing its figures instead of fabricating 0/0 (the F-409 defect)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/map')) {
        return Promise.resolve(
          envelope({
            ...EMPTY_MAP,
            shelters: [{ id: 'sh-bare', lat: 39.7, lon: -121.8, status: 'OPEN' }],
          }),
        );
      }
      return Promise.resolve(routeFetch(url));
    });

    renderCop();

    await waitFor(() => expect(countOf('/map')).toBeGreaterThan(0));
    expect(screen.queryByTestId('ratio-sh-bare')).not.toBeInTheDocument();
  });
});

describe('COP page — input-bearing dock tabs KEEP volatile state across tab switches (2026-08-25)', () => {
  it('a half-typed SOS report survives visiting another tab (forceMount, Radix would unmount by default)', async () => {
    const user = userEvent.setup();
    renderCop();

    // The report tab's form is force-mounted, so it exists (hidden) before its tab is ever opened.
    const form = await screen.findByTestId('sos-form');
    expect(form).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Report SOS' }));
    const text = screen.getByPlaceholderText('Describe the emergency and any immediate needs.');
    await user.type(text, 'Trapped near the east bridge');

    await user.click(screen.getByRole('tab', { name: 'Evac route' }));
    await user.click(screen.getByRole('tab', { name: 'Report SOS' }));

    // Before forceMount this came back EMPTY — the unmount destroyed a crisis operator's in-progress input.
    expect(
      screen.getByPlaceholderText('Describe the emergency and any immediate needs.'),
    ).toHaveValue('Trapped near the east bridge');
  });
});
