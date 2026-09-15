// BEACON — incident-detail + incident-exposure handler tests (E7·routes; register rows 14-15).
// DETERMINISTIC: fixed clock, counter ids, the offline DEFAULT_SEED + DEFAULT_MAP_SEED, no network.
// Asserts: the served record IS the core's IncidentView, the envelope contract (data + non-empty
// provenance + freshness), the 404 for an unknown id, the region-hint short-circuit, the Art. XIV
// precise-geometry gate on exposure, and the two failure paths (core error, absent COP source).
import { describe, it, expect } from 'vitest';
import {
  handleIncidentGet,
  handleIncidentExposure,
  regionOfIncidentId,
  type IncidentRoutesDeps,
} from './incidents.js';
import { buildInteraction } from '@/main/build-core.js';
import { makeMemoryMapReadModel } from '@/adapters/memory/memory-map.js';
import { DEFAULT_MAP_SEED } from '@/main/map-seed.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, RegionId } from '@/domain/value-objects/ids.js';
import type { Envelope } from '@/ports/interaction.js';
import type { InteractionPort } from '@/ports/interaction.js';
import type { MapReadModel } from '@/application/map-projection/map-projection.js';

const FIXED = '2026-07-05T22:00:00Z';
const CA = asId<IncidentId>('us-ca-wildfire-demo');
const RO = asId<IncidentId>('ro-flood-demo');

function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

function deps(overrides: Partial<IncidentRoutesDeps> = {}): IncidentRoutesDeps {
  return {
    interaction: buildInteraction({ clock: () => FIXED, newId: counterIds(), env: {} }),
    map: makeMemoryMapReadModel(DEFAULT_MAP_SEED),
    clock: () => FIXED,
    ...overrides,
  };
}

const envelope = (body: unknown): Envelope => body as Envelope;

describe('handleIncidentGet — GET /incidents/{id}', () => {
  it('serves the CA incident record with non-empty provenance + freshness (F1)', async () => {
    const res = await handleIncidentGet({ incidentId: CA, role: 'PUBLIC' }, deps());
    expect(res.status).toBe(200);
    const env = envelope(res.body);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.freshness).toBe(FIXED);
    const data = env.data as {
      id: string;
      regionId: string;
      type: string;
      headline: string;
      facts: unknown[];
      priorities: unknown[];
    };
    expect(data.id).toBe('us-ca-wildfire-demo');
    expect(data.regionId).toBe('us-ca');
    expect(data.type).toBe('WILDFIRE');
    expect(data.headline).toContain('Bear Ridge Fire');
    // The record IS the core's IncidentView — the engine-derived facts/priorities travel with it (Art. XII).
    expect(data.facts.length).toBeGreaterThan(0);
    expect(data.priorities.length).toBeGreaterThan(0);
  });

  it('finds an incident in a NON-default region by walking the registry (no regionId supplied)', async () => {
    const res = await handleIncidentGet({ incidentId: RO, role: 'PUBLIC' }, deps());
    expect(res.status).toBe(200);
    expect((envelope(res.body).data as { regionId: string }).regionId).toBe('ro');
  });

  it('honours the ?regionId= narrowing hint when it is the right region', async () => {
    const res = await handleIncidentGet(
      { incidentId: RO, role: 'PUBLIC', regionId: asId<RegionId>('ro') },
      deps(),
    );
    expect(res.status).toBe(200);
    expect((envelope(res.body).data as { id: string }).id).toBe('ro-flood-demo');
  });

  it('404s when the ?regionId= hint names a region that does not hold the incident', async () => {
    const res = await handleIncidentGet(
      { incidentId: RO, role: 'PUBLIC', regionId: asId<RegionId>('us-ca') },
      deps(),
    );
    expect(res.status).toBe(404);
    expect(envelope(res.body).errors?.[0]?.code).toBe('NOT_FOUND');
  });

  it('404s for an unknown incident id after searching every configured region', async () => {
    const res = await handleIncidentGet(
      { incidentId: asId<IncidentId>('nope'), role: 'PUBLIC' },
      deps(),
    );
    expect(res.status).toBe(404);
    expect(envelope(res.body).errors?.[0]?.message).toContain('nope');
  });

  it('is PUBLIC — the same rank the `incidents` verb carries — and serves an EM identically', async () => {
    const asPublic = await handleIncidentGet({ incidentId: CA, role: 'PUBLIC' }, deps());
    const asEm = await handleIncidentGet({ incidentId: CA, role: 'EM' }, deps());
    expect(asPublic.status).toBe(200);
    expect(asEm.status).toBe(200);
    expect((envelope(asEm.body).data as { id: string }).id).toBe('us-ca-wildfire-demo');
  });

  it('maps a core failure onto its HTTP status instead of throwing', async () => {
    const failing: InteractionPort = {
      handle: () => Promise.resolve(err(new DomainError('INVARIANT_VIOLATION', 'boom'))),
    };
    const res = await handleIncidentGet(
      { incidentId: CA, role: 'PUBLIC' },
      deps({ interaction: failing }),
    );
    expect(res.status).toBe(422);
    expect(envelope(res.body).errors?.[0]?.code).toBe('INVARIANT_VIOLATION');
  });

  it('backfills provenance rather than shipping an empty provenance[] (F1 has no exception)', async () => {
    // A core whose envelopes carry NO provenance — the one shape a data response may never have on the wire.
    const bare: InteractionPort = {
      handle: (request) =>
        Promise.resolve(
          ok(
            request.command.verb === 'regions'
              ? {
                  data: { regions: [{ id: asId<RegionId>('us-ca'), name: 'California (US)' }] },
                  provenance: [],
                }
              : {
                  data: {
                    regionId: 'us-ca',
                    incidents: [
                      {
                        id: CA,
                        regionId: asId<RegionId>('us-ca'),
                        type: 'WILDFIRE',
                        status: 'ACTIVE',
                        headline: 'x',
                        facts: [],
                        priorities: [],
                        provenance: [],
                      },
                    ],
                  },
                  provenance: [],
                },
          ),
        ),
    };
    const res = await handleIncidentGet(
      { incidentId: CA, role: 'PUBLIC' },
      deps({ interaction: bare }),
    );
    expect(res.status).toBe(200);
    expect(envelope(res.body).provenance).toEqual([
      { sourceId: 'incident-registry', mode: 'LIVE', fetchedAt: FIXED },
    ]);
    expect(envelope(res.body).freshness).toBe(FIXED);
  });
});

describe('handleIncidentExposure — GET /incidents/{id}/exposure', () => {
  it('serves the SAME exposure rows GET /regions/:id/map computes, with provenance + freshness', async () => {
    const res = await handleIncidentExposure({ incidentId: CA, role: 'PUBLIC' }, deps());
    expect(res.status).toBe(200);
    const env = envelope(res.body);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.freshness).toBe(FIXED);
    const data = env.data as {
      incidentId: string;
      regionId: string;
      exposure: readonly { id: string; insideHazard: boolean }[];
      count: number;
    };
    expect(data.incidentId).toBe('us-ca-wildfire-demo');
    expect(data.regionId).toBe('us-ca');
    expect(data.count).toBe(data.exposure.length);
    expect(data.count).toBeGreaterThan(0);
    expect(data.exposure.some((e) => e.insideHazard)).toBe(true);
  });

  // Art. XIV, stated as an assertion rather than assumed: an exposure row names an INFRASTRUCTURE NODE, not
  // a person, so it carries no `precisePosition` for ANY role and PUBLIC/RESPONDER see byte-identical rows.
  // If a role-gated field is ever added to the exposure projection, this test fails and the route's RBAC
  // note has to be revisited — which is the point of pinning both halves.
  it('exposes no per-role difference: exposure rows are assets (no PII), identical for PUBLIC and RESPONDER', async () => {
    const asPublic = await handleIncidentExposure({ incidentId: CA, role: 'PUBLIC' }, deps());
    const asResponder = await handleIncidentExposure({ incidentId: CA, role: 'RESPONDER' }, deps());
    const pub = (
      envelope(asPublic.body).data as { exposure: readonly { precisePosition?: unknown }[] }
    ).exposure;
    const resp = (
      envelope(asResponder.body).data as { exposure: readonly { precisePosition?: unknown }[] }
    ).exposure;
    expect(pub.every((e) => e.precisePosition === undefined)).toBe(true);
    expect(resp).toEqual(pub);
  });

  it('404s for an unknown incident id', async () => {
    const res = await handleIncidentExposure(
      { incidentId: asId<IncidentId>('nope'), role: 'PUBLIC' },
      deps(),
    );
    expect(res.status).toBe(404);
  });

  it('404s (naming region AND incident) when the incident resolves but its region carries no COP source', async () => {
    const empty: MapReadModel = { sourceFor: () => Promise.resolve(ok(null)) };
    const res = await handleIncidentExposure(
      { incidentId: CA, role: 'PUBLIC' },
      deps({ map: empty }),
    );
    expect(res.status).toBe(404);
    const message = envelope(res.body).errors?.[0]?.message ?? '';
    expect(message).toContain('us-ca');
    expect(message).toContain('us-ca-wildfire-demo');
  });

  it('maps a read-model failure to its HTTP status', async () => {
    const failing: MapReadModel = {
      sourceFor: () => Promise.resolve(err(new DomainError('INVARIANT_VIOLATION', 'boom'))),
    };
    const res = await handleIncidentExposure(
      { incidentId: CA, role: 'PUBLIC' },
      deps({ map: failing }),
    );
    expect(res.status).toBe(422);
  });

  it('maps a core failure to its HTTP status', async () => {
    const failing: InteractionPort = {
      handle: () => Promise.resolve(err(new DomainError('NOT_FOUND', 'no regions'))),
    };
    const res = await handleIncidentExposure(
      { incidentId: CA, role: 'PUBLIC' },
      deps({ interaction: failing }),
    );
    expect(res.status).toBe(404);
  });
});

// ── 2026-09-14: the region walk on a database whose region rows have no domain id ─────────────────────
//
// On the live deployment `/regions` answered with surrogate uuids (the seed had never backfilled
// `region.domain_id`), so the walk asked the memory core for incidents of a uuid region and found nothing:
// EVERY `GET /incidents/{id}` without a `?regionId=` hint was a 404. A discovered incident carries its
// region in its id; that region is searched first.
describe('handleIncidentGet — a discovered incident on a database with uuid-keyed regions', () => {
  const DISCOVERED = asId<IncidentId>('discovered:ro:WILDFIRE:102:182');
  const uuidRegions: InteractionPort = {
    handle: (request) =>
      Promise.resolve(
        ok(
          request.command.verb === 'regions'
            ? {
                data: {
                  regions: [
                    {
                      id: asId<RegionId>('00000000-0000-4000-8000-0000000000ca'),
                      name: 'California',
                    },
                    { id: asId<RegionId>('00000000-0000-4000-8000-0000000000e0'), name: 'Romania' },
                  ],
                },
                provenance: [{ sourceId: 'firms', mode: 'LIVE', fetchedAt: FIXED }],
              }
            : {
                data: {
                  regionId: request.command.verb === 'incidents' ? request.command.regionId : 'ro',
                  incidents:
                    request.command.verb === 'incidents' &&
                    String(request.command.regionId) === 'ro'
                      ? [
                          {
                            id: DISCOVERED,
                            regionId: asId<RegionId>('ro'),
                            type: 'WILDFIRE',
                            status: 'ACTIVE',
                            headline: 'Wildfire perimeter near 45.65°N 25.60°E',
                            facts: [],
                            priorities: [],
                            provenance: [{ sourceId: 'effis', mode: 'LIVE', fetchedAt: FIXED }],
                          },
                        ]
                      : [],
                },
                provenance: [{ sourceId: 'effis', mode: 'LIVE', fetchedAt: FIXED }],
              },
        ),
      ),
  };

  it('finds it by the region encoded in its id, with no hint, even though /regions lists only uuids', async () => {
    const res = await handleIncidentGet(
      { incidentId: DISCOVERED, role: 'PUBLIC' },
      deps({ interaction: uuidRegions }),
    );
    expect(res.status).toBe(200);
    expect((envelope(res.body).data as { id: string }).id).toBe(String(DISCOVERED));
  });

  it('regionOfIncidentId reads only the discovered shape', () => {
    expect(regionOfIncidentId('discovered:ro:WILDFIRE:102:182')).toBe('ro');
    expect(regionOfIncidentId('discovered:us-ca:FLOOD:-1:2')).toBe('us-ca');
    expect(regionOfIncidentId('us-ca-wildfire-demo')).toBeUndefined();
    expect(regionOfIncidentId('discovered:')).toBeUndefined();
  });
});
