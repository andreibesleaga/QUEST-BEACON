// BEACON — anticipatory view-model tests (D7; ADR-034).
//
// The contract asserted here is the one that matters for a UI seam over a deterministic engine: the view
// model TRANSPORTS the engine's output and INVENTS nothing (Art. XII), every "nothing to show" carries a
// named reason (Art. XVI), and the replay is reproducible without reading a clock.
//
// Note (F-76): `vitest.config.ts` scopes coverage `include` to `src/**`, so nothing under `app/**` is
// measured by the 99% floor. These tests exist because the seam needs them, not because a gate counts them.
import { describe, it, expect } from 'vitest';
import {
  ANTICIPATORY_UNAVAILABLE_REASONS,
  REPLAY_LAG_HOURS,
  buildAnticipatoryView,
  eapForRegion,
} from './anticipatory.js';
import { SHIPPED_EAPS } from '@/application/anticipatory/eap-config.js';
import { parseEnsembleMemberFile } from '@/application/anticipatory/ensemble-evidence.js';
import { runAnticipatoryCycle } from '@/application/anticipatory/anticipatory-engine.js';
import { beginEpisode, stageTrigger } from '@/domain/early-action-protocol.js';
import roRun1 from '../../fixtures/anticipatory/ro-danube-discharge-ensemble-run-1.json';

const evaluated = (regionId: string) => {
  const view = buildAnticipatoryView(regionId);
  if (view.kind !== 'EVALUATED') throw new Error(`expected EVALUATED, got ${view.kind}/${view.reason}`);
  return view;
};

describe('buildAnticipatoryView — unavailability is always LABELLED, never blank (Art. XVI)', () => {
  it('names NO_PROTOCOL_FOR_REGION for a region no shipped protocol scopes', () => {
    const view = buildAnticipatoryView('atlantis');
    expect(view.kind).toBe('UNAVAILABLE');
    expect(view.kind === 'UNAVAILABLE' && view.reason).toBe('NO_PROTOCOL_FOR_REGION');
  });

  it('names NO_RECORDED_FORECAST when the protocol ships but no recorded forecast file does', () => {
    // us-ca ships a protocol; `fixtures/anticipatory/` ships recorded runs only for the Danube one.
    expect(eapForRegion('us-ca')).toBeDefined();
    const view = buildAnticipatoryView('us-ca');
    expect(view.kind === 'UNAVAILABLE' && view.reason).toBe('NO_RECORDED_FORECAST');
  });

  it('never substitutes another region protocol for a missing one', () => {
    expect(eapForRegion('atlantis')).toBeUndefined();
    for (const eap of SHIPPED_EAPS) expect(eapForRegion(eap.scope.regionId)?.id).toBe(eap.id);
  });

  it('every reason the view can carry is a member of the declared closed set', () => {
    for (const regionId of ['atlantis', 'us-ca', 'ro']) {
      const view = buildAnticipatoryView(regionId);
      if (view.kind === 'UNAVAILABLE') expect(ANTICIPATORY_UNAVAILABLE_REASONS).toContain(view.reason);
    }
  });
});

describe('buildAnticipatoryView — the figures are the ENGINE`s, not the seam`s (Art. XII)', () => {
  it('reproduces, field for field, what runAnticipatoryCycle returns for the same inputs', () => {
    // Independently re-run the engine here and demand deep equality. If the seam ever massaged, rounded,
    // re-ordered or re-derived a single figure, this fails — which is the whole point of the assertion.
    const view = evaluated('ro');
    const eap = view.eap;
    const file = parseEnsembleMemberFile(roRun1);
    const outcome = runAnticipatoryCycle({
      eap,
      priorState: beginEpisode({ eapId: eap.id, episodeId: 'replay-episode-1', at: new Date(Date.parse(file.issuedAt)).toISOString() }),
      forecast: { kind: 'ENSEMBLE_MEMBERS', file },
      nowMs: Date.parse(file.issuedAt) + REPLAY_LAG_HOURS * 3_600_000,
    });
    if (!('value' in outcome)) throw new Error('engine refused a shipped fixture');
    expect(view.cycles[0]?.evaluation).toEqual(outcome.value.evaluation);
    expect(view.cycles[0]?.state).toEqual(outcome.value.state);
    expect(view.cycles[0]?.approval).toEqual(outcome.value.approval);
    expect(view.cycles[0]?.ledger).toEqual(outcome.value.ledger);
  });

  it('reads `fired` off the engine state and the gate off the protocol — never re-deciding either', () => {
    const view = evaluated('ro');
    for (const cycle of view.cycles) {
      for (const row of cycle.stages) {
        expect(row.fired).toBe(cycle.state.firedStages.includes(row.stage));
        expect(row.trigger).toEqual(stageTrigger(view.eap, row.stage));
      }
    }
  });

  it('replays the recorded runs in order, threading the engine state (READINESS then ACTIVATION)', () => {
    const view = evaluated('ro');
    expect(view.cycles).toHaveLength(2);
    expect(view.cycles[0]?.evaluation.fired).toBe('READINESS');
    expect(view.cycles[0]?.state.state).toBe('READINESS');
    expect(view.cycles[1]?.evaluation.fired).toBe('ACTIVATION');
    expect(view.cycles[1]?.state.state).toBe('ACTIVATED');
    // The first cycle must still show ACTIVATION as NOT fired — the not-yet-fired rung has to be visible.
    expect(view.cycles[0]?.stages.find((s) => s.stage === 'ACTIVATION')?.fired).toBe(false);
    expect(view.cycles[1]?.stages.find((s) => s.stage === 'ACTIVATION')?.fired).toBe(true);
  });

  it('evaluates each run at its OWN issue instant + REPLAY_LAG_HOURS (no wall clock anywhere)', () => {
    const view = evaluated('ro');
    for (const cycle of view.cycles) {
      const issuedAt = cycle.evaluation.evidence?.issuedAt;
      expect(issuedAt).toBeDefined();
      expect(Date.parse(cycle.evaluation.evaluatedAt) - Date.parse(issuedAt as string)).toBe(
        REPLAY_LAG_HOURS * 3_600_000,
      );
    }
  });

  it('is deterministic: two builds are deep-equal (replayable, diffable, demo-stable)', () => {
    expect(buildAnticipatoryView('ro')).toEqual(buildAnticipatoryView('ro'));
  });
});

describe('buildAnticipatoryView — honesty about the source (F-34, Art. XVI)', () => {
  it('labels every reading FIXTURE and never claims a live tier', () => {
    for (const cycle of evaluated('ro').cycles) {
      expect(cycle.evaluation.evidence?.sourceTier).toBe('FIXTURE');
      expect(JSON.stringify(cycle.evaluation)).not.toContain('"sourceTier":"LIVE"');
    }
  });

  it('carries the file`s own source statement and the domain honesty label, unmodified', () => {
    const evidence = evaluated('ro').cycles[0]?.evaluation.evidence;
    expect(evidence?.sourceStatement).toContain('no wired live ensemble source');
    expect(evidence?.label).toContain('NOT a calibrated probability');
  });
});

describe('buildAnticipatoryView — Art. XIII: the seam carries no emission and no task', () => {
  it('produces only governance APPEND INPUTS, never an emitted or tasked artifact', () => {
    for (const cycle of evaluated('ro').cycles) {
      for (const entry of cycle.ledger) expect(entry.action.startsWith('EAP_')).toBe(true);
      // The suggested ids are ids from the protocol`s pre-agreed list — nothing else may appear there.
      const declared = evaluated('ro').eap.actions.map((a) => a.id);
      for (const id of cycle.evaluation.suggestedActionIds) expect(declared).toContain(id);
    }
  });

  it('leaves approval PENDING with a named responsible role — never auto-approved', () => {
    for (const cycle of evaluated('ro').cycles) {
      expect(cycle.approval.state).toBe('PENDING');
      expect(cycle.approval.state === 'PENDING' && cycle.approval.responsibleRoles.length).toBeGreaterThan(0);
    }
  });
});
