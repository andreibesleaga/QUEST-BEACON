// BEACON — CAP v1.2 mapper tests (E7·T-290/T-291/T-293). CAP validates against cap-v1.2.schema.json;
// DRAFT→Draft, ACTUAL(+approver)→Actual; ACTUAL without approver is rejected; no PII leaks.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeAlert } from '@/domain/alert.js';
import type { Alert } from '@/domain/alert.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { PolygonGeometry } from '@/domain/value-objects/geo.js';
import { alertToCap } from './cap-mapper.js';

const capSchema = JSON.parse(readFileSync('schemas/cap-v1.2.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateCap = ajv.compile(capSchema);

const RING: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-118.3, 34.0],
      [-118.2, 34.0],
      [-118.2, 34.1],
      [-118.3, 34.1],
      [-118.3, 34.0],
    ],
  ],
};

function draftAlert(): Alert {
  return makeAlert({
    id: asId<AlertId>('alert-draft-1'),
    incidentId: asId<IncidentId>('inc-1'),
    capStatus: 'DRAFT',
    category: 'Fire',
    severity: 'SEVERE',
    area: RING,
    sentAt: '2026-07-05T14:30:00-07:00',
  });
}

describe('alertToCap (T-290/T-291)', () => {
  it('produces a Draft CAP alert that validates against cap-v1.2.schema.json', () => {
    const res = alertToCap(draftAlert(), { event: 'Wildfire', responseType: ['Evacuate'] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe('Draft');
    expect(validateCap(res.value)).toBe(true);
    expect(res.value.info[0]?.severity).toBe('Severe');
    expect(res.value.info[0]?.category).toEqual(['Fire']);
    // Polygon mapped to a CAP 'lat,lon' closed-ring polygon string.
    expect(res.value.info[0]?.area?.[0]?.polygon?.[0]).toContain('34,-118.3');
  });

  it('maps an approved ACTUAL alert to status=Actual', () => {
    const approved = makeAlert({
      id: asId<AlertId>('alert-actual-1'),
      incidentId: asId<IncidentId>('inc-1'),
      capStatus: 'ACTUAL',
      category: 'Safety',
      severity: 'EXTREME',
      approvedBy: asId<AppUserId>('user-em-1'),
      sentAt: '2026-07-05T14:30:00-07:00',
    });
    const res = alertToCap(approved);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe('Actual');
    expect(validateCap(res.value)).toBe(true);
  });

  it('never emits PII fields (no addresses/contact) for a Public alert', () => {
    const res = alertToCap(draftAlert());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect('addresses' in res.value).toBe(false);
    expect(res.value.scope).toBe('Public');
    expect('contact' in (res.value.info[0] ?? {})).toBe(false);
  });

  it('rejects an ACTUAL alert without an approver (Art. XIII, defense in depth)', () => {
    // Bypass the domain factory to simulate a malformed ACTUAL alert reaching the ACL.
    const bad = { ...draftAlert(), capStatus: 'ACTUAL' } as Alert;
    const res = alertToCap(bad);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('CONFLICT');
  });

  it('requires a sent timestamp', () => {
    const noSent = makeAlert({
      id: asId<AlertId>('alert-3'),
      incidentId: asId<IncidentId>('inc-1'),
      category: 'Met',
      severity: 'MINOR',
    });
    const res = alertToCap(noSent);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PARSE_ERROR');
  });
});
