// BEACON — FEMA ESF#6 Shelter System ACL tests (WP A4; adapter-contract §4, Art. XI/XVI). These tests are
// the honesty contract of this source in executable form: a CLOSED shelter stays CLOSED, a capacity FEMA
// did not publish is never invented, and a record the domain cannot express honestly is DROPPED AND
// COUNTED rather than bent into a number. Every raw payload below is a VERBATIM slice of a recorded live
// response (`__fixtures__/*.json`, retrieved 2026-09-11) — nothing here is hand-invented upstream data.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MapContext } from '@/adapters/_shared/index.js';
import { isAdapterError } from '@/adapters/_shared/index.js';
import {
  CAPACITY_SENTINEL,
  FEMA_SHELTER_LAYERS,
  femaShelterMapper,
  parseFemaShelterLayer,
} from './shelters-fema-acl.js';

const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const fixture = (name: string): string => readFileSync(`${FIXTURES}${name}`, 'utf8');

const ctx: MapContext = { fetchedAt: '2026-09-11T07:40:00Z', sourceRecordId: 'sid-fema' };

/** One ArcGIS feature in the exact envelope the service emits (`f=json`). */
const feature = (
  attributes: Record<string, unknown>,
  geometry?: { x: number; y: number },
): unknown => ({
  attributes,
  ...(geometry !== undefined ? { geometry } : {}),
});
const envelope = (features: readonly unknown[]): string => JSON.stringify({ features });

describe('FEMA_SHELTER_LAYERS — only the layers whose status the domain can state', () => {
  it('consumes layers 0/1/2 (Open/Closed/Full) and NOT layer 3 (Alert)', () => {
    expect(FEMA_SHELTER_LAYERS.map((l) => l.layerId)).toEqual([0, 1, 2]);
    // ALERT has no honest member in SHELTER_STATUSES; mislabelling it OPEN would send evacuees to a
    // building that is on standby, and CLOSED would erase a real state. It is simply not consumed.
    expect(FEMA_SHELTER_LAYERS.some((l) => l.layerId === 3)).toBe(false);
  });
});

describe('parseFemaShelterLayer — recorded live responses', () => {
  it('parses the recorded national OPEN layer (13 real records across 7 states, 2026-09-11)', () => {
    const res = parseFemaShelterLayer(fixture('open-shelters-national.json'));
    // 13 records in, 6 representable out: the other 7 publish an occupancy with no capacity (see below).
    expect(res.rows).toHaveLength(6);
    expect(res.rows.every((r) => r.statusCode === 'OPEN')).toBe(true);
    // The representable remainder still spans four states — that is what makes region scoping a real test
    // downstream: replayed unfiltered, Hawaii/Indiana/Minnesota shelters would land on the California COP.
    expect(new Set(res.rows.map((r) => r.state))).toEqual(new Set(['HI', 'CA', 'MN', 'IN']));
  });

  it('parses the recorded Butte-County CLOSED layer and keeps every status CLOSED', () => {
    const res = parseFemaShelterLayer(fixture('closed-shelters-butte-ca.json'));
    expect(res.rows).toHaveLength(25);
    expect(res.rows.every((r) => r.statusCode === 'CLOSED')).toBe(true);
  });

  it('parses the recorded FULL layer, which is genuinely EMPTY — an honest zero, not a failure', () => {
    const res = parseFemaShelterLayer(fixture('full-shelters-national.json'));
    expect(res.rows).toHaveLength(0);
    expect(res.skippedUnusable).toBe(0);
  });

  it('DROPS AND COUNTS a feature with no usable coordinates (a shelter nobody can be sent to)', () => {
    const text = envelope([
      feature({ shelter_id: 1, shelter_name: 'X', shelter_status_code: 'OPEN' }),
    ]);
    const res = parseFemaShelterLayer(text);
    expect(res.rows).toHaveLength(0);
    expect(res.skippedUnusable).toBe(1);
  });

  it('DROPS AND COUNTS a status code outside OPEN|CLOSED|FULL (ALERT is never guessed into the enum)', () => {
    // Verbatim from FEMA layer 3 on 2026-09-11 (shelter_id 352486).
    const text = envelope([
      feature(
        {
          shelter_id: 352486,
          shelter_name: 'Bob Hope Patriotic Hall Gym 10th Floor 1/2',
          shelter_status_code: 'ALERT',
          evacuation_capacity: 202,
          total_population: null,
        },
        { x: -118.27, y: 34.03 },
      ),
    ]);
    const res = parseFemaShelterLayer(text);
    expect(res.rows).toHaveLength(0);
    expect(res.skippedUnmappableStatus).toBe(1);
    expect(res.skippedUnusable).toBe(0); // it is well-formed; only its STATE is inexpressible
  });

  it('returns an empty result (never a throw) for an ArcGIS error envelope, so the ladder can degrade', () => {
    const res = parseFemaShelterLayer(
      JSON.stringify({ error: { code: 400, message: 'Invalid URL' } }),
    );
    expect(res.rows).toHaveLength(0);
  });

  it('returns an empty result for a non-JSON body (an HTML block page), never a throw', () => {
    expect(parseFemaShelterLayer('<!DOCTYPE html><html>blocked</html>').rows).toHaveLength(0);
  });
});

describe('capacity honesty — a figure FEMA did not publish is never invented', () => {
  const open = (attrs: Record<string, unknown>): string =>
    envelope([
      feature(
        { shelter_id: 9001, shelter_name: 'T', shelter_status_code: 'OPEN', state: 'CA', ...attrs },
        { x: -121.6, y: 39.75 },
      ),
    ]);

  it('carries a PUBLISHED capacity through verbatim', () => {
    const res = parseFemaShelterLayer(open({ evacuation_capacity: 315, total_population: 0 }));
    const shelter = femaShelterMapper.toCanonical(res.rows[0]!, ctx);
    expect(shelter.capacity).toBe(315);
  });

  it('treats a NULL evacuation_capacity as UNCOUNTED → capacity 0 (ineligible), never a made-up number', () => {
    const res = parseFemaShelterLayer(open({ evacuation_capacity: null, total_population: 0 }));
    // 0 is this codebase's canonical "nobody has counted this building" (mappers.ts shelterMapper.fromRow):
    // it makes the shelter INELIGIBLE for matching instead of a destination with invented headroom.
    expect(femaShelterMapper.toCanonical(res.rows[0]!, ctx).capacity).toBe(0);
  });

  it('treats the 99999 placeholder as UNCOUNTED too (it is a data-entry sentinel, not a headcount)', () => {
    expect(CAPACITY_SENTINEL).toBe(99999);
    const res = parseFemaShelterLayer(
      open({ evacuation_capacity: CAPACITY_SENTINEL, total_population: 0 }),
    );
    expect(femaShelterMapper.toCanonical(res.rows[0]!, ctx).capacity).toBe(0);
  });

  it('a published capacity of 0 is ALSO 0 — the two are indistinguishable downstream, and both are honest', () => {
    const res = parseFemaShelterLayer(open({ evacuation_capacity: 0, total_population: 0 }));
    expect(femaShelterMapper.toCanonical(res.rows[0]!, ctx).capacity).toBe(0);
  });

  it('DROPS AND COUNTS an occupied shelter whose capacity FEMA did not publish (domain cannot hold it)', () => {
    // REAL CASE, recorded 2026-09-11: shelter_id 368237, '242 Community Church' (MI) — OPEN, 13 people
    // sheltering, evacuation_capacity NULL. The domain requires occupancy <= capacity with capacity a
    // number, so every available encoding LIES: capacity 0 contradicts the published 13; capacity 13
    // invents a building size; occupancy 0 erases 13 real people. Dropped, counted, and reported.
    const res = parseFemaShelterLayer(open({ evacuation_capacity: null, total_population: 13 }));
    expect(res.rows).toHaveLength(0);
    expect(res.skippedUncountedButOccupied).toBe(1);
  });

  it('DROPS AND COUNTS a published OVER-CAPACITY shelter (occupancy > capacity) rather than clamping', () => {
    // FEMA can publish more people sheltering than the building's rated capacity — a real and operationally
    // meaningful state. The domain invariant (and the schema CHECK it mirrors) forbids occupancy > capacity,
    // and clamping either figure would rewrite what FEMA published, so the row is dropped and counted.
    const res = parseFemaShelterLayer(open({ evacuation_capacity: 100, total_population: 150 }));
    expect(res.rows).toHaveLength(0);
    expect(res.skippedOverCapacity).toBe(1);
    expect(res.skippedUncountedButOccupied).toBe(0); // its capacity WAS published — a different failure
  });

  it('counts that loss on the REAL recorded national OPEN layer — 7 of 13 live open shelters', () => {
    // Measured on the live feed 2026-09-11, not a contrived case: MORE THAN HALF of FEMA's currently-open
    // shelters nationally publish people sheltering with no capacity figure. This number is the size of
    // the domain gap reported in the WP write-up, and it is asserted here so it cannot drift unnoticed.
    const res = parseFemaShelterLayer(fixture('open-shelters-national.json'));
    expect(res.skippedUncountedButOccupied).toBe(7);
    expect(res.rows).toHaveLength(6);
  });
});

describe('femaShelterMapper — the canonical Shelter', () => {
  it('maps a recorded CLOSED Butte shelter to a CLOSED Shelter with its published capacity and org', () => {
    const res = parseFemaShelterLayer(fixture('closed-shelters-butte-ca.json'));
    const raw = res.rows.find((r) => r.shelterId === 169623); // 'Bidwell Junior High', capacity 623
    expect(raw).toBeDefined();
    const shelter = femaShelterMapper.toCanonical(raw!, ctx);
    expect(shelter.status).toBe('CLOSED'); // NEVER promoted to OPEN to make the map look busier
    expect(shelter.capacity).toBe(623);
    expect(shelter.occupancy).toBe(0);
    expect(shelter.id).toBe('shelters-fema:169623'); // stable, source-keyed, no invented uuid
    expect(shelter.orgId).toBe('THREE RIVERS CHAPTER'); // the operating organisation FEMA published
    expect(shelter.geom).toEqual({
      type: 'Point',
      coordinates: [-121.83863513799997, 39.75853482000008],
    });
  });

  it('omits orgId entirely when FEMA published no operating organisation (absent, not "Unknown")', () => {
    const res = parseFemaShelterLayer(fixture('open-shelters-national.json'));
    const lakeCounty = res.rows.find((r) => r.shelterId === 341375); // the one CA open shelter, org null
    expect(lakeCounty?.org).toBeNull();
    expect(femaShelterMapper.toCanonical(lakeCounty!, ctx).orgId).toBeUndefined();
  });

  it('raises a typed PARSE (never a raw throw) on a row it cannot map', () => {
    let caught: unknown;
    try {
      femaShelterMapper.toCanonical(
        {
          shelterId: 1,
          name: 'X',
          statusCode: 'ALERT',
          lon: 0,
          lat: 0,
          capacity: null,
          occupancy: 0,
          org: null,
          state: 'CA',
        },
        ctx,
      );
    } catch (e) {
      caught = e;
    }
    expect(isAdapterError(caught)).toBe(true);
  });
});

describe('responsible data (rule 4) — named-individual contact details never enter BEACON', () => {
  it('drops org_poc_* from a payload that carries them, so no PII reaches the domain or a log', () => {
    const text = envelope([
      feature(
        {
          shelter_id: 7,
          shelter_name: 'T',
          shelter_status_code: 'CLOSED',
          evacuation_capacity: 10,
          org_poc_name: 'Jane Doe',
          org_poc_phone: '555-0100',
          org_poc_email: 'jane@example.org',
        },
        { x: -121.6, y: 39.75 },
      ),
    ]);
    const row = parseFemaShelterLayer(text).rows[0]!;
    expect(JSON.stringify(row)).not.toMatch(/Jane Doe|555-0100|example\.org/);
  });

  it('the recorded fixtures themselves carry no org_poc_* field (they were projected, not `outFields=*`)', () => {
    for (const name of [
      'open-shelters-national.json',
      'closed-shelters-butte-ca.json',
      'full-shelters-national.json',
    ]) {
      expect(fixture(name), name).not.toMatch(/org_poc_/);
    }
  });
});
