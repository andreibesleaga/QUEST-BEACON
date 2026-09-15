// BEACON — Early Action Protocol registry: fail-fast parser + the SHIPPED protocols (D2; ADR-034 §1,
// FR-AA-1, ADR-012 config-not-code).
//
// The protocols themselves live in `config/eap/*.json` and are validated by `schemas/eap.schema.json` — this
// module holds NO threshold, action, ceiling, role or duration literal. That is the point: an EAP is doctrine
// a human signed off, so changing one must be a reviewable data diff, never an edit to a use-case.
//
// The pattern copied here is the EXECUTED config-as-data precedent — `policy-loader.ts:34-47`: compile the
// published JSON-Schema, validate, and refuse to run on a bad file. `schemas/threshold-rule.schema.json` was
// deliberately NOT extended: it is DEAD (finding F-33 — zero code references, drifted from
// `src/domain/threshold-rule.ts`), and copying a dead pattern would propagate it.
//
// WHY A HAND-WRITTEN PARSER OVER STATIC IMPORTS RATHER THAN AN AJV DIRECTORY READ. This module is imported
// by a PURE application use-case, which may not touch the filesystem (Ajv needs to read the schema from
// disk), and ADR-034 §1 requires the protocol set to be pinned by commit so a replay is reproducible and the
// air-gapped default (`FEATURE_STORE=memory`) still has an engine. Static imports give exactly that: the
// shipped set is fixed at build time, an EAP id never becomes a path segment (closing the traversal class
// NFR-F7 names), and a missing file is a compile error rather than a silently smaller protocol set. The
// JSON-Schema is enforced against every shipped file by `eap-config.schema.test.ts` — the same split
// `likelihood-config.ts` (C1.2) and `forecast-trigger-config.ts` (C2.4) already use.
import type {
  EapAction,
  EapApproval,
  EapResourceCeiling,
  EapScope,
  EapStop,
  EapStopCondition,
  EapTrigger,
  EarlyActionProtocol,
} from '@/domain/early-action-protocol.js';
import { makeEarlyActionProtocol } from '@/domain/early-action-protocol.js';
import type { PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import type { ResourceKind } from '@/domain/resource.js';
import { shippedRegion } from '@/config/regions.js';
import esWildfire from '../../../config/eap/es-wildfire.json';
import grWildfire from '../../../config/eap/gr-wildfire.json';
import phTyphoonFlood from '../../../config/eap/ph-typhoon-flood.json';
import roDanubeFlood from '../../../config/eap/ro-danube-flood.json';
import usCaWildfire from '../../../config/eap/us-ca-wildfire.json';

/** Config-validation failure. Fail fast and loudly: a wrong trigger silently changes when people are moved. */
function requireConfig(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid config/eap: ${message}`);
}

// Permissive views of the raw files — mirrors the RawRule approach in `likelihood-config.ts`.
type RawRecord = Readonly<Record<string, unknown>>;

function record(value: unknown, what: string): RawRecord {
  requireConfig(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${what} must be an object`,
  );
  return value as RawRecord;
}

function array(value: unknown, what: string): readonly unknown[] {
  requireConfig(Array.isArray(value) && value.length > 0, `${what} must be a non-empty array`);
  return value as readonly unknown[];
}

function text(value: unknown, what: string): string {
  requireConfig(
    typeof value === 'string' && value.trim().length > 0,
    `${what} must be a non-empty string`,
  );
  return value as string;
}

function num(value: unknown, what: string): number {
  requireConfig(
    typeof value === 'number' && Number.isFinite(value),
    `${what} must be a finite number`,
  );
  return value as number;
}

function position(value: unknown, what: string): Position {
  const pair = value as readonly unknown[];
  requireConfig(Array.isArray(pair) && pair.length === 2, `${what} must be a [lon, lat] pair`);
  return [num(pair[0], `${what}[0]`), num(pair[1], `${what}[1]`)];
}

function polygon(value: unknown, what: string): PolygonGeometry {
  const raw = record(value, what);
  requireConfig(
    raw['type'] === 'Polygon',
    `${what}.type must be 'Polygon' (a scope must be a closed area)`,
  );
  const rings = array(raw['coordinates'], `${what}.coordinates`);
  return {
    type: 'Polygon',
    coordinates: rings.map((ring, i) =>
      array(ring, `${what}.coordinates[${i}]`).map((p, j) =>
        position(p, `${what}.coordinates[${i}][${j}]`),
      ),
    ),
  };
}

function parseTrigger(value: unknown, what: string): EapTrigger {
  const raw = record(value, what);
  return {
    source: text(raw['source'], `${what}.source`),
    parameter: text(raw['parameter'], `${what}.parameter`),
    unit: text(raw['unit'], `${what}.unit`),
    threshold: num(raw['threshold'], `${what}.threshold`),
    comparator: raw['comparator'] as EapTrigger['comparator'],
    minMembersFraction: num(raw['minMembersFraction'], `${what}.minMembersFraction`),
    minLikelihoodClass: raw['minLikelihoodClass'] as EapTrigger['minLikelihoodClass'],
    leadTimeHours: num(raw['leadTimeHours'], `${what}.leadTimeHours`),
  };
}

function parseAction(value: unknown, what: string): EapAction {
  const raw = record(value, what);
  const resourceKind = raw['resourceKind'];
  return {
    id: text(raw['id'], `${what}.id`),
    label: text(raw['label'], `${what}.label`),
    kind: raw['kind'] as EapAction['kind'],
    ...(resourceKind === undefined ? {} : { resourceKind: resourceKind as ResourceKind }),
  };
}

function parseCeiling(value: unknown, what: string): EapResourceCeiling {
  const raw = record(value, what);
  const byKind = raw['maxByKind'];
  return {
    maxResources: num(raw['maxResources'], `${what}.maxResources`),
    basis: text(raw['basis'], `${what}.basis`),
    ...(byKind === undefined
      ? {}
      : {
          maxByKind: record(byKind, `${what}.maxByKind`) as NonNullable<
            EapResourceCeiling['maxByKind']
          >,
        }),
  };
}

function parseApproval(value: unknown, what: string): EapApproval {
  const raw = record(value, what);
  return {
    authorizerRole: raw['authorizerRole'] as EapApproval['authorizerRole'],
    fallbackRole: raw['fallbackRole'] as EapApproval['fallbackRole'],
    fallbackAfterMinutes: num(raw['fallbackAfterMinutes'], `${what}.fallbackAfterMinutes`),
  };
}

function parseStop(value: unknown, what: string): EapStop {
  const raw = record(value, what);
  return {
    conditions: array(raw['conditions'], `${what}.conditions`).map((c, i): EapStopCondition => {
      const cond = record(c, `${what}.conditions[${i}]`);
      return {
        id: text(cond['id'], `${what}.conditions[${i}].id`),
        label: text(cond['label'], `${what}.conditions[${i}].label`),
      };
    }),
    authorizerRole: raw['authorizerRole'] as EapStop['authorizerRole'],
    maxDurationHours: num(raw['maxDurationHours'], `${what}.maxDurationHours`),
  };
}

/**
 * The scope. `regionId` is checked against the SHIPPED region registry (`config/regions.json` via
 * `src/config/regions.ts`) rather than a hardcoded list, so an EAP for a region BEACON does not ship is a
 * boot failure instead of a protocol that quietly never matches anything.
 */
function parseScope(value: unknown, what: string): EapScope {
  const raw = record(value, what);
  const regionId = text(raw['regionId'], `${what}.regionId`);
  requireConfig(
    shippedRegion(regionId) !== undefined,
    `${what}.regionId '${regionId}' is not a shipped region (config/regions.json)`,
  );
  return { regionId, geometry: polygon(raw['geometry'], `${what}.geometry`) };
}

/**
 * Parse + validate one EAP file. Throws on any violation — a half-valid protocol is worse than none, because
 * every activation it produces looks equally authoritative. Structural invariants (the stage ladder, action
 * kind/resourceKind pairing, ceiling coherence, the SOP chain, the STOP block) are enforced by
 * `makeEarlyActionProtocol`, so there is exactly one place that decides what a valid EAP is.
 */
export function parseEarlyActionProtocol(raw: unknown): EarlyActionProtocol {
  const cfg = record(raw, 'the file');
  requireConfig(cfg['version'] === 1, `version must be 1, got ${String(cfg['version'])}`);
  const triggers = record(cfg['triggers'], 'triggers');
  return makeEarlyActionProtocol({
    id: text(cfg['id'], 'id'),
    label: text(cfg['label'], 'label'),
    hazard: cfg['hazard'] as EarlyActionProtocol['hazard'],
    status: cfg['status'] as EarlyActionProtocol['status'],
    provenance: text(cfg['provenance'], 'provenance'),
    scope: parseScope(cfg['scope'], 'scope'),
    triggers: {
      readiness: parseTrigger(triggers['readiness'], 'triggers.readiness'),
      activation: parseTrigger(triggers['activation'], 'triggers.activation'),
    },
    actions: array(cfg['actions'], 'actions').map((a, i) => parseAction(a, `actions[${i}]`)),
    resourceCeiling: parseCeiling(cfg['resourceCeiling'], 'resourceCeiling'),
    approval: parseApproval(cfg['approval'], 'approval'),
    stop: parseStop(cfg['stop'], 'stop'),
  });
}

/**
 * The SHIPPED protocol set, parsed at import time (fail-fast: a bad EAP breaks the build's first test, not a
 * responder's screen). Every one of them is `status: 'ILLUSTRATIVE'` and says so in its own `provenance`
 * string — structurally faithful to the IFRC element list, but invented for demonstration and endorsed by
 * nobody (ADR-034 honest limitation 2).
 */
export const SHIPPED_EAPS: readonly EarlyActionProtocol[] = Object.freeze(
  [usCaWildfire, roDanubeFlood, phTyphoonFlood, esWildfire, grWildfire].map((raw) =>
    parseEarlyActionProtocol(raw),
  ),
);

/** Look up a shipped protocol. Returns `undefined` rather than substituting another region's protocol. */
export function shippedEap(id: string): EarlyActionProtocol | undefined {
  return SHIPPED_EAPS.find((eap) => eap.id === id);
}
