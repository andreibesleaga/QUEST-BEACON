// BEACON — anticipatory-engine tests (D2; ADR-034 §2/§4/§5/§6, V6/V8). Deterministic: injected clock,
// injected SpatialPort, recorded fixture forecast, no network.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SpatialPort } from '@/ports/index.js';
import type { AlertSinkPort } from '@/ports/logistics.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type { OrgId, ResourceId, ShelterId } from '@/domain/value-objects/ids.js';
import type { EarlyActionProtocol, TriggerState } from '@/domain/early-action-protocol.js';
import { asId } from '@/domain/value-objects/ids.js';
import { makeResource } from '@/domain/resource.js';
import { makeShelter } from '@/domain/shelter.js';
import { beginEpisode, recordStageFired, transitionEap } from '@/domain/early-action-protocol.js';
import { err, isErr, isOk, ok } from '@/domain/shared/result.js';
import { InvariantViolation } from '@/domain/errors.js';
import { parseEnsembleMemberFile } from './ensemble-evidence.js';
import type { EnsembleMemberFile } from './ensemble-evidence.js';
import type { TriggerForecast } from './trigger-evaluator.js';
import { shippedEap } from './eap-config.js';
import { ANTICIPATORY_CANNOT_EMIT, runAnticipatoryCycle } from './anticipatory-engine.js';

const CLOCK = '2026-07-05T22:00:00Z';
const NOW = Date.parse(CLOCK);
const ORG = asId<OrgId>('org-1');
const EAP = shippedEap('ro-danube-flood')!;

const load = (name: string): EnsembleMemberFile =>
  parseEnsembleMemberFile(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../../fixtures/anticipatory/${name}.json`, import.meta.url)),
        'utf8',
      ),
    ),
  );
const RUN_1 = load('ro-danube-discharge-ensemble-run-1');
const RUN_2 = load('ro-danube-discharge-ensemble-run-2');
const members = (file: EnsembleMemberFile): TriggerForecast => ({ kind: 'ENSEMBLE_MEMBERS', file });

// Just OUTSIDE the shipped Romania scope polygon (lon 27.88…28.24, lat 45.28…45.54) and within 20 km of it.
const NEAR_EAST: Position = [28.3, 45.4];
const NEAR_WEST: Position = [27.8, 45.4];
const INSIDE: Position = [28.0, 45.4];
const point = (coordinates: Position) => ({ type: 'Point' as const, coordinates });

function fakeSpatial(inside: readonly Position[] = [INSIDE]): SpatialPort {
  return {
    pointInPolygon: (p) => ok(inside.some((ip) => ip[0] === p[0] && ip[1] === p[1])),
    buffer: () => ok(EAP.scope.geometry as never),
    intersect: () => ok(true),
  };
}

const resource = (id: string, kind: Parameters<typeof makeResource>[0]['kind'], geom: Position) =>
  makeResource({
    id: asId<ResourceId>(id),
    kind,
    status: 'AVAILABLE',
    orgId: ORG,
    geom: point(geom),
  });

const shelter = (id: string, geom: Position) =>
  makeShelter({
    id: asId<ShelterId>(id),
    status: 'OPEN',
    capacity: 100,
    occupancy: 10,
    geom: point(geom),
  });

const CANDIDATES = {
  resources: [
    resource('res-supply-1', 'SUPPLY', NEAR_EAST),
    resource('res-supply-2', 'SUPPLY', NEAR_WEST),
    resource('res-crew-1', 'CREW', NEAR_EAST),
    resource('res-inside', 'ENGINE', INSIDE),
  ],
  shelters: [shelter('shl-1', NEAR_WEST)],
};

const idle = (): TriggerState =>
  beginEpisode({ eapId: EAP.id, episodeId: 'ep-1', at: '2026-07-05T06:00:00Z' });
const activated = (at = '2026-07-05T20:00:00Z'): TriggerState =>
  recordStageFired(
    recordStageFired(transitionEap(idle(), 'ACTIVATED', at), 'READINESS'),
    'ACTIVATION',
  );

describe('one cycle: evaluate → transition → suggest → record', () => {
  it('advances the state ONLY through the domain state machine', () => {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_1),
      nowMs: NOW,
    });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    expect(run.value.evaluation.fired).toBe('READINESS');
    expect(run.value.state.state).toBe('READINESS');
    expect(run.value.state.firedStages).toEqual(['READINESS']);
    expect(run.value.state.enteredAt).toBe(run.value.evaluation.evaluatedAt);
  });

  it('advances the forecast high-water mark only from a reading that PASSED the vintage gate', () => {
    const accepted = runAnticipatoryCycle({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_1),
      nowMs: NOW,
    });
    expect(isOk(accepted) && accepted.value.state.latestForecastIssuedAt).toBe(RUN_1.issuedAt);
    const refused = runAnticipatoryCycle({
      eap: EAP,
      priorState: idle(),
      forecast: members({ ...RUN_1, issuedAt: '2026-07-09T00:00:00Z' }),
      nowMs: NOW,
    });
    expect(isOk(refused) && refused.value.state.latestForecastIssuedAt).toBeUndefined();
  });

  it('closes an over-running activation through expireEpisode, recording the reserved condition id', () => {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: activated('2026-07-05T20:00:00Z'),
      nowMs: Date.parse('2026-07-05T20:00:00Z') + 168 * 3_600_000,
    });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    expect(run.value.state.state).toBe('STOPPED');
    expect(run.value.state.stopConditionId).toBe('system-max-duration-elapsed');
    expect(run.value.ledger.map((e) => e.action)).toContain('EAP_STOP');
  });
});

describe('activation SUGGESTS into the existing pre-positioning seam and can do nothing else (FR-AA-4)', () => {
  const activate = (
    over: Partial<Parameters<typeof runAnticipatoryCycle>[0]> = {},
    eap: EarlyActionProtocol = EAP,
  ) =>
    runAnticipatoryCycle(
      {
        eap,
        priorState: idle(),
        forecast: members(RUN_2),
        nowMs: NOW,
        candidates: CANDIDATES,
        ...over,
      },
      fakeSpatial(),
    );

  it('ranks the registry against the EAP scope and labels the method it used', () => {
    const run = activate();
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    expect(run.value.evaluation.fired).toBe('ACTIVATION');
    expect(run.value.prePositioning?.extentAvailable).toBe(true);
    expect(run.value.prePositioning?.method).toMatch(/first-order ranking/);
    expect(run.value.suggestions.length).toBeGreaterThan(0);
  });

  it('excludes assets already inside the hazard footprint (the suggester’s own rule, unchanged)', () => {
    const run = activate();
    expect(isOk(run) && run.value.suggestions.map((s) => s.refId)).not.toContain('res-inside');
  });

  it('annotates each suggestion with the pre-agreed action ids it would satisfy', () => {
    const run = activate();
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    const supply = run.value.suggestions.find((s) => s.refId === 'res-supply-1');
    expect(supply?.satisfiesActionIds).toEqual(['preposition-dewatering-supplies']);
    const crew = run.value.suggestions.find((s) => s.refId === 'res-crew-1');
    // A CREW matches no PREPOSITION action in this protocol — an honest empty list, not a forced match.
    expect(crew?.satisfiesActionIds).toEqual([]);
    const shel = run.value.suggestions.find((s) => s.kind === 'SHELTER');
    expect(shel?.satisfiesActionIds).toEqual([
      'preposition-dewatering-supplies',
      'preposition-medical-cache',
    ]);
  });

  it('never suggests a TASK action — tasking is not pre-positioning', () => {
    const run = activate();
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    for (const s of run.value.suggestions)
      expect(s.satisfiesActionIds).not.toContain('stage-standby-crew');
  });

  it('marks every suggestion as requiring approval, and names who may give it', () => {
    const run = activate();
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    for (const s of run.value.suggestions) {
      expect(s.requiresApproval).toBe(true);
      expect(s.authorizerRoles).toEqual(['EM']);
    }
  });

  it('produces NO suggestions without a registry or without a SpatialPort (labeled "not yet", never faked)', () => {
    const noRegistry = runAnticipatoryCycle(
      { eap: EAP, priorState: idle(), forecast: members(RUN_2), nowMs: NOW },
      fakeSpatial(),
    );
    expect(isOk(noRegistry) && noRegistry.value.suggestions).toEqual([]);
    expect(isOk(noRegistry) && noRegistry.value.prePositioning).toBeUndefined();
    const noSpatial = runAnticipatoryCycle({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_2),
      nowMs: NOW,
      candidates: CANDIDATES,
    });
    expect(isOk(noSpatial) && noSpatial.value.suggestions).toEqual([]);
  });

  it('produces no suggestions while the protocol is only at READINESS', () => {
    const run = runAnticipatoryCycle(
      {
        eap: EAP,
        priorState: idle(),
        forecast: members(RUN_1),
        nowMs: NOW,
        candidates: CANDIDATES,
      },
      fakeSpatial(),
    );
    expect(isOk(run) && run.value.state.state).toBe('READINESS');
    expect(isOk(run) && run.value.suggestions).toEqual([]);
  });

  it('propagates a SpatialPort failure as an error instead of a partial list', () => {
    const failing: SpatialPort = {
      pointInPolygon: () => err(new InvariantViolation('spatial down')),
      buffer: () => ok(EAP.scope.geometry as never),
      intersect: () => ok(true),
    };
    const run = runAnticipatoryCycle(
      {
        eap: EAP,
        priorState: idle(),
        forecast: members(RUN_2),
        nowMs: NOW,
        candidates: CANDIDATES,
      },
      failing,
    );
    expect(isErr(run)).toBe(true);
  });

  it('honours an explicit near-radius override', () => {
    const run = activate({ nearRadiusMeters: 1 });
    expect(isOk(run) && run.value.suggestions).toEqual([]);
  });
});

describe('the PRE-ARRANGED resource ceiling is enforced and its effect is reported', () => {
  const capped = (ceiling: EarlyActionProtocol['resourceCeiling']) =>
    runAnticipatoryCycle(
      {
        eap: { ...EAP, resourceCeiling: ceiling },
        priorState: idle(),
        forecast: members(RUN_2),
        nowMs: NOW,
        candidates: CANDIDATES,
      },
      fakeSpatial(),
    );

  it('caps the total at maxResources and says how many the ceiling dropped', () => {
    const run = capped({ maxResources: 2, basis: 'illustrative' });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    expect(run.value.suggestions.length).toBe(2);
    expect(run.value.ceiling).toEqual({ maxResources: 2, kept: 2, droppedByCeiling: 2 });
  });

  it('caps per resource kind without dropping other kinds', () => {
    const run = capped({ maxResources: 10, maxByKind: { SUPPLY: 1 }, basis: 'illustrative' });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    const kinds = run.value.suggestions.map((s) => s.resourceKind ?? 'SHELTER');
    expect(kinds.filter((k) => k === 'SUPPLY').length).toBe(1);
    expect(kinds).toContain('CREW');
    expect(kinds).toContain('SHELTER');
  });

  it('reports a ceiling that dropped nothing as dropping nothing', () => {
    const run = capped({ maxResources: 99, basis: 'illustrative' });
    expect(isOk(run) && run.value.ceiling?.droppedByCeiling).toBe(0);
  });
});

describe('the governance records the cycle produces (FR-GOV-1)', () => {
  it('always records the evaluation, with the FULL evaluation as its evidence', () => {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_1),
      nowMs: NOW,
    });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    const evalEntry = run.value.ledger.find((e) => e.action === 'EAP_EVAL');
    expect(evalEntry?.target).toBe('eap:ro-danube-flood#ep-1');
    expect(evalEntry?.at).toBe(run.value.evaluation.evaluatedAt);
    expect(evalEntry?.regionId).toBe('ro');
    expect(evalEntry?.evidence).toBe(run.value.evaluation);
  });

  it('records a transition and an activation when one happens', () => {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_2),
      nowMs: NOW,
    });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    expect(run.value.ledger.map((e) => e.action)).toEqual([
      'EAP_EVAL',
      'EAP_TRANSITION',
      'EAP_ACTIVATE',
    ]);
  });

  it('records only the evaluation when nothing changed', () => {
    const run = runAnticipatoryCycle({ eap: EAP, priorState: idle(), nowMs: NOW });
    expect(isOk(run) && run.value.ledger.map((e) => e.action)).toEqual(['EAP_EVAL']);
  });

  it('records the acting role on a stop', () => {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: activated('2026-07-05T20:00:00Z'),
      nowMs: Date.parse('2026-07-05T20:00:00Z') + 200 * 3_600_000,
    });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    expect(run.value.ledger.find((e) => e.action === 'EAP_STOP')?.actorRole).toBe('EM');
  });

  it('carries NO person-identifying field into any record (Art. XIV)', () => {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_2),
      nowMs: NOW,
    });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    const serialized = JSON.stringify(run.value.ledger).toLowerCase();
    for (const key of ['"name"', '"email"', '"phone"', '"address"', '"reporter"', '"contact"']) {
      expect(serialized).not.toContain(key);
    }
  });
});

describe('the SOP approval chain (FR-GOV-2 / FST-4) — reused, not reinvented', () => {
  it('names the primary authorizer before the fallback window elapses', () => {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_2),
      nowMs: NOW,
    });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    expect(run.value.approval).toEqual({
      state: 'PENDING',
      responsibleRoles: ['EM'],
      delegationOpen: false,
    });
  });

  it('opens the delegation to the fallback role once the window elapses, without granting approval', () => {
    const state = activated('2026-07-05T20:00:00Z'); // fallbackAfterMinutes = 60
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: state,
      nowMs: Date.parse('2026-07-05T21:30:00Z'),
    });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    expect(run.value.approval.state).toBe('PENDING');
    if (run.value.approval.state !== 'PENDING') return;
    expect(run.value.approval.responsibleRoles).toEqual(['EM', 'VERIFIER']);
    expect(run.value.approval.delegationOpen).toBe(true);
  });

  it('records which role actually approved when a human attempt is supplied', () => {
    const state = activated('2026-07-05T20:00:00Z');
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: state,
      nowMs: Date.parse('2026-07-05T21:30:00Z'),
      approvalAttempt: { actorId: asId('user-1'), role: 'VERIFIER', at: '2026-07-05T21:30:00Z' },
    });
    if (!isOk(run) || run.value.approval.state !== 'APPROVED')
      return expect.unreachable('expected an approval');
    expect(run.value.approval.approval.approvedByRole).toBe('VERIFIER');
    expect(run.value.approval.approval.delegated).toBe(true);
  });

  it('names the role that DID approve on every suggestion once approval is granted', () => {
    const run = runAnticipatoryCycle(
      {
        eap: EAP,
        priorState: activated('2026-07-05T20:00:00Z'),
        nowMs: Date.parse('2026-07-05T21:30:00Z'),
        approvalAttempt: { actorId: asId('user-1'), role: 'VERIFIER', at: '2026-07-05T21:30:00Z' },
        candidates: CANDIDATES,
      },
      fakeSpatial(),
    );
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    expect(run.value.approval.state).toBe('APPROVED');
    expect(run.value.suggestions.length).toBeGreaterThan(0);
    for (const s of run.value.suggestions) expect(s.authorizerRoles).toEqual(['VERIFIER']);
  });

  it('never grants approval to a role that is not yet responsible', () => {
    const state = activated('2026-07-05T20:00:00Z');
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: state,
      nowMs: Date.parse('2026-07-05T20:10:00Z'),
      approvalAttempt: { actorId: asId('user-1'), role: 'VERIFIER', at: '2026-07-05T20:10:00Z' },
    });
    expect(isOk(run) && run.value.approval.state).toBe('PENDING');
  });
});

// =========================================================================================================
// Art. XIII, STRUCTURALLY. The engine is suggestion/DRAFT-only BY DESIGN, and the proof is at the TYPE level,
// checked by `tsc` — not by a runtime branch. Each `@ts-expect-error` is itself an assertion: if the
// guarantee were weakened, the directive would become an "unused '@ts-expect-error'" tsc ERROR (Gate 2).
// =========================================================================================================
describe('an anticipatory outcome is structurally not emittable', () => {
  const sink: AlertSinkPort = { emit: async () => ok(undefined) };

  it('asserts at compile time that no field of the outcome is an EmittableAlert', () => {
    expect(ANTICIPATORY_CANNOT_EMIT).toBe(true);
  });

  it('cannot be handed to AlertSinkPort.emit — the evaluation, the state, or a suggestion', async () => {
    const run = runAnticipatoryCycle(
      {
        eap: EAP,
        priorState: idle(),
        forecast: members(RUN_2),
        nowMs: NOW,
        candidates: CANDIDATES,
      },
      fakeSpatial(),
    );
    if (!isOk(run)) return expect.unreachable('cycle must succeed');

    // @ts-expect-error — a TriggerEvaluation is not an EmittableAlert. THIS IS THE GUARANTEE.
    await sink.emit(run.value.evaluation);
    // @ts-expect-error — nor is the protocol state.
    await sink.emit(run.value.state);
    // @ts-expect-error — nor is a pre-positioning suggestion.
    await sink.emit(run.value.suggestions[0]);
    // @ts-expect-error — nor is a governance record.
    await sink.emit(run.value.ledger[0]);

    // And there is nothing alert-shaped in the outcome to launder: no capStatus anywhere.
    expect(JSON.stringify(run.value)).not.toMatch(/capStatus|ACTUAL|approvedBy/);
  });

  it('holds no port that writes: the outcome is data a caller must act on', () => {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_2),
      nowMs: NOW,
    });
    if (!isOk(run)) return expect.unreachable('cycle must succeed');
    // The ledger is a list of APPEND INPUTS, not appended entries: no seq, no hash, nothing chained here.
    for (const entry of run.value.ledger) {
      expect(entry).not.toHaveProperty('seq');
      expect(entry).not.toHaveProperty('hash');
    }
  });
});
