// BEACON — AlertSink adapter tests (E1·T-089 P10; ADR-010, Art. XIII). Deterministic (fixed past clock,
// injected ids; no wall-clock/network): an approved ACTUAL alert emits a schema-valid CAP + is appended to
// the hash-chained audit log; the chain verifies; the sink is MOCK (no external send). A DRAFT/unapproved
// alert cannot be constructed as EmittableAlert (asEmittable === null) — Art. XIII at the type boundary.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeAlert } from '@/domain/alert.js';
import type { Alert } from '@/domain/alert.js';
import type { AlertId, AppUserId, IncidentId, SourceId, ThresholdRuleId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import type { EmittableAlert } from '@/ports/logistics.js';
import { buildDraftAlert } from '@/application/threshold-evaluation/threshold-evaluation.js';
import type { DraftAlertProposal } from '@/application/threshold-evaluation/threshold-evaluation.js';
import { makeAlertSink, asEmittable } from './alert-sink.js';

const capSchema = JSON.parse(readFileSync('schemas/cap-v1.2.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateCap = ajv.compile(capSchema);

// Fixed PAST clock + stable ids → fully deterministic (no flaky wall-clock / RNG).
const CLOCK = '2026-07-05T14:30:00Z';
const clock = (): string => CLOCK;

function actualAlert(id = 'alert-actual-1'): EmittableAlert {
  const alert = makeAlert({
    id: asId<AlertId>(id),
    incidentId: asId<IncidentId>('inc-1'),
    capStatus: 'ACTUAL',
    category: 'Fire',
    severity: 'SEVERE',
    approvedBy: asId<AppUserId>('user-verifier-1'),
  });
  const emittable = asEmittable(alert);
  if (emittable === null) throw new Error('fixture must be emittable');
  return emittable;
}

describe('makeAlertSink.emit (Art. XIII — approved ACTUAL only)', () => {
  it('emits a schema-valid CAP, records the emission, and audits it (MOCK sink, no network)', async () => {
    const sink = makeAlertSink({ clock });
    const res = await sink.emit(actualAlert());

    expect(res.ok).toBe(true);
    expect(sink.emissions).toHaveLength(1);
    const record = sink.emissions[0]!;
    expect(record.sink).toBe('MOCK'); // no real external send happened
    expect(record.cap.status).toBe('Actual');
    expect(record.emittedAt).toBe(CLOCK); // the injected clock supplied CAP <sent>
    expect(validateCap(record.cap)).toBe(true); // validate-before-emit held
    // The emission is committed to the tamper-evident chain.
    expect(record.auditHash).toBe(sink.audit.events[0]?.hash);
    expect(sink.verify()).toBe(true);
    expect(sink.audit.events).toHaveLength(1);
  });

  it('uses the alert own sentAt for CAP <sent> when present', async () => {
    const sink = makeAlertSink({ clock });
    const withSent = { ...actualAlert('alert-2'), sentAt: '2026-07-05T09:00:00Z' } as EmittableAlert;
    const res = await sink.emit(withSent);
    expect(res.ok).toBe(true);
    expect(sink.emissions[0]?.emittedAt).toBe('2026-07-05T09:00:00Z');
    expect(sink.emissions[0]?.cap.sent).toBe('2026-07-05T09:00:00Z');
  });

  it('hash-chains successive emissions (append-only, tamper-evident) and stays verifiable', async () => {
    const sink = makeAlertSink({ clock });
    await sink.emit(actualAlert('alert-a'));
    await sink.emit(actualAlert('alert-b'));
    expect(sink.emissions).toHaveLength(2);
    expect(sink.audit.events).toHaveLength(2);
    // Genesis has no prevHash; the second link chains onto the first.
    expect(sink.audit.events[0]?.prevHash).toBeUndefined();
    expect(sink.audit.events[1]?.prevHash).toBe(sink.audit.events[0]?.hash);
    expect(sink.audit.events[0]?.hash).not.toBe(sink.audit.events[1]?.hash);
    expect(sink.verify()).toBe(true);
  });

  it('shares an injected audit chain when provided', async () => {
    const outer = makeAlertSink({ clock });
    const inner = makeAlertSink({ clock, audit: outer.audit });
    await inner.emit(actualAlert('alert-shared'));
    expect(outer.audit.events).toHaveLength(1); // the shared chain saw the append
    expect(inner.verify()).toBe(true);
  });
});

describe('asEmittable (Art. XIII narrowing — a DRAFT can never reach emit)', () => {
  it('rejects a DRAFT alert (not emittable)', () => {
    const draft: Alert = makeAlert({
      id: asId<AlertId>('alert-draft'),
      incidentId: asId<IncidentId>('inc-1'),
      capStatus: 'DRAFT',
      category: 'Met',
      severity: 'MINOR',
    });
    expect(asEmittable(draft)).toBeNull();
  });

  it('rejects an ACTUAL-shaped alert missing an approver (defense in depth)', () => {
    // Bypass the domain factory to simulate a malformed ACTUAL alert reaching the sink boundary.
    const bad = {
      id: asId<AlertId>('alert-bad'),
      incidentId: asId<IncidentId>('inc-1'),
      capStatus: 'ACTUAL',
      category: 'Safety',
      severity: 'EXTREME',
      edxlKind: 'CAP',
    } as Alert;
    expect(asEmittable(bad)).toBeNull();
  });

  it('narrows a well-formed approved ACTUAL alert', () => {
    expect(asEmittable(actualAlert('alert-ok'))).not.toBeNull();
  });
});

// =========================================================================================================
// Art. XIII, STRUCTURALLY — a threshold-rule fire (including a FORECAST crossing, C2.4/ADR-033 §6) can
// NEVER reach this sink. The proof is at the TYPE level, checked by `tsc`, not by a runtime branch: the
// engine returns `DraftAlert` ('DRAFT' literal, no approver) and `emit` demands `EmittableAlert` ('ACTUAL'
// literal + approver). Each `@ts-expect-error` below is itself an assertion — if the guarantee were ever
// weakened, the directive would become an "unused '@ts-expect-error'" tsc ERROR (Gate 2), so this cannot rot.
// =========================================================================================================
describe('a threshold-rule fire cannot be emitted (Art. XIII at the type boundary)', () => {
  const forecastFire = (): DraftAlertProposal =>
    buildDraftAlert({
      rule: makeThresholdRule({
        id: asId<ThresholdRuleId>('r-forecast'),
        target: 'FORECAST_GAUGE_CATEGORY',
        operator: 'gte',
        value: 'MODERATE',
      }),
      incidentId: asId<IncidentId>('inc-1'),
      alertId: asId<AlertId>('alert-forecast-draft'),
      category: 'Met',
      severity: 'SEVERE',
      sourceId: asId<SourceId>('src-glofas'),
      reading: {
        forecastCategory: 'MAJOR',
        forecastEtaHours: 18,
        forecastIssuedAt: '2026-07-05T06:00:00Z',
      },
      now: Date.parse(CLOCK),
    });

  it('does not compile when handed to emit, and emits nothing at runtime either', async () => {
    const sink = makeAlertSink({ clock });
    const fire = forecastFire();
    expect(fire.alert.capStatus).toBe('DRAFT');
    expect(fire.forecast?.leadTimeHours).toBe(18); // the DRAFT does carry its lead time…

    // @ts-expect-error — Art. XIII: a DraftAlert is not an EmittableAlert. THIS IS THE GUARANTEE.
    const res = await sink.emit(fire.alert);
    // …and even with the compiler deliberately overridden, the sink fails closed: no CAP document was
    // serialized, nothing was appended to the emission chain, nothing was recorded as sent.
    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.error.code).toBe('CONFLICT');
    expect(sink.emissions).toEqual([]);
    expect(sink.audit.events).toEqual([]);
  });

  it('cannot be laundered through asEmittable — the narrowing is typed `null` for a DraftAlert', () => {
    const fire = forecastFire();
    const narrowed: null = asEmittable(fire.alert); // the DraftAlert overload returns exactly `null`
    expect(narrowed).toBeNull();
    // @ts-expect-error — there is no branch in which the narrowing yields something emittable.
    const impossible: EmittableAlert = asEmittable(fire.alert);
    expect(impossible).toBeNull();
  });
});

// ── D3.1: the profile gate is BLOCKING and sits ALONGSIDE the Art. XIII guard, never instead of it ──────
describe('CAP profile gate (ADR-036 §1, V2/V18)', () => {
  /** An approved ACTUAL alert that satisfies base CAP but not the IPAWS profile (no code/expires/eventCode). */
  function approvedActual(): EmittableAlert {
    return makeAlert({
      id: asId<AlertId>('alert-profile-sink'),
      incidentId: asId<IncidentId>('inc-1'),
      capStatus: 'ACTUAL',
      approvedBy: asId<AppUserId>('em-1'),
      category: 'Fire',
      severity: 'SEVERE',
      sentAt: CLOCK,
    }) as EmittableAlert;
  }

  it('records NOTHING when the selected profile rejects the document (no emission, no audit link)', async () => {
    const sink = makeAlertSink({ clock, capProfile: 'ipaws' });
    const res = await sink.emit(approvedActual());

    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : res.error.code).toBe('PARSE_ERROR');
    expect(res.ok ? '' : res.error.message).toContain('CAP profile "ipaws"');
    // The two things that must not have happened: no recorded emission, and no audit-chain link.
    expect(sink.emissions).toEqual([]);
    expect(sink.audit.events).toEqual([]);
    expect(sink.verify()).toBe(true);
  });

  it('emits the same document under the default `base` profile (the profile is the only difference)', async () => {
    const sink = makeAlertSink({ clock });
    expect((await sink.emit(approvedActual())).ok).toBe(true);
    expect(sink.emissions).toHaveLength(1);
  });

  it('keeps the Art. XIII guard FIRST — a non-emittable alert is CONFLICT, never a profile error', async () => {
    const sink = makeAlertSink({ clock, capProfile: 'ipaws' });
    const notApproved = makeAlert({
      id: asId<AlertId>('alert-unapproved'),
      incidentId: asId<IncidentId>('inc-1'),
      category: 'Fire',
      severity: 'SEVERE',
      sentAt: CLOCK,
    }) as unknown as EmittableAlert;
    const res = await sink.emit(notApproved);
    expect(res.ok ? undefined : res.error.code).toBe('CONFLICT');
    expect(sink.emissions).toEqual([]);
  });
});
