// BEACON — Layer D: fail-closed export-time guard tests (ADR-035 §4; FR-D6-6). `buildIncidentSummary`
// (FR-D6-4) does not exist yet — this tests the STANDALONE guard function that awaits its call site,
// independently of any particular caller, mirroring how alert-sink.test.ts tests `asEmittable` on its own.
import { describe, it, expect } from 'vitest';
import { guardAggregateOnly } from './incident-summary-guard.js';

describe('guardAggregateOnly (Layer D — export-time fail-closed gate)', () => {
  it('passes a clean aggregate payload through unchanged', () => {
    const payload = { incidentId: 'inc-1', alertsIssued: 3, shelterOccupancyPeak: 120 };
    const res = guardAggregateOnly(payload);
    expect(res.ok).toBe(true);
    expect(res.ok ? res.value : undefined).toBe(payload); // same reference — no cloning/laundering
  });

  it('fails closed on a PLANTED person-identifying key and names the offending path', () => {
    const payload = { incidentId: 'inc-1', alertsIssued: 3, reporterName: 'Jane Doe' }; // PLANTED
    const res = guardAggregateOnly(payload);
    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.error.code).toBe('PII_FIELD_FOUND');
    expect(res.ok ? undefined : res.error.keys).toEqual(['reporterName']);
  });

  it('fails closed on a nested/array violation too (a spread deep inside the summary)', () => {
    const payload = {
      incidentId: 'inc-1',
      tasksCompleted: [{ count: 2 }, { count: 1, contactName: 'x' }], // PLANTED, one level into an array
    };
    const res = guardAggregateOnly(payload);
    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.error.keys).toEqual(['tasksCompleted[1].contactName']);
  });

  it('reports EVERY offending path, not just the first (fail-closed means complete, not first-match)', () => {
    const payload = { incidentId: 'inc-1', email: 'a@b.com', phone: '555-0100' }; // both PLANTED
    const res = guardAggregateOnly(payload);
    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.error.keys).toEqual(['email', 'phone']);
  });

  it('honours a caller-supplied justified allowlist (e.g. a benign "regionName" collision)', () => {
    const payload = { incidentId: 'inc-1', regionName: 'central-valley' };
    expect(guardAggregateOnly(payload).ok).toBe(false); // denied by default (substring "name")
    const res = guardAggregateOnly(payload, { allowlist: new Set(['regionName']) });
    expect(res.ok).toBe(true);
  });

  it('an empty aggregate object is trivially clean', () => {
    expect(guardAggregateOnly({}).ok).toBe(true);
  });
});

// =============================================================================================================
// F-347 — PLANT/FAIL/REVERT: the denylist had NO CONCEPT of location, device/chat id, or image reference
// =============================================================================================================
// Art. XIV names PRECISE LOCATION as the flagship class ("precise location only in the responder-authenticated
// view") — yet Layer D would have exported `geomPrecise`, `latitude`, `chatId` and `photo` without a murmur:
// the denylist was a NAMES-AND-IDENTIFIERS list only. These are not hypothetical key names; `geomPrecise` is
// the actual column on the reports table (src/adapters/persistence/schema/intel-tables.ts:33) that carries an
// SOS reporter's exact coordinate, and `chatId` is the actual Telegram sender handle
// (src/adapters/channels/messaging/subscriber-registry.ts:12). A single mapper spreading a report row into an
// export payload was all it took.
describe('guardAggregateOnly — F-347: location / device / image are person-identifying (Art. XIV)', () => {
  it.each([
    ['geomPrecise', { incidentId: 'inc-1', geomPrecise: 'POINT(-121.6 39.7)' }],
    ['latitude', { incidentId: 'inc-1', latitude: 39.7285 }],
    ['longitude', { incidentId: 'inc-1', longitude: -121.8375 }],
    ['coordinates', { incidentId: 'inc-1', coordinates: [-121.6, 39.7] }],
    ['preciseLocation', { incidentId: 'inc-1', preciseLocation: 'x' }],
    ['homeLocation', { incidentId: 'inc-1', homeLocation: 'x' }],
    ['chatId', { incidentId: 'inc-1', chatId: '1234567' }],
    ['senderId', { incidentId: 'inc-1', senderId: 'tg-1234567' }],
    ['photo', { incidentId: 'inc-1', photo: 'data:image/jpeg;base64,…' }],
    ['photos', { incidentId: 'inc-1', photos: ['a.jpg'] }],
    ['selfie', { incidentId: 'inc-1', selfie: 'a.jpg' }],
    ['imageUrl', { incidentId: 'inc-1', imageUrl: 'https://x/y.jpg' }],
    ['avatar', { incidentId: 'inc-1', avatar: 'a.png' }],
    ['macAddress', { incidentId: 'inc-1', macAddress: '00:11:22:33:44:55' }],
    ['imsi', { incidentId: 'inc-1', imsi: '310150123456789' }],
    ['msisdn', { incidentId: 'inc-1', msisdn: '+15550100' }],
  ])('fails closed on a planted `%s` and names the path', (key, payload) => {
    const res = guardAggregateOnly(payload);
    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.error.code).toBe('PII_FIELD_FOUND');
    expect(res.ok ? undefined : res.error.keys).toEqual([key]);
  });

  it('catches the realistic case: a report row spread one level deep into an export payload', () => {
    const payload = {
      incidentId: 'inc-1',
      reports: [
        { id: 'rep-1', status: 'VERIFIED' },
        // A GeoJSON point: the key `geomPrecise` AND its nested `coordinates` are both denied, and Layer D
        // reports BOTH paths — fail-closed means complete, so a caller cannot fix one and ship the other.
        { id: 'rep-2', status: 'VERIFIED', geomPrecise: { type: 'Point', coordinates: [-121.6, 39.7] } },
      ],
    };
    const res = guardAggregateOnly(payload);
    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.error.keys).toEqual([
      'reports[1].geomPrecise',
      'reports[1].geomPrecise.coordinates',
    ]);
  });

  it('REVERT: the AGGREGATE forms of the same concepts still pass — this is not a ban on geography', () => {
    // The guard must stay usable: a region id, a hazard footprint AREA, a coarse bucket and a map-tile
    // reference are all aggregate facts about places, not about people. A denylist that blocked these would
    // be abandoned or allowlisted into uselessness within one sprint.
    const payload = {
      incidentId: 'inc-1',
      regionId: 'us-ca-butte',
      affectedAreaKm2: 42.5,
      sheltersOpen: 3,
      geohashPrefix: 'e12',
      basemapUrl: 'https://tiles.example/{z}/{x}/{y}.png',
      elevationM: 240,
      relatedIncidents: ['inc-2'],
      translationKey: 'panel.title',
      latencyMs: 12,
    };
    expect(guardAggregateOnly(payload).ok).toBe(true);
  });
});
