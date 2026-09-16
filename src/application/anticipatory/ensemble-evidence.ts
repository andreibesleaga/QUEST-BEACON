// BEACON — ensemble member COUNTING + the evidence objects a trigger decision rests on (D2; ADR-034 §3,
// FR-AA-2 / FU-14 / FUW-4). Pure: no I/O, no clock, no network.
//
// ══ THE HONESTY CONSTRAINT (finding F-34, verified and BINDING) ═════════════════════════════════════════
// The wired GloFAS adapter consumes the REPORTING POINTS product, which publishes a DERIVED exceedance
// probability and a tendency — NOT per-member discharge. There is no per-member ensemble series anywhere in
// this repository and nothing in BEACON queries an ensemble product at runtime. Therefore:
//
//   1. The member-counting evaluator is fed from a CACHED / RECORDED FILE handed to it by the caller
//      (`fixtures/anticipatory/*.json` ships one), and `sourceTier` can only ever be `CACHED` or `FIXTURE` —
//      `TriggerSourceTier` has no `LIVE` member, so a live claim is unrepresentable, not merely discouraged.
//   2. A member fraction is `membersOverThreshold / memberTotal`: the SHARE OF FORECAST MEMBERS OVER A
//      THRESHOLD, shown as k of N beside a likelihood class as evidence. It is NOT a percentage chance of
//      occurrence and is never presented as one — `ENSEMBLE_MEMBER_COUNT_LABEL` says so on every object, and
//      the label comes from the DOMAIN CONSTANT, never from the file, so a fixture cannot relabel itself.
//   3. Nothing here converts between the two evidence kinds. Deriving a member count from a published
//      probability (`round(p x 51)`) was rejected outright by ADR-034: it would be an invented figure
//      (Art. XII) and would violate FUW-3.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
import type {
  EnsembleMemberCountEvidence,
  SourceDerivedProbabilityEvidence,
  TriggerSourceTier,
} from '@/domain/trigger-evaluation.js';
import {
  ENSEMBLE_MEMBER_COUNT_LABEL,
  SOURCE_DERIVED_PROBABILITY_LABEL,
  TRIGGER_SOURCE_TIERS,
} from '@/domain/trigger-evaluation.js';
import type { EapComparator } from '@/domain/early-action-protocol.js';

/**
 * A cached/recorded ensemble forecast file. `memberTotal` is deliberately NOT a declared field: it is
 * `members.length`, so the total can never disagree with the list it counts.
 */
export interface EnsembleMemberFile {
  readonly id: string;
  /** The source product's own run identifier, verbatim. */
  readonly forecastVersion: string;
  readonly parameter: string;
  readonly unit: string;
  /** The forecast's own issue instant (ISO-8601) — the vintage a decision made from it rests on. */
  readonly issuedAt: string;
  /** Remaining lead time in hours as the file states it. BEACON does not model hazard travel time. */
  readonly leadTimeHours: number;
  readonly sourceTier: TriggerSourceTier;
  /** The file's own statement of what it is and where it came from. Carried verbatim into the evidence. */
  readonly sourceStatement: string;
  /** One value per forecast member, in the file's order, in `unit`. Never rescaled on the way in. */
  readonly members: readonly number[];
}

/** A reading of a probability the SOURCE published (e.g. a GloFAS reporting point, once ADR-033 keeps it). */
export interface SourceProbabilityReading {
  readonly forecastVersion: string;
  readonly parameter: string;
  readonly unit: string;
  readonly issuedAt: string;
  readonly leadTimeHours: number;
  readonly sourceTier: TriggerSourceTier;
  readonly sourceStatement: string;
  /** The source's own value on [0,1], verbatim — never rescaled, never recalibrated. */
  readonly probability: number;
}

/** Config-validation failure for a forecast file. Fail fast: a mis-parsed member list mis-counts a trigger. */
function requireFile(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid ensemble member file: ${message}`);
}

/**
 * Parse + validate a cached ensemble member file. Refuses (rather than repairs) anything it cannot ground: a
 * non-finite member, an unparseable vintage, a negative lead time, an unknown source tier. The
 * `sourceStatement` must be a real statement (>= 40 chars) because an unlabelled cached file is exactly the
 * artifact that later gets mistaken for a live feed.
 */
export function parseEnsembleMemberFile(raw: unknown): EnsembleMemberFile {
  requireFile(typeof raw === 'object' && raw !== null, 'the file must contain a JSON object');
  const cfg = raw as Readonly<Record<string, unknown>>;
  requireFile(cfg['version'] === 1, `version must be 1, got ${String(cfg['version'])}`);
  const members = cfg['members'];
  requireFile(Array.isArray(members) && members.length > 0, 'members must be a non-empty array');
  requireFile(
    (members as readonly unknown[]).every((m) => typeof m === 'number' && Number.isFinite(m)),
    'every member must be a finite number',
  );
  const tier = cfg['sourceTier'];
  requireFile(
    typeof tier === 'string' && (TRIGGER_SOURCE_TIERS as readonly string[]).includes(tier),
    `sourceTier must be one of ${TRIGGER_SOURCE_TIERS.join('|')} (there is no LIVE tier — finding F-34), got ${String(tier)}`,
  );
  const statement = cfg['sourceStatement'];
  requireFile(
    typeof statement === 'string' && statement.trim().length >= 40,
    'sourceStatement must state what the file is and where it came from',
  );
  const issuedAt = cfg['issuedAt'];
  requireFile(
    typeof issuedAt === 'string' && !Number.isNaN(Date.parse(issuedAt)),
    'issuedAt must be a valid ISO-8601 instant',
  );
  const leadTimeHours = cfg['leadTimeHours'];
  requireFile(
    typeof leadTimeHours === 'number' && Number.isFinite(leadTimeHours) && leadTimeHours >= 0,
    'leadTimeHours must be a non-negative finite number',
  );
  return {
    id: requireText(cfg['id'], 'id'),
    forecastVersion: requireText(cfg['forecastVersion'], 'forecastVersion'),
    parameter: requireText(cfg['parameter'], 'parameter'),
    unit: requireText(cfg['unit'], 'unit'),
    issuedAt,
    leadTimeHours,
    sourceTier: tier as TriggerSourceTier,
    sourceStatement: statement,
    members: [...(members as readonly number[])],
  };
}

function requireText(value: unknown, what: string): string {
  requireFile(
    typeof value === 'string' && value.trim().length > 0,
    `${what} must be a non-empty string`,
  );
  return value as string;
}

/**
 * Count members over the threshold. This is the whole "model": integer arithmetic on a list the file
 * supplied. `GTE` counts members at or above the threshold, `LTE` members at or below — the comparator is the
 * EAP's, so a low-flow protocol counts the correct tail without a second code path.
 */
export function countMembersOverThreshold(
  members: readonly number[],
  threshold: number,
  comparator: EapComparator,
): number {
  return members.filter((m) => (comparator === 'GTE' ? m >= threshold : m <= threshold)).length;
}

/**
 * Build member-count evidence for ONE stage's threshold. Two stages of the same EAP therefore produce two
 * different counts from the same file, which is correct: the count is only meaningful next to the threshold
 * it was taken against, so threshold and comparator travel INSIDE the evidence.
 */
export function ensembleEvidence(
  file: EnsembleMemberFile,
  threshold: number,
  comparator: EapComparator,
): EnsembleMemberCountEvidence {
  const memberTotal = file.members.length;
  const membersOverThreshold = countMembersOverThreshold(file.members, threshold, comparator);
  return {
    kind: 'ENSEMBLE_MEMBER_COUNT',
    membersOverThreshold,
    memberTotal,
    memberFraction: membersOverThreshold / memberTotal,
    threshold,
    comparator,
    parameter: file.parameter,
    unit: file.unit,
    forecastVersion: file.forecastVersion,
    issuedAt: file.issuedAt,
    leadTimeHours: file.leadTimeHours,
    sourceTier: file.sourceTier,
    sourceStatement: file.sourceStatement,
    // From the domain constant, NEVER from the file: a fixture cannot relabel what it is.
    label: ENSEMBLE_MEMBER_COUNT_LABEL,
  };
}

/**
 * Build source-derived-probability evidence. The value is carried verbatim and gains no `memberTotal`, ever
 * (ADR-034 §3) — a published probability says nothing about how many members produced it.
 */
export function sourceProbabilityEvidence(
  reading: SourceProbabilityReading,
): SourceDerivedProbabilityEvidence {
  return {
    kind: 'SOURCE_DERIVED_PROBABILITY',
    probability: reading.probability,
    parameter: reading.parameter,
    unit: reading.unit,
    forecastVersion: reading.forecastVersion,
    issuedAt: reading.issuedAt,
    leadTimeHours: reading.leadTimeHours,
    sourceTier: reading.sourceTier,
    sourceStatement: reading.sourceStatement,
    label: SOURCE_DERIVED_PROBABILITY_LABEL,
  };
}
