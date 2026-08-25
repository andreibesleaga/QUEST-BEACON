// BEACON — drill recorder tests (MW-D/D4; ADR-034 §7 Layer 2). No network, no channel, fixed instants.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { EXERCISE_LABEL, makeDrillAlert } from '@/domain/drill.js';
import type { DrillAlert } from '@/domain/drill.js';
import { makeAlert } from '@/domain/alert.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import { makeGovernanceLedger } from './ledger.js';
import { makeDrillRecorder } from './drill-recorder.js';

const T0 = '2026-07-05T22:00:00.000Z';
const em = asId<AppUserId>('u-em-1');
const artifact = makeDrillAlert({
  id: asId<AlertId>('al-drill-1'),
  incidentId: asId<IncidentId>('inc-1'),
  category: 'Met',
  severity: 'SEVERE',
  at: T0,
  exerciseApprovedBy: em,
  exerciseApprovedByRole: 'EM',
});

describe('makeDrillRecorder', () => {
  it('records the exercise artifact and commits it to the governance chain', () => {
    const ledger = makeGovernanceLedger();
    const recorder = makeDrillRecorder({ ledger });
    const res = recorder.record(artifact, T0);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toMatchObject({
      alertId: 'al-drill-1',
      capStatus: 'EXERCISE',
      label: EXERCISE_LABEL,
      recordedAt: T0,
      sink: 'DRILL_RECORDER', // honest labelling: nothing was delivered anywhere
    });
    expect(recorder.records).toHaveLength(1);
    const entry = ledger.entries[0];
    expect(entry?.action).toBe('DRILL_ARTIFACT');
    expect(entry?.target).toBe('alert:al-drill-1');
    expect(entry?.actorId).toBe('u-em-1');
    expect(res.value.ledgerHash).toBe(entry?.hash);
    expect(ledger.verify().intact).toBe(true);
  });

  it('records an unapproved exercise artifact without an actor (there is nobody to name)', () => {
    const ledger = makeGovernanceLedger();
    const bare = makeDrillAlert({
      id: asId<AlertId>('al-drill-2'),
      incidentId: asId<IncidentId>('inc-1'),
      category: 'Fire',
      severity: 'MINOR',
      at: T0,
    });
    expect(isOk(makeDrillRecorder({ ledger }).record(bare, T0))).toBe(true);
    expect(ledger.entries[0]?.actorId).toBeUndefined();
  });

  it('REFUSES a real alert forced in by a cast — a live alert must not be logged as an exercise', () => {
    const ledger = makeGovernanceLedger();
    const real = makeAlert({
      id: asId<AlertId>('al-real-1'),
      incidentId: asId<IncidentId>('inc-1'),
      category: 'Met',
      severity: 'EXTREME',
      capStatus: 'ACTUAL',
      approvedBy: em,
    });
    const res = makeDrillRecorder({ ledger }).record(real as unknown as DrillAlert, T0);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('CONFLICT');
    expect(ledger.entries).toHaveLength(0);
  });

  it('propagates a ledger refusal instead of recording an unaudited artifact', () => {
    const ledger = makeGovernanceLedger();
    const res = makeDrillRecorder({ ledger }).record(artifact, 'not-an-instant');
    expect(isErr(res) && res.error.code).toBe('INVARIANT_VIOLATION');
    expect(makeDrillRecorder({ ledger }).records).toHaveLength(0);
  });

  it('never puts a person-identifying key in the evidence it writes (Art. XIV)', () => {
    const ledger = makeGovernanceLedger();
    const res = makeDrillRecorder({ ledger }).record(artifact, T0);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const evidence = ledger.evidenceFor(ledger.entries[0]?.evidenceDigest ?? '');
    expect(JSON.stringify(evidence)).toContain('EXERCISE');
    expect(JSON.stringify(evidence)).not.toMatch(/"name"|"email"|"phone"/);
  });
});
