// BEACON — the RE-INGEST SEAM at the HTTP composition root (V2·A12).
//
// WHAT THIS FILE PINS DOWN, and why each half needs its own assertions:
//  • THE MEMOISATION SEAM. `getHttpDepsAsync` caches one PROMISE per server process, so "refresh the served
//    picture" means "replace that promise, in one statement". A reader that already holds the old promise
//    must keep resolving to the old COMPLETE deps — that is what makes the swap atomic rather than merely
//    fast.
//  • WHAT A REFRESH MAY REPLACE. Only the two halves derived from the LIVE SEEDS (the core interaction and
//    the map read-model). Everything STATEFUL is carried over by reference: replacing the event bus would
//    orphan every open SSE subscription (the doorbell would then ring on a bus nobody is listening to),
//    replacing the rate limiter would hand every caller a fresh token bucket on a schedule, and replacing
//    the report store would drop every citizen report filed since boot.
//  • THE DOORBELL. A refresh publishes the EXISTING delta vocabulary (`{type, region, entity, at}` on
//    `region:<id>:delta`), never a new frame type — so no subscriber needs to learn anything new and Art.
//    XII still holds: no figure travels, the client refetches over REST.
import type { Geometry } from '@/domain/value-objects/geo.js';
import { describe, expect, it, vi } from 'vitest';
import type { EventBusPort } from '@/ports/infra.js';
import type { StreamDelta } from './routes/stream.js';
import { MemoryReportStore, defaultReportQueueSeed } from '@/adapters/memory/memory-core.js';
import { DEFAULT_SEED } from '@/main/seed.js';
import { DEFAULT_MAP_SEED } from '@/main/map-seed.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, IncidentId, SourceId, ThresholdRuleId } from '@/domain/value-objects/ids.js';
import { streamTopic } from './routes/stream.js';
import {
  announceRefresh,
  createHttpDeps,
  getHttpDepsAsync,
  reingestedDeps,
  swapHttpDepsAsync,
  type ReingestContext,
  adoptLiveDrafts,
} from './http-dispatcher.js';

const T0 = '2026-07-05T22:00:00.000Z';
const clock = (): string => T0;
const counterIds = (): ((p: string) => string) => {
  let n = 0;
  return (p) => `${p}-${++n}`;
};

const SEEDS = { coreSeed: DEFAULT_SEED, mapSeed: DEFAULT_MAP_SEED };

function context(): ReingestContext {
  const newId = counterIds();
  return {
    options: {},
    clock,
    newId,
    reportStore: new MemoryReportStore(clock, newId, 30, defaultReportQueueSeed(T0)),
  };
}

/** An event bus that records every publish verbatim — the delta contract is asserted on what it captured. */
function recordingBus(): { bus: EventBusPort; published: { topic: string; delta: StreamDelta }[] } {
  const published: { topic: string; delta: StreamDelta }[] = [];
  const bus: EventBusPort = {
    publish: <E>(topic: string, event: E) => {
      published.push({ topic, delta: event as StreamDelta });
      return Promise.resolve({ ok: true, value: undefined } as never);
    },
    subscribe: () => ({ ok: true, value: () => undefined }) as never,
  };
  return { bus, published };
}

describe('swapHttpDepsAsync — the atomic memoisation swap', () => {
  it('installs the new picture, and a reader holding the OLD promise still gets the OLD complete deps', async () => {
    const boot = createHttpDeps();
    swapHttpDepsAsync(boot);
    const readerMidRefresh = getHttpDepsAsync(); // a request that resolved its deps before the swap landed

    const refreshed = createHttpDeps();
    swapHttpDepsAsync(refreshed);

    await expect(readerMidRefresh).resolves.toBe(boot); // old COMPLETE picture — never a mixture
    await expect(getHttpDepsAsync()).resolves.toBe(refreshed); // every later reader gets the new one
  });
});

describe('reingestedDeps — what a refresh replaces, and what it must not', () => {
  it('replaces ONLY the live-derived halves: the core interaction and the map read-model', () => {
    const previous = createHttpDeps();
    const next = reingestedDeps(SEEDS, previous, context());
    expect(next.interaction).not.toBe(previous.interaction);
    expect(next.features.map).not.toBe(previous.features.map);
  });

  it('carries every STATEFUL singleton over by reference — bus, limiter, reports, interop, logistics', () => {
    const previous = createHttpDeps();
    const next = reingestedDeps(SEEDS, previous, context());
    expect(next.features.eventBus).toBe(previous.features.eventBus); // open SSE subscriptions survive
    expect(next.rateLimiter).toBe(previous.rateLimiter); // a refresh is not a free token refill
    expect(next.reports).toBe(previous.reports); // reports filed since boot survive
    expect(next.features.interop).toBe(previous.features.interop); // approved alerts + subscribers survive
    expect(next.features.logistics).toBe(previous.features.logistics);
    expect(next.features.routing).toBe(previous.features.routing);
    expect(next.env).toBe(previous.env);
  });
});

describe('announceRefresh — the doorbell rings in the EXISTING delta vocabulary', () => {
  it('publishes one region-keyed delta per region in the refreshed picture, carrying no figure', async () => {
    const { bus, published } = recordingBus();
    const previous = createHttpDeps();
    const next = { ...previous, clock, features: { ...previous.features, eventBus: bus } };

    await announceRefresh(next, SEEDS);

    const regions = [...new Set(DEFAULT_SEED.incidents.map((i) => String(i.regionId)))];
    expect(published.map((p) => p.topic).sort()).toEqual(regions.map(streamTopic).sort());
    for (const { topic, delta } of published) {
      expect(topic).toBe(streamTopic(delta.region));
      // Exactly the four contract fields — a widened frame would be an Art. XII leak on a public channel.
      expect(Object.keys(delta).sort()).toEqual(['at', 'entity', 'region', 'type']);
      expect(delta.type).toBe('incident.updated');
      expect(delta.entity).toBe('*'); // '*' ⇒ refetch the whole region, the existing convention
      expect(delta.at).toBe(T0);
    }
  });

  it('never fails the refresh when a subscriber blows up (the mutation-delta posture, unchanged)', async () => {
    const previous = createHttpDeps();
    const exploding: EventBusPort = {
      publish: () => Promise.reject(new Error('bus is down')),
      subscribe: () => ({ ok: true, value: () => undefined }) as never,
    };
    const next = { ...previous, clock, features: { ...previous.features, eventBus: exploding } };
    await expect(announceRefresh(next, SEEDS)).resolves.toBeUndefined();
  });

  it('publishes nothing at all when the refreshed seed attributes no region — no map region, no incident', async () => {
    const { bus, published } = recordingBus();
    const previous = createHttpDeps();
    const next = { ...previous, clock, features: { ...previous.features, eventBus: bus } };
    await announceRefresh(next, { coreSeed: { ...DEFAULT_SEED, incidents: [] }, mapSeed: {} });
    expect(published).toEqual([]);
    expect(vi.isMockFunction(bus.publish)).toBe(false); // (the recorder is a plain closure, not a spy)
  });

  it('rings once per MAP region even when a region has no incident — a quiet live-only region is still refreshed (ADR-043)', async () => {
    const { bus, published } = recordingBus();
    const previous = createHttpDeps();
    const next = { ...previous, clock, features: { ...previous.features, eventBus: bus } };
    await announceRefresh(next, {
      coreSeed: { ...DEFAULT_SEED, incidents: [] },
      mapSeed: DEFAULT_MAP_SEED,
    });
    expect(published.length).toBe(Object.keys(DEFAULT_MAP_SEED).length);
  });
});

// ── ADR-044: live drafts are ADDED to the operators' alert store, never overwriting ──────────────────
describe('reingestedDeps — the seed-derived lookups follow the refreshed picture (Copilot, #37)', () => {
  const discovered = asId<IncidentId>('discovered:us-ca:WILDFIRE:-487:158');
  const tableRule = makeThresholdRule({
    id: asId<ThresholdRuleId>('operator-edited-rule'),
    target: 'HAZARD_BUFFER',
    operator: 'enters',
    value: '500m',
  });
  const footprint: Geometry = {
    type: 'Polygon',
    coordinates: [
      [
        [-121.7, 39.6],
        [-121.5, 39.6],
        [-121.5, 39.8],
        [-121.7, 39.8],
        [-121.7, 39.6],
      ],
    ],
  };
  const seeds = {
    coreSeed: { ...DEFAULT_SEED, incidents: [] },
    mapSeed: DEFAULT_MAP_SEED,
    overlay: {
      thresholds: [],
      thresholdRules: [tableRule],
      hazards: new Map([[String(discovered), footprint]]),
      incidentRegions: new Map([[String(discovered), 'us-ca']]),
      keepSeeded: false,
    },
  };

  it('lists the rules read this cycle and starts routes from the newly discovered footprint', () => {
    const previous = createHttpDeps();
    expect(
      previous.features.thresholdRules?.some((r) => String(r.id) === 'operator-edited-rule'),
    ).toBe(false);
    expect(previous.features.originFor?.(discovered)).toBeUndefined();
    const next = reingestedDeps(seeds, previous, context());
    expect(next.features.thresholdRules?.map((r) => String(r.id))).toEqual([
      'operator-edited-rule',
    ]);
    expect(next.features.originFor?.(discovered)).toEqual([-121.6, 39.7]);
    expect(next.features.projectedExtentFor?.(discovered)).toEqual(footprint);
    // The stateful singletons are still the previous ones (the contract above).
    expect(next.features.interop).toBe(previous.features.interop);
    expect(next.features.eventBus).toBe(previous.features.eventBus);
  });
});

describe('adoptLiveDrafts — the live specs’ drafts reach the alert store on reingest', () => {
  const NOW_ISO = '2026-09-14T10:00:00Z';
  const rule = makeThresholdRule({
    id: asId<ThresholdRuleId>('ca-hazard-buffer'),
    target: 'HAZARD_BUFFER',
    operator: 'enters',
    value: '2000',
  });
  const spec = {
    rule,
    reading: { hazardWithinBuffer: true },
    incidentId: asId<IncidentId>('discovered:us-ca:WILDFIRE:-487:158'),
    alertId: asId<AlertId>('live:ca-hazard-buffer:discovered:us-ca:WILDFIRE:-487:158'),
    category: 'Fire' as const,
    severity: 'SEVERE' as const,
    sourceId: asId<SourceId>('firms'),
  };
  const seeds = {
    coreSeed: { ...DEFAULT_SEED, incidents: [] },
    mapSeed: DEFAULT_MAP_SEED,
    overlay: {
      thresholds: [spec],
      thresholdRules: [rule],
      hazards: new Map(),
      incidentRegions: new Map([[String(spec.incidentId), 'us-ca']]),
      keepSeeded: false,
    },
  };

  it('saves a new DRAFT once, and leaves an existing alert with the same id untouched', async () => {
    const deps = { ...createHttpDeps(), clock: () => NOW_ISO };
    const before = (await deps.features.interop.alerts.list()).length;
    expect(await adoptLiveDrafts(deps, seeds)).toBe(1);
    const saved = await deps.features.interop.alerts.get(spec.alertId);
    expect(saved?.capStatus).toBe('DRAFT');
    expect(String(saved?.incidentId)).toBe(String(spec.incidentId));
    expect((await deps.features.interop.alerts.list()).length).toBe(before + 1);
    // A second adoption of the same firing changes nothing — the store, not the spec, owns that alert now.
    expect(await adoptLiveDrafts(deps, seeds)).toBe(0);
  });

  it('is a no-op without an overlay (hybrid picture)', async () => {
    const deps = { ...createHttpDeps(), clock: () => NOW_ISO };
    expect(await adoptLiveDrafts(deps, { coreSeed: seeds.coreSeed, mapSeed: seeds.mapSeed })).toBe(
      0,
    );
  });
});
