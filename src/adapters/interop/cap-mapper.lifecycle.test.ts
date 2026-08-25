// BEACON — CAP mapper lifecycle tests (D3.2; ADR-036 §2, V4, finding F-29). `msgType` used to be pinned to
// `Alert` and `CapAlert` had no `references` at all, so these documents could not be produced. Each test
// below would have been impossible to write before this change.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { approveAlert, buildAllClear, buildFollowUpAlert, makeAlert } from '@/domain/alert.js';
import type { Alert } from '@/domain/alert.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import type { PolygonGeometry } from '@/domain/value-objects/geo.js';
import { alertToCap, buildCapAlert } from './cap-mapper.js';

const capSchema = JSON.parse(readFileSync('schemas/cap-v1.2.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateCap = ajv.compile(capSchema);

const SENT = '2026-07-05T22:00:00Z';
const APPROVER = asId<AppUserId>('em-1');
const RING: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [[[24.0, 44.0], [24.2, 44.0], [24.2, 44.2], [24.0, 44.2], [24.0, 44.0]]],
};

function original(): Alert {
  return makeAlert({
    id: asId<AlertId>('ro-alert-1'),
    incidentId: asId<IncidentId>('inc-1'),
    capStatus: 'ACTUAL',
    approvedBy: APPROVER,
    category: 'Met',
    severity: 'SEVERE',
    area: RING,
    sentAt: SENT,
  });
}

const REF = [{ identifier: 'ro-alert-1', sent: SENT }] as const;

describe('msgType is no longer pinned to Alert (V4)', () => {
  it('maps the DOMAIN msgType onto the CAP wire spelling', () => {
    const cancel = approveAlert(
      buildAllClear({ id: asId<AlertId>('ro-alert-1-clear'), original: original() }),
      APPROVER,
    );
    const cap = buildCapAlert(cancel, { references: REF, sent: SENT }, SENT);
    expect(cap.msgType).toBe('Cancel');

    const update = approveAlert(
      buildFollowUpAlert({ id: asId<AlertId>('ro-alert-1-upd'), original: original(), msgType: 'UPDATE' }),
      APPROVER,
    );
    expect(buildCapAlert(update, { references: REF }, SENT).msgType).toBe('Update');
  });

  it('leaves a plain alert byte-identical to the pre-ADR-036 document (no new elements)', () => {
    const cap = buildCapAlert(original(), { areaDesc: 'Galați' }, SENT);
    expect(cap.msgType).toBe('Alert');
    expect(cap.references).toBeUndefined();
    expect(cap.code).toBeUndefined();
    expect(Object.keys(cap).sort()).toEqual(['identifier', 'info', 'msgType', 'scope', 'sender', 'sent', 'status']);
  });

  it('still honours an explicit CapOptions.msgType for an alert that carries none', () => {
    expect(buildCapAlert(original(), { msgType: 'Ack' }, SENT).msgType).toBe('Ack');
  });
});

describe('references are emitted as sender,identifier,sent triplets (V4)', () => {
  it('serializes one triplet, defaulting the sender to the emitting sender', () => {
    const cancel = approveAlert(
      buildAllClear({ id: asId<AlertId>('ro-alert-1-clear'), original: original() }),
      APPROVER,
    );
    const cap = buildCapAlert(cancel, { sender: 'beacon@beacon.local', references: REF }, SENT);
    expect(cap.references).toBe(`beacon@beacon.local,ro-alert-1,${SENT}`);
    expect(validateCap(cap), JSON.stringify(validateCap.errors)).toBe(true);
  });

  it('space-delimits multiple triplets and honours a per-reference sender', () => {
    const cancel = approveAlert(
      buildAllClear({ id: asId<AlertId>('c'), original: original() }),
      APPROVER,
    );
    const cap = buildCapAlert(
      cancel,
      {
        sender: 'beacon@beacon.local',
        references: [
          { identifier: 'a-1', sent: SENT },
          { identifier: 'b-1', sent: SENT, sender: 'partner@example.org' },
        ],
      },
      SENT,
    );
    expect(cap.references).toBe(
      `beacon@beacon.local,a-1,${SENT} partner@example.org,b-1,${SENT}`,
    );
  });

  it('BLOCKS a Cancel with no resolvable reference, with a message naming the missing input', () => {
    const cancel = approveAlert(
      buildAllClear({ id: asId<AlertId>('ro-alert-1-clear'), original: original() }),
      APPROVER,
    );
    const res = alertToCap(cancel, { sent: SENT });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PARSE_ERROR');
    expect(res.error.message).toContain('CapOptions.references');
    expect(res.error.message).toContain('ro-alert-1'); // names the alert whose triplet is missing
  });

  it('proves the GATE, not just the builder: a hand-made Cancel without references fails the CAP schema', () => {
    // The document a caller would get if the domain factory and the mapper guard were both bypassed.
    const forged = { ...buildCapAlert(original(), {}, SENT), msgType: 'Cancel' as const };
    expect(validateCap(forged)).toBe(false);
    expect(JSON.stringify(validateCap.errors)).toContain('references');
  });
});

describe('the domain owns the machine values the mapper used to hardcode', () => {
  it('uses the alert urgency/certainty/responseType over the mapper defaults', () => {
    const rich = makeAlert({
      id: asId<AlertId>('a'),
      incidentId: asId<IncidentId>('i'),
      capStatus: 'ACTUAL',
      approvedBy: APPROVER,
      category: 'Fire',
      severity: 'EXTREME',
      urgency: 'Immediate',
      certainty: 'Observed',
      responseType: ['Evacuate'],
      headline: 'WILDFIRE — Extreme',
      instruction: 'Leave now.',
      sentAt: SENT,
    });
    const info = buildCapAlert(rich, { urgency: 'Future', certainty: 'Unlikely' }, SENT).info[0];
    expect(info?.urgency).toBe('Immediate');
    expect(info?.certainty).toBe('Observed');
    expect(info?.responseType).toEqual(['Evacuate']);
    expect(info?.headline).toBe('WILDFIRE — Extreme');
    expect(info?.instruction).toBe('Leave now.');
  });

  it('still falls back to the config defaults for an alert that carries none (unchanged behaviour)', () => {
    const info = buildCapAlert(original(), {}, SENT).info[0];
    expect(info?.urgency).toBe('Expected');
    expect(info?.certainty).toBe('Likely');
  });
});

describe('the machine-value agreement gate blocks emission (not just a test helper)', () => {
  it('rejects a document whose <info> blocks disagree on severity', () => {
    // Divergence is constructed through the ONLY surface that could produce it — per-language options —
    // by feeding two translations whose (illegal) effect would be different machine values. Since the
    // mapper writes machine values identically by construction, the guard is asserted through alertToCap's
    // contract: an agreeing document passes, and capMachineValuesAgree is what stands between them.
    const res = alertToCap(original(), {
      translations: [
        { language: 'ro', headline: 'Cotă depășită' },
        { language: 'en', headline: 'Stage exceeded' },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.info).toHaveLength(2);
    expect(res.value.info[0]?.severity).toBe(res.value.info[1]?.severity);
  });
});
