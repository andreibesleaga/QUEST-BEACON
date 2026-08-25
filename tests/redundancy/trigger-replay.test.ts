// BEACON — REPLAY DETERMINISM for the anticipatory-action engine (D2; ADR-034 §3/§9 V3, master plan §5.7c,
// EARS acceptance test 3). This is the "redundancy-pattern" suite, beside `redundancy-acceptance.test.ts`.
//
// THE CLAIM UNDER TEST: replaying the SAME event sequence produces the SAME protocol state and the SAME
// governance ledger — byte-identically. That is what makes the engine inspectable rather than a black box:
// a judge, an auditor or a future maintainer can re-run the episode from files that ship with the repo and
// get exactly the artifacts that were recorded the first time.
//
// It holds because every part of the path refuses to be non-deterministic:
//   · the evaluator is pure and takes an INJECTED clock (`nowMs`), never `Date.now()`;
//   · the forecast is a RECORDED FILE (`fixtures/anticipatory/*.json`) — BEACON queries no ensemble product
//     at runtime and has no live ensemble source (finding F-34);
//   · the protocol is a config file pinned by commit (`config/eap/*.json`), not a mutable database row;
//   · the digest is the chain's OWN canonicalizer (`evidenceDigest`, `src/domain/audit-event.ts`), which
//     sorts keys and omits `undefined`, so `JSON.stringify` insertion order cannot leak in.
//
// Air-gapped by construction: two JSON files, no network, no clock read, no database.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson, evidenceDigest } from '@/domain/audit-event.js';
import type { TriggerState } from '@/domain/early-action-protocol.js';
import { beginEpisode, stopEpisode } from '@/domain/early-action-protocol.js';
import type { LedgerAppendInput } from '@/ports/governance.js';
import type { TriggerEvaluation } from '@/domain/trigger-evaluation.js';
import { eapLedgerTarget } from '@/domain/trigger-evaluation.js';
import { isOk } from '@/domain/shared/result.js';
import { parseEnsembleMemberFile, runAnticipatoryCycle, shippedEap } from '@/application/anticipatory/index.js';
import type { EnsembleMemberFile, TriggerForecast } from '@/application/anticipatory/index.js';

const EAP = shippedEap('ro-danube-flood')!;

const load = (name: string): EnsembleMemberFile =>
  parseEnsembleMemberFile(
    JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/anticipatory/${name}.json`, import.meta.url)), 'utf8')),
  );

const RUN_1 = load('ro-danube-discharge-ensemble-run-1'); // issued 00:00Z, 110 h horizon
const RUN_2 = load('ro-danube-discharge-ensemble-run-2'); // issued 18:00Z,  40 h horizon
const members = (file: EnsembleMemberFile): TriggerForecast => ({ kind: 'ENSEMBLE_MEMBERS', file });

/** The episode, as an ordered list of (instant, forecast) events. Nothing here reads a clock. */
const EVENTS: readonly { readonly at: string; readonly forecast?: TriggerForecast }[] = [
  { at: '2026-07-05T08:00:00Z', forecast: members(RUN_1) }, // readiness crossing
  { at: '2026-07-05T10:00:00Z', forecast: members(RUN_1) }, // same run again — no new edge
  { at: '2026-07-05T12:00:00Z' }, //                          no forecast at all this cycle
  { at: '2026-07-05T20:00:00Z', forecast: members(RUN_2) }, // converged run — activation
  { at: '2026-07-05T22:00:00Z', forecast: members(RUN_1) }, // superseded run arriving out of order
];

/** The human stop that closes the episode — a declared condition, an authorized role, an injected instant. */
const STOP = { conditionId: 'forecast-receded', actorRole: 'EM', at: '2026-07-05T22:00:00Z' } as const;

interface Replay {
  readonly states: readonly TriggerState[];
  readonly evaluations: readonly TriggerEvaluation[];
  readonly ledger: readonly LedgerAppendInput[];
  readonly final: TriggerState;
}

/** Replay the whole episode from the shipped files. Pure: same inputs in, same artifacts out. */
function replayEpisode(): Replay {
  let state = beginEpisode({ eapId: EAP.id, episodeId: 'ep-1', at: '2026-07-05T06:00:00Z' });
  const states: TriggerState[] = [state];
  const evaluations: TriggerEvaluation[] = [];
  const ledger: LedgerAppendInput[] = [];
  for (const event of EVENTS) {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: state,
      ...(event.forecast === undefined ? {} : { forecast: event.forecast }),
      nowMs: Date.parse(event.at),
    });
    if (!isOk(run)) throw new Error(`replay cycle failed at ${event.at}`);
    state = run.value.state;
    states.push(state);
    evaluations.push(run.value.evaluation);
    ledger.push(...run.value.ledger);
  }
  const final = stopEpisode(EAP, state, STOP);
  ledger.push({
    action: 'EAP_STOP',
    target: eapLedgerTarget(EAP.id, final.episodeId),
    at: STOP.at,
    actorRole: STOP.actorRole,
    evidence: { conditionId: final.stopConditionId, durationEnforced: false },
  });
  return { states, evaluations, ledger, final };
}

describe('replay determinism — the same event sequence produces the same state and ledger', () => {
  const first = replayEpisode();
  const second = replayEpisode();

  it('produces a DEEP-EQUAL state trajectory on both runs', () => {
    expect(second.states).toEqual(first.states);
    expect(second.final).toEqual(first.final);
  });

  it('produces a DEEP-EQUAL evaluation sequence, evidence objects included', () => {
    expect(second.evaluations).toEqual(first.evaluations);
    for (const evaluation of first.evaluations) {
      // Every evaluation that saw data carries the arithmetic that produced it — never a bare verdict.
      if (evaluation.evidence === undefined) continue;
      expect(evaluation.gate).toBeDefined();
      expect(evaluation.evidence.forecastVersion.length).toBeGreaterThan(0);
    }
  });

  it('produces a DEEP-EQUAL governance ledger on both runs', () => {
    expect(second.ledger).toEqual(first.ledger);
  });

  it('is BYTE-IDENTICAL under the chain’s own canonicalizer (key order cannot leak in)', () => {
    const canonical = (r: Replay): string => canonicalJson({ states: r.states, evaluations: r.evaluations, ledger: r.ledger });
    expect(canonical(second)).toBe(canonical(first));
    expect(canonical(first).length).toBeGreaterThan(1000);
  });

  it('matches a COMMITTED golden digest — a silent change to the arithmetic, the config or the fixture fails here', () => {
    const digest = evidenceDigest({ states: first.states, evaluations: first.evaluations, ledger: first.ledger });
    // Golden value. If this line has to change, something the engine decides changed — say what, and why.
    expect(digest).toBe('a8a2602b');
    expect(evidenceDigest({ states: second.states, evaluations: second.evaluations, ledger: second.ledger })).toBe(digest);
  });

  const cycleWith = (file: EnsembleMemberFile): TriggerEvaluation => {
    const run = runAnticipatoryCycle({
      eap: EAP,
      priorState: first.states[0]!,
      forecast: members(file),
      nowMs: Date.parse(EVENTS[0]!.at),
    });
    if (!isOk(run)) throw new Error('cycle must succeed');
    return run.value.evaluation;
  };

  it('gives a DIFFERENT digest when a member CROSSES the threshold (the count is what is committed to)', () => {
    // RUN_1 member[0] is 5900, below the 6500 readiness threshold: lifting it over changes 37/51 to 38/51.
    const crossed = { ...RUN_1, members: [9_999, ...RUN_1.members.slice(1)] };
    expect(evidenceDigest(cycleWith(crossed))).not.toBe(evidenceDigest(first.evaluations[0]!));
  });

  it('gives the SAME digest when a member moves WITHIN its side of the threshold — and that is correct', () => {
    // The evidence commits to the COUNT over the threshold, not to the member list. A member that was already
    // over the threshold moving further over changes no number the decision rests on, so the digest must not
    // move either; claiming otherwise would mean the digest was committing to something it does not record.
    const shuffledAbove = { ...RUN_1, members: [...RUN_1.members.slice(0, -1), 99_999] };
    expect(evidenceDigest(cycleWith(shuffledAbove))).toBe(evidenceDigest(first.evaluations[0]!));
  });
});

describe('the replayed episode tells the expected story (and only from files that ship with the repo)', () => {
  const replay = replayEpisode();

  it('walks IDLE → READINESS → ACTIVATED → STOPPED', () => {
    expect(replay.states.map((s) => s.state)).toEqual(['IDLE', 'READINESS', 'READINESS', 'READINESS', 'ACTIVATED', 'ACTIVATED']);
    expect(replay.final.state).toBe('STOPPED');
  });

  it('fires each stage exactly once, on its own edge', () => {
    expect(replay.evaluations.map((e) => e.fired)).toEqual(['READINESS', null, null, 'ACTIVATION', null]);
    expect(replay.final.firedStages).toEqual(['READINESS', 'ACTIVATION']);
  });

  it('explains every non-firing cycle by name', () => {
    expect(replay.evaluations.map((e) => e.reason)).toEqual([
      'FIRED',
      'LEAD_TIME_OUTSIDE_STAGE_HORIZON',
      'NO_EVIDENCE',
      'FIRED',
      'SUPERSEDED_RUN',
    ]);
  });

  it('refuses the out-of-order run at the end without disturbing the activation', () => {
    expect(replay.evaluations.at(-1)?.to).toBe('ACTIVATED');
    expect(replay.states.at(-1)?.latestForecastIssuedAt).toBe(RUN_2.issuedAt);
  });

  it('records the human stop with its declared condition and the role that acted', () => {
    expect(replay.final.stopConditionId).toBe('forecast-receded');
    expect(replay.final.stoppedByRole).toBe('EM');
    expect(replay.ledger.at(-1)).toMatchObject({ action: 'EAP_STOP', actorRole: 'EM', target: 'eap:ro-danube-flood#ep-1' });
  });

  it('cannot be resumed after the stop: the same episode id is refused and a new one is required', () => {
    expect(() => beginEpisode({ eapId: EAP.id, episodeId: 'ep-1', at: '2026-07-05T23:00:00Z', previous: replay.final })).toThrow();
    const next = beginEpisode({ eapId: EAP.id, episodeId: 'ep-2', at: '2026-07-05T23:00:00Z', previous: replay.final });
    expect(next.state).toBe('IDLE');
    expect(next.firedStages).toEqual([]);
  });

  it('never claims a live source anywhere in the replayed ledger (F-34)', () => {
    const evidence = JSON.stringify(replay.ledger);
    expect(evidence).toMatch(/"sourceTier":"FIXTURE"/);
    expect(evidence).not.toMatch(/"sourceTier":"LIVE"/);
    expect(evidence).toMatch(/no wired live ensemble source/);
  });
});
