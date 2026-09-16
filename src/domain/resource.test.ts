// BEACON — RESOURCE invariant tests (E1·T-072). kind/status enums; optional geom Point.
import { describe, it, expect } from 'vitest';
import { makeResource, RESOURCE_KINDS, RESOURCE_STATUSES } from './resource.js';
import { asId } from './value-objects/ids.js';
import type { ResourceId, OrgId } from './value-objects/ids.js';
import type { PointGeometry } from './value-objects/geo.js';
import { InvariantViolation } from './errors.js';

const id = asId<ResourceId>('11111111-1111-1111-1111-111111111111');
const org = asId<OrgId>('org-1');
const point: PointGeometry = { type: 'Point', coordinates: [26.1, 44.4] };

describe('makeResource', () => {
  it('builds a valid resource and defaults status to AVAILABLE', () => {
    const r = makeResource({ id, kind: 'CREW' });
    expect(r.kind).toBe('CREW');
    expect(r.status).toBe('AVAILABLE');
    expect(r.orgId).toBeUndefined();
    expect(r.geom).toBeUndefined();
  });

  it('accepts every kind and status in the enum', () => {
    for (const kind of RESOURCE_KINDS) {
      for (const status of RESOURCE_STATUSES) {
        expect(makeResource({ id, kind, status }).status).toBe(status);
      }
    }
  });

  it('carries optional org and Point geometry when provided', () => {
    const r = makeResource({ id, kind: 'ENGINE', status: 'ASSIGNED', orgId: org, geom: point });
    expect(r.orgId).toBe(org);
    expect(r.geom).toEqual(point);
  });

  it('rejects a kind outside the enum', () => {
    expect(() => makeResource({ id, kind: 'TANK' as never })).toThrow(InvariantViolation);
  });

  it('rejects a status outside the enum', () => {
    expect(() => makeResource({ id, kind: 'CREW', status: 'BUSY' as never })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a geom that is not a valid Point', () => {
    const bad = { type: 'Polygon', coordinates: [] } as unknown as PointGeometry;
    expect(() => makeResource({ id, kind: 'CREW', geom: bad })).toThrow(InvariantViolation);
  });

  // ── FR-D6-1 (ADR-035 §4; finding F-171): a volunteer TEAM is a resource KIND, not a new entity. ──
  it('accepts the FR-D6-1 TEAM kind, so a volunteer team is a first-class resource', () => {
    const team = makeResource({ id, kind: 'TEAM', orgId: org, geom: point });
    expect(team.kind).toBe('TEAM');
    expect(team.status).toBe('AVAILABLE'); // same lifecycle default as every other kind — no special case
  });

  it('every kind in RESOURCE_KINDS constructs, and the enum is the single source the DB CHECK derives from', () => {
    for (const kind of RESOURCE_KINDS) expect(makeResource({ id, kind }).kind).toBe(kind);
    // The DB-side half of this contract is pinned in tests/architecture/domain-db-enum-pin.test.ts; asserting
    // the token list here as well would just be a second copy of the thing that must not be copied.
    expect(RESOURCE_KINDS).toContain('TEAM');
    expect(RESOURCE_KINDS).toContain('SUPPLY');
    expect(new Set(RESOURCE_KINDS).size).toBe(RESOURCE_KINDS.length);
  });
});
