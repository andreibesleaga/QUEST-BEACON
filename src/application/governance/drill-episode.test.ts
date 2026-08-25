// BEACON — DRILL episode tests (MW-D/D4; ADR-034 §7). Deterministic + replayable: the clock is a fixed
// sequence, so the same episode yields byte-identical ledger entries on every run (the demo-repeatability
// property, ADR-034 §7). No adapters, no network.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { EXERCISE_LABEL } from '@/domain/drill.js';
import type { ApprovalAttempt, SopChainConfig } from '@/domain/governance.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import type { DrillRecord, DrillRecorderPort } from '@/ports/governance.js';
import type { DrillAlert } from '@/domain/drill.js';
import { isDrillArtifact } from '@/domain/drill.js';
import { DomainError } from '@/domain/errors.js';
import { err, ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { FakeGovernanceLedger } from '../../../tests/_harness/fakes/fake-governance.js';
import { runDrillEpisode } from './drill-episode.js';

const T0 = '2026-07-05T22:00:00.000Z';
const em = asId<AppUserId>('u-em-1');
const chain: SopChainConfig = { authorizerRole: 'EM', fallbackRole: 'VERIFIER', fallbackAfterMinutes: 30 };

/** A fixed clock: the same instant every call, so an episode is reproducible by construction. */
const clock = () => T0;

class SpyRecorder implements DrillRecorderPort {
  public readonly seen: DrillAlert[] = [];
  public fail = false;
  private readonly log: DrillRecord[] = [];

  record(artifact: DrillAlert, at: string): Result<DrillRecord, DomainError> {
    this.seen.push(artifact);
    if (this.fail) return err(new DomainError('CONFLICT', 'injected recorder failure'));
    const rec: DrillRecord = {
      alertId: String(artifact.id),
      capStatus: 'EXERCISE',
      label: artifact.label,
      recordedAt: at,
      ledgerHash: 'rec-hash',
      sink: 'DRILL_RECORDER',
    };
    this.log.push(rec);
    return ok(rec);
  }

  get records(): readonly DrillRecord[] {
    return this.log;
  }
}

const input = {
  episodeId: 'ep-1',
  incidentId: asId<IncidentId>('inc-ro-1'),
  alertId: asId<AlertId>('al-drill-1'),
  category: 'Met',
  severity: 'SEVERE',
} as const;

const approval: ApprovalAttempt = { actorId: em, role: 'EM', at: T0 };

describe('runDrillEpisode', () => {
  it('runs START → approve → record → END and produces an EXERCISE artifact', () => {
    const ledger = new FakeGovernanceLedger();
    const recorder = new SpyRecorder();
    const res = runDrillEpisode({ ledger, recorder, clock, sopChain: chain }, { ...input, approvalAttempt: approval });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.artifact.capStatus).toBe('EXERCISE');
    expect(res.value.artifact.label).toBe(EXERCISE_LABEL);
    expect(isDrillArtifact(res.value.artifact)).toBe(true);
    expect(res.value.approval.state).toBe('APPROVED');
    expect(res.value.record?.sink).toBe('DRILL_RECORDER');
    expect(ledger.entries.map((e) => e.action)).toEqual(['DRILL_START', 'SOP_APPROVE', 'DRILL_END']);
    expect(res.value.ledgerHashes).toEqual(['h-1', 'h-2', 'rec-hash', 'h-3']);
  });

  it('records WHO approved the exercise in the artifact, but never in `approvedBy`', () => {
    const res = runDrillEpisode(
      { ledger: new FakeGovernanceLedger(), recorder: new SpyRecorder(), clock, sopChain: chain },
      { ...input, approvalAttempt: approval },
    );
    expect(isOk(res) && res.value.artifact.exerciseApprovedBy).toBe(em);
    expect(isOk(res) && res.value.artifact.approvedBy).toBeUndefined();
  });

  it('records NOTHING when nobody approved — Art. XIII holds inside a drill too', () => {
    const recorder = new SpyRecorder();
    const ledger = new FakeGovernanceLedger();
    const res = runDrillEpisode({ ledger, recorder, clock, sopChain: chain }, input);
    expect(isOk(res)).toBe(true);
    expect(isOk(res) && res.value.approval.state).toBe('PENDING');
    expect(isOk(res) && res.value.record).toBeUndefined();
    expect(recorder.records).toHaveLength(0);
    expect(ledger.entries.map((e) => e.action)).toEqual(['DRILL_START', 'DRILL_END']);
  });

  it('is REPLAYABLE: two runs on the same clock produce identical entries and hashes', () => {
    const run = () => {
      const ledger = new FakeGovernanceLedger();
      const res = runDrillEpisode(
        { ledger, recorder: new SpyRecorder(), clock, sopChain: chain },
        { ...input, approvalAttempt: approval },
      );
      return { entries: ledger.entries, res };
    };
    const a = run();
    const b = run();
    expect(a.entries).toEqual(b.entries);
    expect(isOk(a.res) && isOk(b.res) && a.res.value.artifact).toEqual(isOk(b.res) ? b.res.value.artifact : undefined);
  });

  it('carries the hazard area through when given, and defaults the SOP chain when not', () => {
    const area = { type: 'Point', coordinates: [25.6, 45.1] } as const;
    const res = runDrillEpisode(
      { ledger: new FakeGovernanceLedger(), recorder: new SpyRecorder(), clock },
      { ...input, area, approvalAttempt: approval },
    );
    expect(isOk(res) && res.value.artifact.area).toEqual(area);
  });

  it('fails the episode closed when the START record cannot be written', () => {
    const ledger = new FakeGovernanceLedger();
    ledger.failNextAppend = 'CONFLICT';
    const res = runDrillEpisode({ ledger, recorder: new SpyRecorder(), clock, sopChain: chain }, input);
    expect(isErr(res) && res.error.code).toBe('CONFLICT');
    expect(ledger.entries).toHaveLength(0);
  });

  it('fails the episode closed on an unauthorized approval attempt', () => {
    const bad: ApprovalAttempt = { actorId: asId<AppUserId>('u-pub-1'), role: 'PUBLIC', at: T0 };
    const res = runDrillEpisode(
      { ledger: new FakeGovernanceLedger(), recorder: new SpyRecorder(), clock, sopChain: chain },
      { ...input, approvalAttempt: bad },
    );
    expect(isErr(res) && res.error.code).toBe('UNAUTHORIZED');
  });

  it('fails the episode closed when the recorder refuses the artifact', () => {
    const recorder = new SpyRecorder();
    recorder.fail = true;
    const res = runDrillEpisode(
      { ledger: new FakeGovernanceLedger(), recorder, clock, sopChain: chain },
      { ...input, approvalAttempt: approval },
    );
    expect(isErr(res) && res.error.code).toBe('CONFLICT');
  });

  it('fails the episode closed when the END record cannot be written', () => {
    const ledger = new FakeGovernanceLedger();
    const recorder = new SpyRecorder();
    // START succeeds; the END append is the one that fails.
    const original = ledger.append.bind(ledger);
    let calls = 0;
    ledger.append = (i) => {
      calls += 1;
      if (calls === 2) return err(new DomainError('CONFLICT', 'injected END failure'));
      return original(i);
    };
    const res = runDrillEpisode({ ledger, recorder, clock, sopChain: chain }, input);
    expect(isErr(res) && res.error.message).toMatch(/injected END failure/);
  });
});
