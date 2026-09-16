// BEACON — forecast-likelihood threshold table: TYPES + fail-fast parser (C1.2; ADR-033 §2.2, ADR-012).
//
// The thresholds themselves live in `config/likelihood-thresholds.json` and are validated by
// `schemas/likelihood-thresholds.schema.json` — this module holds NO threshold literal. That is the point:
// changing where LIKELY starts is a config edit, reviewable as data, never a number buried in a use-case
// (ADR-012 "config for everything"; the same config-as-data discipline as the policy loader, which
// validates config/policies.yml against schemas/policies.schema.json and refuses to run on a bad file).
//
// Why a hand-written parser instead of Ajv here: this module is imported by a PURE application use-case, so
// it may not read the filesystem (the schema lives on disk, the config is a static import). The JSON-Schema
// is enforced against the shipped file by `likelihood-config.test.ts` — the same split the region registry
// uses (config/regions.json ↔ schemas/regions.schema.json, checked in region-registry.schema.test.ts).
// The parser additionally enforces the two properties a JSON-Schema cannot express: bands ascend, and class
// rank ascends with them, so the mapping is monotonic by construction.
import type { LikelihoodClass } from '@/domain/prediction.js';
import { LIKELIHOOD_CLASSES, likelihoodClassRank } from '@/domain/prediction.js';
import thresholdsJson from '../../../config/likelihood-thresholds.json';

/**
 * The signal types BEACON can classify. Each is a value a SOURCE publishes — there is deliberately no
 * "BEACON_ESTIMATE" member, because inventing a probability is exactly what FUW-3 forbids.
 */
export const LIKELIHOOD_SIGNAL_TYPES = [
  'DERIVED_EXCEEDANCE_PROBABILITY',
  'ENSEMBLE_MEMBER_FRACTION',
  'CATEGORICAL_ADVISORY_TIER',
] as const;
export type LikelihoodSignalType = (typeof LIKELIHOOD_SIGNAL_TYPES)[number];

/** One band of a continuous table: `lowerBound` is INCLUSIVE. */
export interface LikelihoodBand {
  readonly lowerBound: number;
  readonly class: LikelihoodClass;
}

interface RuleProvenance {
  /** Where the value came from, for the evidence shown beside every class. */
  readonly sourceField: string;
  /** Who publishes the signal, and what BEACON does NOT claim about it. */
  readonly source: string;
  /** The method string displayed with every class this rule produces (FU-11). */
  readonly method: string;
}

/** A numeric source signal on the unit interval, mapped by ascending inclusive bands. */
export interface ContinuousLikelihoodRule extends RuleProvenance {
  readonly kind: 'CONTINUOUS';
  readonly unit: string;
  /** Values strictly below this get NO class at all (record still carried). Absent ⇒ every band applies. */
  readonly unclassifiedBelow?: number;
  readonly bands: readonly LikelihoodBand[];
}

/** An ordinal source tier (e.g. low/medium/high), mapped one-to-one. Keys are compared lower-cased. */
export interface OrdinalLikelihoodRule extends RuleProvenance {
  readonly kind: 'ORDINAL';
  readonly levels: Readonly<Record<string, LikelihoodClass>>;
}

export type LikelihoodRule = ContinuousLikelihoodRule | OrdinalLikelihoodRule;

export interface LikelihoodConfig {
  readonly version: number;
  readonly authority: string;
  readonly boundaryConvention: string;
  readonly signalTypes: Readonly<Partial<Record<LikelihoodSignalType, LikelihoodRule>>>;
}

/** Config-validation failure. Fail fast and loudly: a wrong band silently shifts every class shown. */
function requireConfig(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid config/likelihood-thresholds.json: ${message}`);
}

// Permissive views of the raw file — mirrors the RawRegion approach in src/config/regions.ts.
interface RawBand {
  readonly lowerBound?: unknown;
  readonly class?: unknown;
}
interface RawRule {
  readonly kind?: unknown;
  readonly sourceField?: unknown;
  readonly unit?: unknown;
  readonly source?: unknown;
  readonly method?: unknown;
  readonly unclassifiedBelow?: unknown;
  readonly bands?: readonly RawBand[];
  readonly levels?: Readonly<Record<string, unknown>>;
}
interface RawConfig {
  readonly version?: unknown;
  readonly authority?: unknown;
  readonly boundaryConvention?: unknown;
  readonly signalTypes?: Readonly<Record<string, RawRule>>;
}

function text(v: unknown, what: string): string {
  requireConfig(typeof v === 'string' && v.trim().length > 0, `${what} must be a non-empty string`);
  return v as string;
}

function fraction(v: unknown, what: string): number {
  requireConfig(
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
    `${what} must be a number in [0,1], got ${String(v)}`,
  );
  return v as number;
}

function likelihoodClass(v: unknown, what: string): LikelihoodClass {
  requireConfig(
    typeof v === 'string' && (LIKELIHOOD_CLASSES as readonly string[]).includes(v),
    `${what} must be one of ${LIKELIHOOD_CLASSES.join('|')}, got ${String(v)}`,
  );
  return v as LikelihoodClass;
}

function provenance(raw: RawRule, at: string): RuleProvenance {
  return {
    sourceField: text(raw.sourceField, `${at}.sourceField`),
    source: text(raw.source, `${at}.source`),
    method: text(raw.method, `${at}.method`),
  };
}

/**
 * Bands, ascending. Both the bound AND the class rank must strictly increase: that is what makes the lookup
 * monotonic (a larger source value can never map to a less likely class) — a property no JSON-Schema can
 * state and the one an accidental config edit is most likely to break.
 */
function parseBands(raw: readonly RawBand[] | undefined, at: string): readonly LikelihoodBand[] {
  requireConfig(Array.isArray(raw) && raw.length > 0, `${at}.bands must be a non-empty array`);
  const bands = (raw as readonly RawBand[]).map((b, i) => ({
    lowerBound: fraction(b.lowerBound, `${at}.bands[${i}].lowerBound`),
    class: likelihoodClass(b.class, `${at}.bands[${i}].class`),
  }));
  bands.forEach((b, i) => {
    const prev = bands[i - 1];
    requireConfig(
      prev === undefined ||
        (b.lowerBound > prev.lowerBound &&
          likelihoodClassRank(b.class) > likelihoodClassRank(prev.class)),
      `${at}.bands must ascend in both lowerBound and class rank (offending index ${i})`,
    );
  });
  return bands;
}

function parseContinuous(raw: RawRule, at: string): ContinuousLikelihoodRule {
  const bands = parseBands(raw.bands, at);
  const floorBand = bands[0] as LikelihoodBand;
  const unclassifiedBelow =
    raw.unclassifiedBelow === undefined
      ? undefined
      : fraction(raw.unclassifiedBelow, `${at}.unclassifiedBelow`);
  requireConfig(
    unclassifiedBelow === undefined || unclassifiedBelow <= floorBand.lowerBound,
    `${at}.unclassifiedBelow (${String(unclassifiedBelow)}) must not exceed the lowest band bound (${floorBand.lowerBound})`,
  );
  return {
    kind: 'CONTINUOUS',
    ...provenance(raw, at),
    unit: text(raw.unit, `${at}.unit`),
    ...(unclassifiedBelow === undefined ? {} : { unclassifiedBelow }),
    bands,
  };
}

function parseOrdinal(raw: RawRule, at: string): OrdinalLikelihoodRule {
  const raws = raw.levels;
  requireConfig(
    typeof raws === 'object' && raws !== null && Object.keys(raws).length > 0,
    `${at}.levels must be a non-empty object`,
  );
  const levels: Record<string, LikelihoodClass> = {};
  for (const [level, value] of Object.entries(raws as Record<string, unknown>)) {
    requireConfig(level === level.toLowerCase(), `${at}.levels key '${level}' must be lower-case`);
    levels[level] = likelihoodClass(value, `${at}.levels.${level}`);
  }
  return { kind: 'ORDINAL', ...provenance(raw, at), levels };
}

function parseRule(raw: RawRule, at: string): LikelihoodRule {
  requireConfig(
    raw.kind === 'CONTINUOUS' || raw.kind === 'ORDINAL',
    `${at}.kind must be CONTINUOUS or ORDINAL, got ${String(raw.kind)}`,
  );
  return raw.kind === 'CONTINUOUS' ? parseContinuous(raw, at) : parseOrdinal(raw, at);
}

function parseSignalTypes(
  raw: Readonly<Record<string, RawRule>> | undefined,
): LikelihoodConfig['signalTypes'] {
  requireConfig(typeof raw === 'object' && raw !== null, 'signalTypes must be an object');
  const entries = Object.entries(raw as Record<string, RawRule>);
  requireConfig(entries.length > 0, 'signalTypes must declare at least one signal type');
  const out: Partial<Record<LikelihoodSignalType, LikelihoodRule>> = {};
  for (const [name, rule] of entries) {
    requireConfig(
      (LIKELIHOOD_SIGNAL_TYPES as readonly string[]).includes(name),
      `unknown signal type '${name}' (known: ${LIKELIHOOD_SIGNAL_TYPES.join('|')})`,
    );
    out[name as LikelihoodSignalType] = parseRule(rule, `signalTypes.${name}`);
  }
  return out;
}

/**
 * Parse + validate a likelihood threshold table. Throws on any violation — a half-valid threshold table is
 * worse than none, because every class it emits looks equally authoritative.
 */
export function parseLikelihoodConfig(raw: unknown): LikelihoodConfig {
  requireConfig(typeof raw === 'object' && raw !== null, 'the file must contain a JSON object');
  const cfg = raw as RawConfig;
  requireConfig(cfg.version === 1, `version must be 1, got ${String(cfg.version)}`);
  return {
    version: 1,
    authority: text(cfg.authority, 'authority'),
    boundaryConvention: text(cfg.boundaryConvention, 'boundaryConvention'),
    signalTypes: parseSignalTypes(cfg.signalTypes),
  };
}

/**
 * The SHIPPED threshold table, parsed at import time (fail-fast: a bad config breaks the build's first test,
 * not a responder's screen). Injectable per region exactly like PriorityWeights — every classifier entry
 * point takes a `LikelihoodConfig` and only DEFAULTS to this one.
 */
export const DEFAULT_LIKELIHOOD_CONFIG: LikelihoodConfig = parseLikelihoodConfig(thresholdsJson);
