// @vitest-environment happy-dom
// BEACON — TanStack Query hook smoke (E8·T-352). Mounts useStatus under a real QueryClientProvider with
// a stubbed global fetch (no network) and asserts it resolves the grounded envelope through to the hook.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { makeQueryClient } from './query-client.js';
import { queryKeys, regionInvalidationKeys, useStatus } from './hooks.js';
import type { Envelope } from '@/ports/interaction.js';
import type { RegionDelta, StatusData } from './types.js';

const statusEnvelope: Envelope<StatusData> = {
  data: {
    regionId: 'socal',
    sources: [{ sourceId: 'firms', mode: 'LIVE', freshness: '2026-07-07T12:00:00Z' }],
  },
  provenance: [{ sourceId: 'firms', mode: 'LIVE', fetchedAt: '2026-07-07T12:00:00Z' }],
  freshness: '2026-07-07T12:00:00Z',
};

function Wrapper({ children }: { children: ReactNode }): ReactNode {
  const qc = makeQueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useStatus', () => {
  it('resolves the status envelope via TanStack Query', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(statusEnvelope), { status: 200 }),
    );

    const { result } = renderHook(() => useStatus('socal'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.data.regionId).toBe('socal');
    expect(result.current.data?.provenance).toHaveLength(1);
    // Every fetch now carries the acting-role header (x-beacon-role) from the store (default PUBLIC).
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/status?regionId=socal', {
      headers: { 'x-beacon-role': 'PUBLIC' },
    });
  });
});

// ── The SSE → cache mapping (F-320) ───────────────────────────────────────────
// The transport is tested in sse.test.ts and the MOUNT is tested in app/page.test.tsx. This block pins the
// third piece: which query keys a given delta makes stale. It is deliberately a table — a wrong mapping is
// a COP that looks live while showing yesterday's answer, which no rendering test would catch.
const REGION = 'us-ca';
const delta = (type: string, entity = 'e-1'): RegionDelta => ({
  type,
  region: REGION,
  entity,
  at: '2026-07-05T22:00:00Z',
});

describe('regionInvalidationKeys', () => {
  it('sends an incident delta to the incident list, the map and that incident’s SitRep', () => {
    expect(regionInvalidationKeys(delta('incident.updated', 'inc-1'), REGION)).toEqual([
      queryKeys.incidents(REGION),
      queryKeys.mapScope(REGION),
      queryKeys.sitrep('inc-1'),
    ]);
  });

  it('scopes a SitRep delta to the named incident only', () => {
    expect(regionInvalidationKeys(delta('sitrep.synthesised', 'inc-2'), REGION)).toEqual([
      queryKeys.sitrep('inc-2'),
    ]);
  });

  it('falls back to the SitRep PREFIX when the delta names no entity', () => {
    expect(regionInvalidationKeys(delta('sitrep.synthesised', '*'), REGION)).toEqual([
      queryKeys.sitrepScope(),
    ]);
  });

  it('sends an exposure/prediction delta to the SitRep and the map, not to the queues', () => {
    expect(regionInvalidationKeys(delta('exposure.recomputed', 'inc-3'), REGION)).toEqual([
      queryKeys.sitrep('inc-3'),
      queryKeys.mapScope(REGION),
    ]);
    expect(regionInvalidationKeys(delta('prediction.derived', 'inc-3'), REGION)).toEqual([
      queryKeys.sitrep('inc-3'),
      queryKeys.mapScope(REGION),
    ]);
  });

  it('sends a report delta to the verifier queue and the reports layer', () => {
    expect(regionInvalidationKeys(delta('report.verified'), REGION)).toEqual([
      queryKeys.reportsScope(REGION),
      queryKeys.mapScope(REGION),
    ]);
  });

  it('sends an alert delta to the DRAFT queue only', () => {
    expect(regionInvalidationKeys(delta('alert.drafted'), REGION)).toEqual([
      queryKeys.alertsScope(REGION),
    ]);
  });

  it('sends a resource/task delta to every role’s resource list and the pre-positioning advice', () => {
    const expected = [queryKeys.resourcesAll(), queryKeys.prePositioningAll()];
    expect(regionInvalidationKeys(delta('resource.updated'), REGION)).toEqual(expected);
    expect(regionInvalidationKeys(delta('task.advanced'), REGION)).toEqual(expected);
  });

  it('sends a source/status delta to the monitor reads', () => {
    const expected = [queryKeys.status(REGION), queryKeys.sources(REGION)];
    expect(regionInvalidationKeys(delta('source.degraded'), REGION)).toEqual(expected);
    expect(regionInvalidationKeys(delta('status.changed'), REGION)).toEqual(expected);
  });

  it('refetches the whole region read set for a polling tick AND for an unknown type', () => {
    const readSet = [
      queryKeys.status(REGION),
      queryKeys.incidents(REGION),
      queryKeys.sources(REGION),
      queryKeys.reportsScope(REGION),
      queryKeys.alertsScope(REGION),
      queryKeys.mapScope(REGION),
      queryKeys.sitrepScope(),
      queryKeys.resourcesAll(),
      queryKeys.prePositioningAll(),
    ];
    expect(regionInvalidationKeys(delta('poll', '*'), REGION)).toEqual(readSet);
    // A vocabulary this client has never seen must refresh MORE, never be dropped on the floor.
    expect(regionInvalidationKeys(delta('something.brand.new'), REGION)).toEqual(readSet);
  });

  it('matches the delta kind case-insensitively on the leading segment', () => {
    expect(regionInvalidationKeys(delta('ALERT.Drafted'), REGION)).toEqual([
      queryKeys.alertsScope(REGION),
    ]);
  });
});
