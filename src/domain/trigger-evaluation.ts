// BEACON — TRIGGER_EVALUATION types (D2; ADR-034 §3, FR-AA-2, SPEC-FINAL-VERSION-DELTA §4). Pure TS — no
// framework/HTTP/DB imports (F9), no clock read.
//
// This file is deliberately types-and-constants only: it fixes the SHAPE of the evidence a trigger decision
// rests on, so no surface can show a decision without the arithmetic that produced it. The arithmetic itself
// lives in `src/application/anticipatory/`.
//
// NOT DEFINED HERE, ON PURPOSE: the ledger. `LedgerEntry`/`LedgerAction` are lane D4's
// (`src/domain/governance.js`) and the append surface is `GovernanceLedgerPort`
// (`src/ports/governance.js`) — one chain, one vocabulary. A second `LedgerEntry` in this file would be a
// governance defect (two things to verify, two ways to disagree). The anticipatory engine produces
// `LedgerAppendInput` values and never holds the chain.
//
// THE HONESTY CONSTRAINT IS IN THE TYPES (finding F-34, binding):
//   · `TriggerSourceTier` has NO `'LIVE'` member. BEACON has no wired live ensemble source — GloFAS
//     reporting points publish a DERIVED probability, not members — so a live claim is not merely
//     discouraged, it is unrepresentable.
//   · `EnsembleMemberCountEvidence` carries `membersOverThreshold` / `memberTotal` / `memberFraction` and NO
//     field named `probability`, `chance` or `percent`. A member share is model spread, shown as k of N
//     beside a class — never a percentage chance of occurrence.
//   · `SourceDerivedProbabilityEvidence` carries `probability` and NO `memberTotal`. The two kinds are never
//     converted into one another (ADR-034 §3; deriving `round(p x 51)` was rejected outright).
import type { LikelihoodClass } from './prediction.js';
import type { ApproverRole } from './governance.js';
import type { EapStage, EapState } from './early-action-protocol.js';

/**
 * Where a forecast reading came from. `CACHED` = a last-known-good copy of a product BEACON does consume;
 * `FIXTURE` = a recorded/hand-authored file that ships with the repo for demonstration and replay. There is
 * no `LIVE` member: nothing in BEACON queries ensemble members at runtime (F-34).
 */
export const TRIGGER_SOURCE_TIERS = ['CACHED', 'FIXTURE'] as const;
export type TriggerSourceTier = (typeof TRIGGER_SOURCE_TIERS)[number];

export const TRIGGER_EVIDENCE_KINDS = ['ENSEMBLE_MEMBER_COUNT', 'SOURCE_DERIVED_PROBABILITY'] as const;
export type TriggerEvidenceKind = (typeof TRIGGER_EVIDENCE_KINDS)[number];

/**
 * The label attached to EVERY member-count evidence object and displayed with it. It says the three things
 * that keep the number honest: what it is (a share of members over a threshold), what it is not (a
 * probability of occurrence), and that BEACON does not hold a live ensemble feed.
 */
export const ENSEMBLE_MEMBER_COUNT_LABEL =
  'share of forecast members over the threshold (k of N) read from a cached/recorded forecast file — model ' +
  'spread, NOT a calibrated probability and NOT a chance of occurrence; BEACON has no wired live ensemble ' +
  'source and queries no ensemble product at runtime';

/** The label attached to every source-derived-probability evidence object. */
export const SOURCE_DERIVED_PROBABILITY_LABEL =
  'exceedance probability published by the source itself, carried verbatim — BEACON computes, calibrates and ' +
  'rescales nothing, and never converts it into a member count';

interface TriggerEvidenceBase {
  readonly parameter: string;
  readonly unit: string;
  /** The source product's own version/run identifier, verbatim. */
  readonly forecastVersion: string;
  /** The source's own issue instant (ISO-8601) — the vintage the decision rests on. */
  readonly issuedAt: string;
  /** Remaining lead time in hours, as the source stated it. BEACON does not model hazard travel time. */
  readonly leadTimeHours: number;
  readonly sourceTier: TriggerSourceTier;
  /** The file's own statement of what it is and where it came from, verbatim. */
  readonly sourceStatement: string;
  /** The fixed honesty label for this evidence kind. */
  readonly label: string;
}

/** Members counted over a threshold. NO probability field exists on this shape, by design. */
export interface EnsembleMemberCountEvidence extends TriggerEvidenceBase {
  readonly kind: 'ENSEMBLE_MEMBER_COUNT';
  readonly membersOverThreshold: number;
  readonly memberTotal: number;
  /** `membersOverThreshold / memberTotal`, carried so the panel and the ledger agree on the arithmetic. */
  readonly memberFraction: number;
  readonly threshold: number;
  readonly comparator: 'GTE' | 'LTE';
}

/** A probability the SOURCE published. NO memberTotal exists on this shape, by design. */
export interface SourceDerivedProbabilityEvidence extends TriggerEvidenceBase {
  readonly kind: 'SOURCE_DERIVED_PROBABILITY';
  readonly probability: number;
}

export type TriggerEvidence = EnsembleMemberCountEvidence | SourceDerivedProbabilityEvidence;

/** The likelihood class WITH the classifier's own evidence — never a bare class (FU-11). */
export interface TriggerLikelihood {
  readonly likelihoodClass: LikelihoodClass;
  readonly rawValue: number;
  readonly sourceField: string;
  readonly method: string;
  readonly threshold?: number;
}

/** Why a cycle did (or did not) fire. A closed set so a reason string is never invented at a call site. */
export const TRIGGER_OUTCOME_REASONS = [
  'FIRED',
  'EPISODE_STOPPED',
  'NO_EVIDENCE',
  'UNPARSEABLE_VINTAGE',
  'FUTURE_VINTAGE',
  'STALE_VINTAGE',
  'SUPERSEDED_RUN',
  'MAX_DURATION_ELAPSED',
  'STAGE_ALREADY_FIRED',
  'LEAD_TIME_OUTSIDE_STAGE_HORIZON',
  'MAGNITUDE_GATE_NOT_MET',
  'UNCLASSIFIED_SIGNAL',
] as const;
export type TriggerOutcomeReason = (typeof TRIGGER_OUTCOME_REASONS)[number];

/**
 * One evaluation cycle's complete output: the decision AND the arithmetic that produced it. ADR-034 §3 makes
 * this one artifact serve three consumers — the panel's chart input, the ledger's evidence, and the replay
 * fixture — so nothing is ever restated in a second shape and allowed to drift.
 */
export interface TriggerEvaluation {
  readonly eapId: string;
  readonly episodeId: string;
  readonly from: EapState;
  readonly to: EapState;
  /** The stage that fired this cycle, or null. An activation is NOT an emission (FUW-4). */
  readonly fired: EapStage | null;
  readonly reason: TriggerOutcomeReason;
  /** The injected evaluation instant (ISO-8601). This module and its callers never read a wall clock. */
  readonly evaluatedAt: string;
  readonly evidence?: TriggerEvidence;
  readonly likelihood?: TriggerLikelihood;
  /** The stage gate the evidence was measured against, echoed so the decision is self-explaining. */
  readonly gate?: TriggerGate;
  /** Pre-agreed action ids this cycle SUGGESTS. Suggestions only — nothing here is dispatched (Art. XIII). */
  readonly suggestedActionIds: readonly string[];
  /** Present when the STOP mechanism closed the episode this cycle. */
  readonly stop?: TriggerStopRecord;
}

/**
 * Which of the two magnitude gates was applied. An EAP stage declares both (so a protocol is evaluable from
 * whichever product is actually available), and the evidence KIND selects which one applies:
 * `MEMBER_FRACTION` for `ENSEMBLE_MEMBER_COUNT`, `LIKELIHOOD_CLASS` for `SOURCE_DERIVED_PROBABILITY`. The
 * gates are never combined and the evidence kinds are never converted, so a member share can never be read
 * as a probability nor a probability as a member count.
 */
export const TRIGGER_APPLIED_GATES = ['MEMBER_FRACTION', 'LIKELIHOOD_CLASS'] as const;
export type TriggerAppliedGate = (typeof TRIGGER_APPLIED_GATES)[number];

/** The stage gate an evaluation was measured against, echoed verbatim from the EAP. */
export interface TriggerGate {
  readonly stage: EapStage;
  readonly threshold: number;
  readonly comparator: 'GTE' | 'LTE';
  readonly minMembersFraction: number;
  readonly minLikelihoodClass: LikelihoodClass;
  readonly leadTimeHours: number;
  readonly appliedGate: TriggerAppliedGate;
}

export interface TriggerStopRecord {
  /** A declared `stop.conditions[].id`, or the reserved duration id. */
  readonly conditionId: string;
  readonly authorizerRole: ApproverRole;
  /** True when the machine-enforced maximum duration closed the episode (no human authorizer). */
  readonly durationEnforced: boolean;
}

/**
 * The canonical governance-ledger target for an episode (`LedgerEntry.target`,
 * `src/domain/governance.ts:130`). One spelling in one place, so a ledger query can never miss an entry
 * because two call sites formatted the target differently.
 */
export function eapLedgerTarget(eapId: string, episodeId: string): string {
  return `eap:${eapId}#${episodeId}`;
}
