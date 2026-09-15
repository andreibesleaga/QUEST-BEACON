// BEACON — EARLY_ACTION_PROTOCOL + state-machine tests (D2; ADR-034 §1/§2/§6, V5/V8).
// Deterministic: fixed clock, no network, no filesystem, no wall-clock read anywhere.
import { describe, it, expect } from 'vitest';
import { InvalidTransition, InvariantViolation, Unauthorized } from './errors.js';
import type { EapState, EarlyActionProtocol, TriggerState } from './early-action-protocol.js';
import {
  EAP_DURATION_STOP_ID,
  EAP_STAGES,
  EAP_STATES,
  EAP_TRANSITIONS,
  beginEpisode,
  expireEpisode,
  isDurationExpired,
  makeEarlyActionProtocol,
  recordForecastVintage,
  recordStageFired,
  stageTrigger,
  stopEpisode,
  transitionEap,
} from './early-action-protocol.js';

const CLOCK = '2026-07-05T22:00:00Z';
const NOW = Date.parse(CLOCK);

const PROVENANCE =
  'Illustrative demonstration protocol, structurally faithful to the IFRC element list. It is NOT approved ' +
  'or endorsed by any National Society, hydromet service or civil-protection authority.';

const SQUARE = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [27.9, 45.3],
      [28.2, 45.3],
      [28.2, 45.5],
      [27.9, 45.5],
      [27.9, 45.3],
    ] as const,
  ],
};

const READINESS = {
  source: 'cached forecast file supplied to the evaluator',
  parameter: 'river discharge',
  unit: 'cubic metres per second',
  threshold: 6500,
  comparator: 'GTE' as const,
  minMembersFraction: 0.3,
  minLikelihoodClass: 'LIKELY' as const,
  leadTimeHours: 120,
};

const ACTIVATION = {
  ...READINESS,
  threshold: 7200,
  minMembersFraction: 0.5,
  minLikelihoodClass: 'VERY_LIKELY' as const,
  leadTimeHours: 48,
};

const VALID: EarlyActionProtocol = {
  id: 'test-flood',
  label: 'Test flood protocol',
  hazard: 'FLOOD',
  status: 'ILLUSTRATIVE',
  provenance: PROVENANCE,
  scope: { regionId: 'ro', geometry: SQUARE },
  triggers: { readiness: READINESS, activation: ACTIVATION },
  actions: [
    {
      id: 'preposition-pumps',
      label: 'Pre-position pumps',
      kind: 'PREPOSITION',
      resourceKind: 'SUPPLY',
    },
    { id: 'stage-crew', label: 'Stage a crew', kind: 'TASK', resourceKind: 'CREW' },
    { id: 'brief-duty-officer', label: 'Brief the duty officer', kind: 'NOTIFY_INTERNAL' },
  ],
  resourceCeiling: {
    maxResources: 6,
    maxByKind: { SUPPLY: 4, CREW: 2 },
    basis: 'illustrative ceiling',
  },
  approval: { authorizerRole: 'EM', fallbackRole: 'VERIFIER', fallbackAfterMinutes: 60 },
  stop: {
    conditions: [{ id: 'forecast-receded', label: 'The forecast receded' }],
    authorizerRole: 'EM',
    maxDurationHours: 168,
  },
};

const eapWith = (over: Partial<EarlyActionProtocol>): EarlyActionProtocol => ({
  ...VALID,
  ...over,
});

describe('makeEarlyActionProtocol — the shape a valid EAP must have', () => {
  it('accepts a protocol carrying all six IFRC elements and returns it unchanged', () => {
    const eap = makeEarlyActionProtocol(VALID);
    expect(eap).toBe(VALID);
    // The six elements, one assertion each: two-stage trigger, actions, ceiling, approval, scope, STOP.
    expect(Object.keys(eap.triggers)).toEqual(['readiness', 'activation']);
    expect(eap.actions.length).toBe(3);
    expect(eap.resourceCeiling.maxResources).toBe(6);
    expect(eap.approval.authorizerRole).toBe('EM');
    expect(eap.scope.regionId).toBe('ro');
    expect(eap.stop.conditions.map((c) => c.id)).toEqual(['forecast-receded']);
  });

  it('has NO monetary, donor or budget field anywhere in the ceiling (ADR-035 §4 PERMANENTLY-OUT)', () => {
    const keys = Object.keys(VALID.resourceCeiling)
      .map((k) => k.toLowerCase())
      .join(' ');
    for (const banned of ['currency', 'budget', 'donor', 'cost', 'usd', 'amount']) {
      expect(keys).not.toContain(banned);
    }
  });

  const bad: readonly [string, EarlyActionProtocol][] = [
    ['a non-slug id', eapWith({ id: '../etc/passwd' })],
    ['an upper-case id', eapWith({ id: 'RO-Flood' })],
    ['a blank label', eapWith({ label: '   ' })],
    ['an unknown hazard', eapWith({ hazard: 'METEOR' as EarlyActionProtocol['hazard'] })],
    [
      'a status claiming endorsement',
      eapWith({ status: 'ENDORSED' as EarlyActionProtocol['status'] }),
    ],
    ['a provenance too short to say what it is not', eapWith({ provenance: 'demo only' })],
    ['a non-slug regionId', eapWith({ scope: { ...VALID.scope, regionId: 'Ro/Flood' } })],
    [
      'a scope that is not a Polygon',
      eapWith({
        scope: {
          ...VALID.scope,
          geometry: { type: 'Point', coordinates: [0, 0] } as unknown as typeof SQUARE,
        },
      }),
    ],
    [
      'a scope ring with too few positions',
      eapWith({
        scope: {
          ...VALID.scope,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          },
        },
      }),
    ],
    [
      'an unclosed scope ring',
      eapWith({
        scope: {
          ...VALID.scope,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
            ],
          },
        },
      }),
    ],
    [
      'an unknown comparator',
      eapWith({
        triggers: {
          readiness: { ...READINESS, comparator: 'NEAR' as 'GTE' },
          activation: ACTIVATION,
        },
      }),
    ],
    [
      'an unknown likelihood class',
      eapWith({
        triggers: {
          readiness: { ...READINESS, minLikelihoodClass: 'CERTAIN' as 'LIKELY' },
          activation: ACTIVATION,
        },
      }),
    ],
    [
      'a non-finite threshold',
      eapWith({
        triggers: { readiness: { ...READINESS, threshold: NaN }, activation: ACTIVATION },
      }),
    ],
    [
      'a member fraction above 1',
      eapWith({
        triggers: { readiness: { ...READINESS, minMembersFraction: 1.2 }, activation: ACTIVATION },
      }),
    ],
    [
      'a zero lead time',
      eapWith({
        triggers: { readiness: { ...READINESS, leadTimeHours: 0 }, activation: ACTIVATION },
      }),
    ],
    [
      'a blank trigger source',
      eapWith({ triggers: { readiness: { ...READINESS, source: ' ' }, activation: ACTIVATION } }),
    ],
    [
      'a blank trigger parameter',
      eapWith({ triggers: { readiness: { ...READINESS, parameter: '' }, activation: ACTIVATION } }),
    ],
    [
      'a blank trigger unit',
      eapWith({ triggers: { readiness: { ...READINESS, unit: '' }, activation: ACTIVATION } }),
    ],
    [
      'two stages measuring different parameters',
      eapWith({
        triggers: { readiness: READINESS, activation: { ...ACTIVATION, parameter: 'rainfall' } },
      }),
    ],
    [
      'two stages measuring different units',
      eapWith({
        triggers: { readiness: READINESS, activation: { ...ACTIVATION, unit: 'millimetres' } },
      }),
    ],
    [
      'two stages using different comparators',
      eapWith({
        triggers: { readiness: READINESS, activation: { ...ACTIVATION, comparator: 'LTE' } },
      }),
    ],
    [
      'an ACTIVATION stage with a LONGER lead time than READINESS (an inverted ladder)',
      eapWith({
        triggers: { readiness: READINESS, activation: { ...ACTIVATION, leadTimeHours: 240 } },
      }),
    ],
    [
      'an ACTIVATION stage easier to reach than READINESS by member share',
      eapWith({
        triggers: { readiness: READINESS, activation: { ...ACTIVATION, minMembersFraction: 0.1 } },
      }),
    ],
    [
      'an ACTIVATION stage less likely than READINESS',
      eapWith({
        triggers: {
          readiness: READINESS,
          activation: { ...ACTIVATION, minLikelihoodClass: 'POSSIBLE' },
        },
      }),
    ],
    ['no actions at all', eapWith({ actions: [] })],
    [
      'duplicate action ids',
      eapWith({ actions: [VALID.actions[0]!, { ...VALID.actions[0]!, label: 'again' }] }),
    ],
    ['a non-slug action id', eapWith({ actions: [{ ...VALID.actions[0]!, id: 'Pre Position' }] })],
    ['a blank action label', eapWith({ actions: [{ ...VALID.actions[0]!, label: '' }] })],
    [
      'an unknown action kind',
      eapWith({ actions: [{ ...VALID.actions[0]!, kind: 'BROADCAST' as 'TASK' }] }),
    ],
    [
      'a PREPOSITION action with no resourceKind',
      eapWith({
        actions: [{ id: 'preposition-x', label: 'Pre-position something', kind: 'PREPOSITION' }],
      }),
    ],
    [
      'a NOTIFY_INTERNAL action that claims a resourceKind',
      eapWith({
        actions: [{ id: 'brief-x', label: 'Brief', kind: 'NOTIFY_INTERNAL', resourceKind: 'CREW' }],
      }),
    ],
    [
      'an unknown resourceKind',
      eapWith({ actions: [{ ...VALID.actions[0]!, resourceKind: 'DRONE' as 'CREW' }] }),
    ],
    [
      'a zero resource ceiling',
      eapWith({ resourceCeiling: { ...VALID.resourceCeiling, maxResources: 0 } }),
    ],
    [
      'a fractional resource ceiling',
      eapWith({ resourceCeiling: { ...VALID.resourceCeiling, maxResources: 2.5 } }),
    ],
    [
      'a ceiling with no stated basis',
      eapWith({ resourceCeiling: { ...VALID.resourceCeiling, basis: '  ' } }),
    ],
    [
      'a per-kind cap above the total ceiling',
      eapWith({
        resourceCeiling: { maxResources: 2, maxByKind: { SUPPLY: 5 }, basis: 'illustrative' },
      }),
    ],
    [
      'a per-kind cap of zero',
      eapWith({
        resourceCeiling: { maxResources: 2, maxByKind: { SUPPLY: 0 }, basis: 'illustrative' },
      }),
    ],
    [
      'a per-kind cap keyed by something that is not a ResourceKind',
      eapWith({
        resourceCeiling: {
          maxResources: 2,
          maxByKind: { DRONE: 1 } as never,
          basis: 'illustrative',
        },
      }),
    ],
    [
      'an approval role that cannot approve (RESPONDER)',
      eapWith({ approval: { ...VALID.approval, authorizerRole: 'RESPONDER' as 'EM' } }),
    ],
    [
      'a fallback role identical to the authorizer (a self-delegation no-op)',
      eapWith({ approval: { ...VALID.approval, fallbackRole: 'EM' } }),
    ],
    [
      'a non-positive fallback window',
      eapWith({ approval: { ...VALID.approval, fallbackAfterMinutes: 0 } }),
    ],
    ['a STOP block with no conditions', eapWith({ stop: { ...VALID.stop, conditions: [] } })],
    [
      'duplicate stop condition ids',
      eapWith({
        stop: {
          ...VALID.stop,
          conditions: [VALID.stop.conditions[0]!, { ...VALID.stop.conditions[0]!, label: 'again' }],
        },
      }),
    ],
    [
      'a non-slug stop condition id',
      eapWith({ stop: { ...VALID.stop, conditions: [{ id: 'Forecast Receded', label: 'x' }] } }),
    ],
    [
      'a blank stop condition label',
      eapWith({ stop: { ...VALID.stop, conditions: [{ id: 'forecast-receded', label: '' }] } }),
    ],
    [
      'a stop authorizer that cannot approve',
      eapWith({ stop: { ...VALID.stop, authorizerRole: 'RESPONDER' as 'EM' } }),
    ],
    ['a zero maximum duration', eapWith({ stop: { ...VALID.stop, maxDurationHours: 0 } })],
  ];

  for (const [what, eap] of bad) {
    it(`rejects ${what}`, () => {
      expect(() => makeEarlyActionProtocol(eap)).toThrow(InvariantViolation);
    });
  }

  it('accepts a ceiling with no per-kind caps at all', () => {
    expect(() =>
      makeEarlyActionProtocol(
        eapWith({ resourceCeiling: { maxResources: 3, basis: 'illustrative' } }),
      ),
    ).not.toThrow();
  });

  it('resolves a stage to its own trigger', () => {
    expect(stageTrigger(VALID, 'READINESS')).toBe(READINESS);
    expect(stageTrigger(VALID, 'ACTIVATION')).toBe(ACTIVATION);
  });
});

describe('the protocol state machine (ADR-034 §2)', () => {
  const idle = (): TriggerState => beginEpisode({ eapId: VALID.id, episodeId: 'ep-1', at: CLOCK });

  it('declares exactly four states and two stages', () => {
    expect([...EAP_STATES]).toEqual(['IDLE', 'READINESS', 'ACTIVATED', 'STOPPED']);
    expect([...EAP_STAGES]).toEqual(['READINESS', 'ACTIVATION']);
  });

  it('opens an episode at IDLE with nothing fired', () => {
    expect(idle()).toEqual({
      eapId: 'test-flood',
      episodeId: 'ep-1',
      state: 'IDLE',
      enteredAt: CLOCK,
      firedStages: [],
    });
  });

  it('rejects a malformed episode identity or instant', () => {
    expect(() => beginEpisode({ eapId: 'Bad Id', episodeId: 'ep-1', at: CLOCK })).toThrow(
      InvariantViolation,
    );
    expect(() => beginEpisode({ eapId: VALID.id, episodeId: 'EP 1', at: CLOCK })).toThrow(
      InvariantViolation,
    );
    expect(() => beginEpisode({ eapId: VALID.id, episodeId: 'ep-1', at: 'whenever' })).toThrow(
      InvariantViolation,
    );
  });

  const legal: readonly [EapState, EapState][] = [
    ['IDLE', 'READINESS'],
    ['IDLE', 'ACTIVATED'],
    ['READINESS', 'ACTIVATED'],
    ['READINESS', 'STOPPED'],
    ['READINESS', 'IDLE'],
    ['ACTIVATED', 'STOPPED'],
  ];

  it.each(legal)('accepts the legal transition %s→%s', (from, to) => {
    const state: TriggerState = { ...idle(), state: from };
    expect(transitionEap(state, to, CLOCK).state).toBe(to);
  });

  const illegal = EAP_STATES.flatMap((from) =>
    EAP_STATES.filter((to) => !EAP_TRANSITIONS[from].includes(to)).map((to) => [from, to] as const),
  );

  it.each(illegal)('rejects the illegal transition %s→%s', (from, to) => {
    const state: TriggerState = { ...idle(), state: from };
    expect(() => transitionEap(state, to, CLOCK)).toThrow(InvalidTransition);
  });

  it('STOPPED is terminal: it accepts NOTHING, not even another STOPPED', () => {
    expect(EAP_TRANSITIONS.STOPPED).toEqual([]);
    for (const to of EAP_STATES) {
      expect(() => transitionEap({ ...idle(), state: 'STOPPED' }, to, CLOCK)).toThrow(
        InvalidTransition,
      );
    }
  });

  it('refuses a transition stamped with an invalid instant', () => {
    expect(() => transitionEap(idle(), 'READINESS', 'soon')).toThrow(InvariantViolation);
  });

  it('stamps activatedAt only on entering ACTIVATED, and keeps it afterwards', () => {
    const activated = transitionEap(idle(), 'ACTIVATED', CLOCK);
    expect(activated.activatedAt).toBe(CLOCK);
    const later = '2026-07-06T02:00:00Z';
    expect(transitionEap(activated, 'STOPPED', later).activatedAt).toBe(CLOCK);
    expect(transitionEap(idle(), 'READINESS', CLOCK).activatedAt).toBeUndefined();
  });

  it('clears the fired stages on de-escalation to IDLE, so a later crossing can fire again', () => {
    const readiness = recordStageFired(transitionEap(idle(), 'READINESS', CLOCK), 'READINESS');
    expect(readiness.firedStages).toEqual(['READINESS']);
    expect(transitionEap(readiness, 'IDLE', CLOCK).firedStages).toEqual([]);
  });

  it('records a fired stage once (edge de-dup)', () => {
    const once = recordStageFired(idle(), 'READINESS');
    expect(recordStageFired(once, 'READINESS')).toBe(once);
    expect(recordStageFired(once, 'ACTIVATION').firedStages).toEqual(['READINESS', 'ACTIVATION']);
  });

  it('carries the newest forecast vintage forward and never regresses it', () => {
    const newer = recordForecastVintage(idle(), '2026-07-05T18:00:00Z');
    expect(newer.latestForecastIssuedAt).toBe('2026-07-05T18:00:00Z');
    expect(recordForecastVintage(newer, '2026-07-05T06:00:00Z')).toBe(newer);
    expect(recordForecastVintage(newer, '2026-07-05T18:00:00Z')).toBe(newer);
    expect(recordForecastVintage(newer, '2026-07-06T00:00:00Z').latestForecastIssuedAt).toBe(
      '2026-07-06T00:00:00Z',
    );
  });
});

describe('the STOP mechanism (required, and it has teeth)', () => {
  const activated = (): TriggerState =>
    transitionEap(
      beginEpisode({ eapId: VALID.id, episodeId: 'ep-1', at: CLOCK }),
      'ACTIVATED',
      CLOCK,
    );

  it('stops on a DECLARED condition, authorized by the declared role, recording both', () => {
    const stopped = stopEpisode(VALID, activated(), {
      conditionId: 'forecast-receded',
      actorRole: 'EM',
      at: CLOCK,
    });
    expect(stopped.state).toBe('STOPPED');
    expect(stopped.stopConditionId).toBe('forecast-receded');
    expect(stopped.stoppedByRole).toBe('EM');
  });

  it('refuses an UNDECLARED stop condition — the reasons are pre-agreed data, not free text', () => {
    expect(() =>
      stopEpisode(VALID, activated(), {
        conditionId: 'because-i-said-so',
        actorRole: 'EM',
        at: CLOCK,
      }),
    ).toThrow(InvariantViolation);
  });

  it.each(['PUBLIC', 'RESPONDER', 'VERIFIER'] as const)(
    'refuses a stop by %s when the EAP requires EM',
    (role) => {
      expect(() =>
        stopEpisode(VALID, activated(), {
          conditionId: 'forecast-receded',
          actorRole: role,
          at: CLOCK,
        }),
      ).toThrow(Unauthorized);
    },
  );

  it('leaves the episode untouched when a stop is refused', () => {
    const before = activated();
    expect(() =>
      stopEpisode(VALID, before, { conditionId: 'nope', actorRole: 'EM', at: CLOCK }),
    ).toThrow();
    expect(before.state).toBe('ACTIVATED');
  });

  it('enforces the maximum duration from the injected clock alone', () => {
    const state = activated();
    expect(isDurationExpired(VALID, state, NOW)).toBe(false);
    expect(isDurationExpired(VALID, state, NOW + 167 * 3_600_000)).toBe(false);
    expect(isDurationExpired(VALID, state, NOW + 168 * 3_600_000)).toBe(true);
  });

  it('never expires a protocol that is not ACTIVATED, or one with no activation instant', () => {
    const idle = beginEpisode({ eapId: VALID.id, episodeId: 'ep-1', at: CLOCK });
    expect(isDurationExpired(VALID, idle, NOW + 1_000 * 3_600_000)).toBe(false);
    expect(isDurationExpired(VALID, { ...idle, state: 'ACTIVATED' }, NOW + 1_000 * 3_600_000)).toBe(
      false,
    );
  });

  it('records a duration-enforced stop under the reserved id, with no human authorizer', () => {
    const expired = expireEpisode(activated(), CLOCK);
    expect(expired.state).toBe('STOPPED');
    expect(expired.stopConditionId).toBe(EAP_DURATION_STOP_ID);
    expect(expired.stoppedByRole).toBeUndefined();
    // The reserved id can never collide with a declared config condition (config ids are slugs from the file).
    expect(VALID.stop.conditions.map((c) => c.id)).not.toContain(EAP_DURATION_STOP_ID);
  });
});

describe('a STOPPED protocol cannot silently resume (the dangerous case)', () => {
  const stopped = (): TriggerState =>
    stopEpisode(
      VALID,
      transitionEap(
        beginEpisode({ eapId: VALID.id, episodeId: 'ep-1', at: CLOCK }),
        'ACTIVATED',
        CLOCK,
      ),
      { conditionId: 'forecast-receded', actorRole: 'EM', at: CLOCK },
    );

  it('cannot be transitioned back to ACTIVATED or READINESS', () => {
    expect(() => transitionEap(stopped(), 'ACTIVATED', CLOCK)).toThrow(InvalidTransition);
    expect(() => transitionEap(stopped(), 'READINESS', CLOCK)).toThrow(InvalidTransition);
    expect(() => transitionEap(stopped(), 'IDLE', CLOCK)).toThrow(InvalidTransition);
  });

  it('cannot be re-opened under the SAME episode id', () => {
    expect(() =>
      beginEpisode({ eapId: VALID.id, episodeId: 'ep-1', at: CLOCK, previous: stopped() }),
    ).toThrow(InvalidTransition);
  });

  it('requires an EXPLICIT new episode — a new activation — to run again', () => {
    const next = beginEpisode({
      eapId: VALID.id,
      episodeId: 'ep-2',
      at: CLOCK,
      previous: stopped(),
    });
    expect(next).toEqual({
      eapId: 'test-flood',
      episodeId: 'ep-2',
      state: 'IDLE',
      enteredAt: CLOCK,
      firedStages: [],
    });
  });

  it('refuses to open a new episode while the previous one is still open', () => {
    const open = transitionEap(
      beginEpisode({ eapId: VALID.id, episodeId: 'ep-1', at: CLOCK }),
      'ACTIVATED',
      CLOCK,
    );
    expect(() =>
      beginEpisode({ eapId: VALID.id, episodeId: 'ep-2', at: CLOCK, previous: open }),
    ).toThrow(InvalidTransition);
  });
});
