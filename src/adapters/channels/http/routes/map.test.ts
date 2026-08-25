// BEACON — map HTTP handler tests (E7·map; SPEC §2.2, Art. XIV, F1). DETERMINISTIC: the memory MapReadModel
// over the DEFAULT_MAP_SEED, no clock/net. Asserts: 200 + non-empty provenance/freshness (F1), the precise-PII
// gate by role (Art. XIV), an unknown region → 404, and a failing read-model → mapped error.
import { describe, it, expect } from 'vitest';
import { handleMapProjection } from './map.js';
import { makeMemoryMapReadModel } from '@/adapters/memory/memory-map.js';
import { DEFAULT_MAP_SEED } from '@/main/map-seed.js';
import { err } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { RegionId } from '@/domain/value-objects/ids.js';
import type { MapReadModel } from '@/application/map-projection/map-projection.js';

const deps = { map: makeMemoryMapReadModel(DEFAULT_MAP_SEED) };
const region = (id: string): RegionId => asId<RegionId>(id);

describe('handleMapProjection — GET /regions/:id/map', () => {
  it('returns the CA wildfire projection with non-empty provenance + freshness (F1)', async () => {
    const res = await handleMapProjection({ regionId: region('us-ca'), role: 'PUBLIC' }, deps);
    expect(res.status).toBe(200);
    const body = res.body as unknown as { data: { incidentType: string; hazards: unknown[]; shelters: unknown[] }; provenance: unknown[]; freshness?: string };
    expect(body.data.incidentType).toBe('WILDFIRE');
    expect(body.data.hazards.length).toBeGreaterThan(0);
    expect(body.data.shelters.length).toBeGreaterThan(0);
    expect(body.provenance.length).toBeGreaterThan(0);
    expect(body.freshness).toBe('2026-07-05T22:00:00Z');
  });

  it('returns the RO flood projection (gauges present)', async () => {
    const res = await handleMapProjection({ regionId: region('ro'), role: 'PUBLIC' }, deps);
    const body = res.body as unknown as { data: { incidentType: string; gauges: unknown[] } };
    expect(body.data.incidentType).toBe('FLOOD');
    expect(body.data.gauges.length).toBeGreaterThan(0);
  });

  it('withholds precise report geometry from PUBLIC but reveals it to RESPONDER (Art. XIV)', async () => {
    const asPublic = await handleMapProjection({ regionId: region('us-ca'), role: 'PUBLIC' }, deps);
    const asResponder = await handleMapProjection({ regionId: region('us-ca'), role: 'RESPONDER' }, deps);
    const pub = (asPublic.body as unknown as { data: { reports: { precisePosition?: unknown }[] } }).data.reports[0];
    const resp = (asResponder.body as unknown as { data: { reports: { precisePosition?: readonly number[] }[] } }).data.reports[0];
    expect(pub?.precisePosition).toBeUndefined();
    // RESPONDER sees the ACTUAL precise coordinate from the seed (ca-report-1 geomPrecise) — a wrong-value
    // leak (e.g. the generalized [-121.55, 39.7]) would fail here, not just an absent-field check (Art. XIV).
    expect(resp?.precisePosition).toEqual([-121.552, 39.703]);
  });

  it('returns 404 for an unknown region', async () => {
    const res = await handleMapProjection({ regionId: region('atlantis'), role: 'PUBLIC' }, deps);
    expect(res.status).toBe(404);
    expect((res.body as unknown as { errors?: { code: string }[] }).errors?.[0]?.code).toBe('NOT_FOUND');
  });

  it('maps a read-model failure to its HTTP status', async () => {
    const failing: MapReadModel = { sourceFor: () => Promise.resolve(err(new DomainError('INVARIANT_VIOLATION', 'boom'))) };
    const res = await handleMapProjection({ regionId: region('us-ca'), role: 'PUBLIC' }, { map: failing });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((res.body as unknown as { errors?: { code: string }[] }).errors?.[0]?.code).toBe('INVARIANT_VIOLATION');
  });
});
