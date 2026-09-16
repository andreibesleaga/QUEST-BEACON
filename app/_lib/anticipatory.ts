// BEACON — the COP's view model over the D2 ANTICIPATORY-ACTION ENGINE (D7; ADR-034, FR-AA-1…FR-AA-4).
//
// WHAT THIS FILE IS: a composition seam and nothing else. It selects a shipped protocol, hands the shipped
// recorded forecast files to the EXISTING engine (`runAnticipatoryCycle`), and returns what came back. It
// closes the F-81/F-152 gap for lane D2 — a fully tested engine that no running surface reached.
//
// WHAT THIS FILE IS NOT (Art. XII, and it is worth being explicit because a UI-side "helper" is exactly
// where an invented figure gets born): it computes NO number. There is no arithmetic in this module — no
// count, no share, no ranking, no lead time, no threshold comparison, no state decision. Every figure the
// panel renders is a field of `TriggerEvaluation` / `TriggerState` / `EapTrigger`, produced by
// `src/application/anticipatory/**` and `src/domain/**` and passed through untouched. The AI contributes
// nothing here: this path never calls an LLM and renders identically with AI off.
//
// DETERMINISM. Nothing here reads a wall clock. The engine takes an injected `nowMs`, and the instant
// injected is DERIVED from the recorded file's own `issuedAt` plus one declared constant
// (`REPLAY_LAG_HOURS`), so the same repository always produces the same evaluation — today, in the demo, and
// in a test with a fixed clock. That is also why this is honest to call a REPLAY rather than a monitor: it
// re-runs recorded forecast runs at declared instants; it does not watch anything.
//
// HONESTY (Art. XVI, F-34). The forecast files ship in `fixtures/anticipatory/` and declare
// `sourceTier: 'FIXTURE'`. `TriggerSourceTier` has no `LIVE` member, so this surface cannot claim live data
// even by mistake, and the panel renders the tier and the file's own `sourceStatement` verbatim.
//
// ART. XIII. Nothing reachable from here can act: the engine is a pure function that holds no port, and its
// outcome is type-asserted to contain no `EmittableAlert` (`ANTICIPATORY_CANNOT_EMIT`). This module adds no
// port, no fetch and no mutation, so the panel over it can only ever show a suggestion awaiting a human.
import {
  EAP_STAGES,
  beginEpisode,
  stageTrigger,
  type EapStage,
  type EapTrigger,
  type EarlyActionProtocol,
  type TriggerState,
} from '@/domain/early-action-protocol.js';
import type { ApprovalOutcome } from '@/domain/governance.js';
import type { TriggerEvaluation } from '@/domain/trigger-evaluation.js';
import type { LedgerAppendInput } from '@/ports/governance.js';
import { isErr } from '@/domain/shared/result.js';
import { SHIPPED_EAPS } from '@/application/anticipatory/eap-config.js';
import { parseEnsembleMemberFile } from '@/application/anticipatory/ensemble-evidence.js';
import { runAnticipatoryCycle } from '@/application/anticipatory/anticipatory-engine.js';
import roRun1 from '../../fixtures/anticipatory/ro-danube-discharge-ensemble-run-1.json';
import roRun2 from '../../fixtures/anticipatory/ro-danube-discharge-ensemble-run-2.json';

const MS_PER_HOUR = 3_600_000;

/**
 * How long AFTER a recorded run's own issue instant the replay evaluates it. One hour: comfortably inside
 * the 24 h vintage window `config/forecast-trigger.json` declares (a reading older than one source update
 * cycle must not fire as if it were current), and late enough that the reading is never in the future.
 *
 * Deriving the evaluation instant from the file's own vintage — rather than hardcoding a pair of instants —
 * is what keeps this replay stable when a forecast fixture is re-recorded, and is the same "derive, don't
 * restate" rule the rest of this codebase applies to contracts (F-24/F-140/F-141/F-190/F-192).
 */
export const REPLAY_LAG_HOURS = 1;

/** The episode id used for the shipped replay. Fixed, so a replay is reproducible and diffable. */
const REPLAY_EPISODE_ID = 'replay-episode-1';

/**
 * The recorded forecast runs replayed for each shipped protocol, OLDEST FIRST. A protocol with no entry
 * here has no recorded forecast and therefore no evaluation — reported as a labelled "not available", never
 * as an empty board (Art. XVI). Only `ro-danube-flood` ships recorded runs today; that is a data fact about
 * `fixtures/anticipatory/`, not a limitation of the engine, and the panel says so.
 */
const REPLAY_RUNS: Readonly<Record<string, readonly unknown[]>> = Object.freeze({
  'ro-danube-flood': [roRun1, roRun2],
});

/** Why no evaluation is shown. A closed set, so an unavailable panel always states a specific reason. */
export const ANTICIPATORY_UNAVAILABLE_REASONS = [
  'NO_PROTOCOL_FOR_REGION',
  'NO_RECORDED_FORECAST',
  'ENGINE_REFUSED',
] as const;
export type AnticipatoryUnavailableReason = (typeof ANTICIPATORY_UNAVAILABLE_REASONS)[number];

/**
 * One rung of the ladder as of one cycle. Every field is copied from the protocol's own `EapTrigger` (via
 * the domain's `stageTrigger`, so `'READINESS' → triggers.readiness` is resolved in exactly one place) and
 * `fired` is read off the engine's `TriggerState.firedStages` — this module never decides that a stage fired.
 */
export interface AnticipatoryStageRow {
  readonly stage: EapStage;
  /** From `TriggerState.firedStages` — the engine's record, not a re-evaluation of the gate. */
  readonly fired: boolean;
  readonly trigger: EapTrigger;
}

/** One evaluation cycle exactly as the engine returned it, plus the ladder view of its resulting state. */
export interface AnticipatoryCycleView {
  readonly evaluation: TriggerEvaluation;
  readonly state: TriggerState;
  readonly approval: ApprovalOutcome;
  readonly stages: readonly AnticipatoryStageRow[];
  /** The governance records this cycle WOULD append. Shown read-only; this surface writes nothing. */
  readonly ledger: readonly LedgerAppendInput[];
}

export type AnticipatoryView =
  | {
      readonly kind: 'UNAVAILABLE';
      readonly regionId: string;
      readonly reason: AnticipatoryUnavailableReason;
      /** The engine's own refusal message when `reason` is `ENGINE_REFUSED`. Never invented text. */
      readonly detail?: string;
    }
  | {
      readonly kind: 'EVALUATED';
      readonly regionId: string;
      readonly eap: EarlyActionProtocol;
      /** Oldest cycle first — the order the runs were recorded and replayed in. */
      readonly cycles: readonly AnticipatoryCycleView[];
      readonly replayLagHours: number;
    };

/** The shipped protocol whose scope names this region, or `undefined`. Never another region's protocol. */
export function eapForRegion(regionId: string): EarlyActionProtocol | undefined {
  return SHIPPED_EAPS.find((eap) => eap.scope.regionId === regionId);
}

function stageRows(eap: EarlyActionProtocol, state: TriggerState): readonly AnticipatoryStageRow[] {
  return EAP_STAGES.map((stage) => ({
    stage,
    fired: state.firedStages.includes(stage),
    trigger: stageTrigger(eap, stage),
  }));
}

/**
 * Replay the recorded runs for one protocol through the engine, threading the resulting state from cycle to
 * cycle exactly as a live loop would. Returns the engine's refusal message on the first error rather than
 * a partial picture, because a half-replayed episode would show a state no run ever produced.
 */
function replay(eap: EarlyActionProtocol, runs: readonly unknown[]): AnticipatoryView {
  const files = runs.map((raw) => parseEnsembleMemberFile(raw));
  const first = files[0];
  if (first === undefined)
    return { kind: 'UNAVAILABLE', regionId: eap.scope.regionId, reason: 'NO_RECORDED_FORECAST' };
  let state = beginEpisode({
    eapId: eap.id,
    episodeId: REPLAY_EPISODE_ID,
    at: new Date(Date.parse(first.issuedAt)).toISOString(),
  });
  const cycles: AnticipatoryCycleView[] = [];
  for (const file of files) {
    const outcome = runAnticipatoryCycle({
      eap,
      priorState: state,
      forecast: { kind: 'ENSEMBLE_MEMBERS', file },
      nowMs: Date.parse(file.issuedAt) + REPLAY_LAG_HOURS * MS_PER_HOUR,
    });
    if (isErr(outcome)) {
      return {
        kind: 'UNAVAILABLE',
        regionId: eap.scope.regionId,
        reason: 'ENGINE_REFUSED',
        detail: outcome.error.message,
      };
    }
    state = outcome.value.state;
    cycles.push({
      evaluation: outcome.value.evaluation,
      state: outcome.value.state,
      approval: outcome.value.approval,
      stages: stageRows(eap, outcome.value.state),
      ledger: outcome.value.ledger,
    });
  }
  return {
    kind: 'EVALUATED',
    regionId: eap.scope.regionId,
    eap,
    cycles,
    replayLagHours: REPLAY_LAG_HOURS,
  };
}

/**
 * Build the panel's view model for a region. Total: every input is a shipped file, every failure mode has a
 * named reason, and a thrown validation error degrades to `ENGINE_REFUSED` carrying the thrower's own
 * message instead of taking the COP down (Art. XVI — degrade, label, never dead-end).
 */
export function buildAnticipatoryView(regionId: string): AnticipatoryView {
  try {
    const eap = eapForRegion(regionId);
    if (eap === undefined)
      return { kind: 'UNAVAILABLE', regionId, reason: 'NO_PROTOCOL_FOR_REGION' };
    const runs = REPLAY_RUNS[eap.id];
    if (runs === undefined || runs.length === 0) {
      return { kind: 'UNAVAILABLE', regionId, reason: 'NO_RECORDED_FORECAST' };
    }
    return replay(eap, runs);
  } catch (error) {
    return {
      kind: 'UNAVAILABLE',
      regionId,
      reason: 'ENGINE_REFUSED',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
