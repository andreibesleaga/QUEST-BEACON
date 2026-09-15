// BEACON — CAP lifecycle battery (D3.2; ADR-036 §2, V3/V4, finding F-29). Before this, `msgType` was pinned
// to `Alert` and the entity had no `references`, so an Update, a Cancel and an all-clear were literally
// unconstructible. These tests pin the two guarantees that replaced that gap:
//   • a follow-up CANNOT lose its reference to the message it supersedes, and
//   • a follow-up CANNOT skip the human (Art. XIII) — an all-clear is a public message.
import { describe, it, expect } from 'vitest';
import {
  ALERT_MSG_TYPES,
  alertMsgType,
  approveAlert,
  buildAllClear,
  buildFollowUpAlert,
  isAllClear,
  makeAlert,
} from './alert.js';
import type { Alert } from './alert.js';
import { asId } from './value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from './value-objects/ids.js';
import type { PolygonGeometry } from './value-objects/geo.js';
import { InvariantViolation, InvalidTransition } from './errors.js';

const APPROVER = asId<AppUserId>('em-1');
const RING: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [24.0, 44.0],
      [24.2, 44.0],
      [24.2, 44.2],
      [24.0, 44.2],
      [24.0, 44.0],
    ],
  ],
};

function emittedOriginal(): Alert {
  return makeAlert({
    id: asId<AlertId>('alert-1'),
    incidentId: asId<IncidentId>('inc-1'),
    capStatus: 'ACTUAL',
    approvedBy: APPROVER,
    category: 'Met',
    severity: 'SEVERE',
    area: RING,
    responseType: ['Evacuate'],
    urgency: 'Immediate',
    certainty: 'Observed',
    sentAt: '2026-07-05T22:00:00Z',
  });
}

describe('Alert CAP lifecycle fields (additive — spec-delta §1.1)', () => {
  it('defaults to ALERT and writes no msgType, so a plain alert is shaped exactly as before', () => {
    const plain = makeAlert({
      id: asId<AlertId>('a'),
      incidentId: asId<IncidentId>('i'),
      category: 'Fire',
      severity: 'MINOR',
    });
    expect(plain.msgType).toBeUndefined();
    expect(alertMsgType(plain)).toBe('ALERT');
    expect(plain.references).toBeUndefined();
    expect(ALERT_MSG_TYPES).toEqual(['ALERT', 'UPDATE', 'CANCEL']);
  });

  it('rejects an UPDATE or CANCEL with no references, at AUTHORING time with a sentence naming the gap', () => {
    for (const msgType of ['UPDATE', 'CANCEL'] as const) {
      expect(() =>
        makeAlert({
          id: asId<AlertId>('a'),
          incidentId: asId<IncidentId>('i'),
          category: 'Fire',
          severity: 'MINOR',
          msgType,
        }),
      ).toThrow(InvariantViolation);
      expect(() =>
        makeAlert({
          id: asId<AlertId>('a'),
          incidentId: asId<IncidentId>('i'),
          category: 'Fire',
          severity: 'MINOR',
          msgType,
          references: [],
        }),
      ).toThrow(/requires references/);
    }
  });

  it('rejects an out-of-vocabulary responseType / urgency / certainty (CAP closed vocabularies)', () => {
    const base = {
      id: asId<AlertId>('a'),
      incidentId: asId<IncidentId>('i'),
      category: 'Fire' as const,
      severity: 'MINOR' as const,
    };
    expect(() => makeAlert({ ...base, responseType: ['Panic' as never] })).toThrow(
      InvariantViolation,
    );
    expect(() => makeAlert({ ...base, urgency: 'Soonish' as never })).toThrow(InvariantViolation);
    expect(() => makeAlert({ ...base, certainty: 'Maybe' as never })).toThrow(InvariantViolation);
    expect(() => makeAlert({ ...base, msgType: 'ACK' as never })).toThrow(InvariantViolation);
  });
});

describe('buildAllClear / buildFollowUpAlert (V3)', () => {
  it('builds an all-clear that references the ORIGINAL identifier and cannot be told not to', () => {
    const original = emittedOriginal();
    const allClear = buildAllClear({ id: asId<AlertId>('alert-1-allclear'), original });

    expect(alertMsgType(allClear)).toBe('CANCEL');
    expect(allClear.responseType).toEqual(['AllClear']);
    expect(allClear.references).toEqual([original.id]);
    expect(isAllClear(allClear)).toBe(true);
    // Carried over so recipients can match the clear to the warning: same incident, category and footprint.
    expect(allClear.incidentId).toBe(original.incidentId);
    expect(allClear.category).toBe(original.category);
    expect(allClear.area).toEqual(original.area);
    // Honest machine values for a hazard that has ended and been observed to end.
    expect(allClear.urgency).toBe('Past');
    expect(allClear.certainty).toBe('Observed');
    // Severity is NOT rewritten — the message still concerns a SEVERE event and downstream consumers route on it.
    expect(allClear.severity).toBe('SEVERE');
  });

  it('produces a DRAFT — an all-clear is a public action and takes the SAME approver path (Art. XIII)', () => {
    const original = emittedOriginal();
    const allClear = buildAllClear({ id: asId<AlertId>('alert-1-allclear'), original });

    expect(allClear.capStatus).toBe('DRAFT');
    expect(allClear.approvedBy).toBeUndefined();
    // It reaches ACTUAL only through approveAlert, exactly like the warning it clears.
    const approved = approveAlert(allClear, APPROVER);
    expect(approved.capStatus).toBe('ACTUAL');
    expect(approved.approvedBy).toBe(APPROVER);
    expect(approved.references).toEqual([original.id]);
  });

  it('refuses to clear or update an alert that was never made public', () => {
    const draft = makeAlert({
      id: asId<AlertId>('alert-draft'),
      incidentId: asId<IncidentId>('inc-1'),
      category: 'Met',
      severity: 'SEVERE',
    });
    expect(() => buildAllClear({ id: asId<AlertId>('x'), original: draft })).toThrow(
      InvalidTransition,
    );
    expect(() =>
      buildFollowUpAlert({ id: asId<AlertId>('x'), original: draft, msgType: 'UPDATE' }),
    ).toThrow(InvalidTransition);
  });

  it('builds an UPDATE that may change severity and wording while keeping the reference', () => {
    const original = emittedOriginal();
    const update = buildFollowUpAlert({
      id: asId<AlertId>('alert-1-update'),
      original,
      msgType: 'UPDATE',
      severity: 'EXTREME',
      responseType: ['Evacuate'],
      headline: 'Flood warning upgraded',
    });
    expect(alertMsgType(update)).toBe('UPDATE');
    expect(update.severity).toBe('EXTREME');
    expect(update.headline).toBe('Flood warning upgraded');
    expect(update.references).toEqual([original.id]);
    expect(update.capStatus).toBe('DRAFT');
    expect(isAllClear(update)).toBe(false);
  });

  it('lets an operator override the all-clear machine values (an all-clear on a forecast, not an observation)', () => {
    const allClear = buildAllClear({
      id: asId<AlertId>('x'),
      original: emittedOriginal(),
      urgency: 'Future',
      certainty: 'Likely',
    });
    expect(allClear.urgency).toBe('Future');
    expect(allClear.certainty).toBe('Likely');
  });
});
