// BEACON — predicted-impact PARAMETER SET: types + fail-fast parser (MW-D/D1; ADR-035 §1(d)/§3, ADR-012).
//
// The values live in `config/impact-params.json` and are validated against
// `schemas/impact-params.schema.json` — this module holds NO parameter literal. That is the point: an
// evacuation-clearance figure is only as honest as the visibility of its assumptions, so changing what BEACON
// assumes is a reviewable config edit, never a number buried in a use-case (Art. XV / ADR-012).
//
// The same split as the likelihood table (`src/application/forecast-likelihood/likelihood-config.ts`): a
// hand-written parser here because this module is imported by PURE use-cases and may not read the filesystem,
// with the JSON-Schema enforced against the shipped file by `impact-params.test.ts`. The parser additionally
// enforces what a JSON-Schema cannot: that every parameter reaching a figure carries a citation and an
// explicit `verified` verdict, so a figure can always answer "who says so?".
import paramsJson from '../../../config/impact-params.json';

/** One labelled assumption. `verified` is about the VALUE, never about the method it parameterises. */
export interface ImpactParameter {
  readonly value: number;
  readonly unit: string;
  readonly label: string;
  readonly citation: string;
  /** true only when the value itself is a published literature value. Every shipped value is `false`. */
  readonly verified: boolean;
}

/**
 * Every parameter the four quantifications consume. Closed on purpose: adding a figure means adding a
 * parameter id HERE and in the schema, which makes "where did that number come from?" answerable by grep.
 */
export const IMPACT_PARAMETER_IDS = [
  'minReportableCount',
  'shelterSeekingFraction',
  'participationFraction',
  'occupantsPerVehicle',
  'egressCapacityVehPerHour',
  'loadingTimeHours',
  'maxAssignmentRadiusKm',
  'minResidentsForSirenFlag',
  'minSiteLossFraction',
] as const;
export type ImpactParameterId = (typeof IMPACT_PARAMETER_IDS)[number];

export interface ImpactParams {
  readonly version: 1;
  /** Reported on every figure so a published number traces to the exact assumption set behind it. */
  readonly parameterSetId: string;
  readonly authority: string;
  readonly verifiedConvention: string;
  readonly parameters: Readonly<Record<ImpactParameterId, ImpactParameter>>;
}

/** Config-validation failure. Fail fast and loudly: a wrong parameter silently shifts a published figure. */
function requireConfig(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid config/impact-params.json: ${message}`);
}

interface RawParameter {
  readonly value?: unknown;
  readonly unit?: unknown;
  readonly label?: unknown;
  readonly citation?: unknown;
  readonly verified?: unknown;
}
interface RawParams {
  readonly version?: unknown;
  readonly parameterSetId?: unknown;
  readonly authority?: unknown;
  readonly verifiedConvention?: unknown;
  readonly parameters?: Readonly<Record<string, RawParameter>>;
}

function text(v: unknown, what: string): string {
  requireConfig(typeof v === 'string' && v.trim().length > 0, `${what} must be a non-empty string`);
  return v as string;
}

/** Numeric domain per id — the invariants a downstream figure would otherwise divide by zero on. */
const UNIT_INTERVAL_IDS = new Set<ImpactParameterId>([
  'shelterSeekingFraction',
  'participationFraction',
  'minSiteLossFraction',
]);
const STRICTLY_POSITIVE_IDS = new Set<ImpactParameterId>([
  'minReportableCount',
  'occupantsPerVehicle',
  'egressCapacityVehPerHour',
  'maxAssignmentRadiusKm',
  'minResidentsForSirenFlag',
]);

function checkDomain(id: ImpactParameterId, value: number): void {
  requireConfig(
    Number.isFinite(value),
    `parameters.${id}.value must be a finite number, got ${String(value)}`,
  );
  if (UNIT_INTERVAL_IDS.has(id)) {
    requireConfig(
      value >= 0 && value <= 1,
      `parameters.${id}.value must be in [0,1], got ${value}`,
    );
    return;
  }
  if (STRICTLY_POSITIVE_IDS.has(id)) {
    requireConfig(value > 0, `parameters.${id}.value must be > 0, got ${value}`);
    return;
  }
  requireConfig(value >= 0, `parameters.${id}.value must be >= 0, got ${value}`);
}

function parseParameter(raw: RawParameter | undefined, id: ImpactParameterId): ImpactParameter {
  requireConfig(typeof raw === 'object' && raw !== null, `parameters.${id} must be an object`);
  const value = (raw as RawParameter).value;
  requireConfig(typeof value === 'number', `parameters.${id}.value must be a number`);
  checkDomain(id, value as number);
  requireConfig(typeof raw.verified === 'boolean', `parameters.${id}.verified must be a boolean`);
  return {
    value: value as number,
    unit: text(raw.unit, `parameters.${id}.unit`),
    label: text(raw.label, `parameters.${id}.label`),
    citation: text(raw.citation, `parameters.${id}.citation`),
    verified: raw.verified,
  };
}

/**
 * Parse + validate a parameter set. Throws on any violation — a half-valid parameter set is worse than none,
 * because every figure it produces looks equally authoritative.
 */
export function parseImpactParams(raw: unknown): ImpactParams {
  requireConfig(typeof raw === 'object' && raw !== null, 'the file must contain a JSON object');
  const cfg = raw as RawParams;
  requireConfig(cfg.version === 1, `version must be 1, got ${String(cfg.version)}`);
  const rawParams = cfg.parameters;
  requireConfig(
    typeof rawParams === 'object' && rawParams !== null,
    'parameters must be an object',
  );
  const known = new Set<string>(IMPACT_PARAMETER_IDS);
  for (const name of Object.keys(rawParams as Record<string, RawParameter>)) {
    requireConfig(
      known.has(name),
      `unknown parameter '${name}' (known: ${IMPACT_PARAMETER_IDS.join('|')})`,
    );
  }
  const parameters = {} as Record<ImpactParameterId, ImpactParameter>;
  for (const id of IMPACT_PARAMETER_IDS) {
    parameters[id] = parseParameter((rawParams as Record<string, RawParameter>)[id], id);
  }
  return {
    version: 1,
    parameterSetId: text(cfg.parameterSetId, 'parameterSetId'),
    authority: text(cfg.authority, 'authority'),
    verifiedConvention: text(cfg.verifiedConvention, 'verifiedConvention'),
    parameters,
  };
}

/**
 * The SHIPPED parameter set, parsed at import time (fail-fast: a bad config breaks the build's first test,
 * not a responder's screen). Injectable at every entry point exactly like `DEFAULT_LIKELIHOOD_CONFIG` — a
 * region or an exercise can supply its own locally-studied set without touching code.
 */
export const DEFAULT_IMPACT_PARAMS: ImpactParams = parseImpactParams(paramsJson);

/** One assumption as it travels WITH a figure — the reader sees the value, its unit and its verdict. */
export interface ImpactAssumption extends ImpactParameter {
  readonly id: ImpactParameterId;
}

/** Bundle the named parameters as the `assumptions[]` a figure publishes, in the order requested. */
export function assumptionsOf(
  params: ImpactParams,
  ids: readonly ImpactParameterId[],
): readonly ImpactAssumption[] {
  return ids.map((id) => ({ id, ...params.parameters[id] }));
}
