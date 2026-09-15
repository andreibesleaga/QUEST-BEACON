// BEACON — INFRASTRUCTURE_NODE entity (E1·T-055). Lifeline asset with a hazard-relationship state machine.
// Pure domain: no framework/HTTP/DB imports (F9).
import type { InfrastructureNodeId, SourceId } from './value-objects/ids.js';
import type { Geometry } from './value-objects/geo.js';
import { InvariantViolation, InvalidTransition } from './errors.js';

// Enums mirror schema.sql infrastructure_node.type / .status CHECK constraints exactly.
export const INFRA_NODE_TYPES = [
  'HOSPITAL',
  'NURSING_HOME',
  'POWER',
  'CELL',
  'ROAD',
  'RAIL',
  'SHELTER',
] as const;
export type InfraNodeType = (typeof INFRA_NODE_TYPES)[number];

export const INFRA_NODE_STATUSES = ['ONLINE', 'AT_RISK', 'OFFLINE'] as const;
export type InfraNodeStatus = (typeof INFRA_NODE_STATUSES)[number];

export interface InfrastructureNode {
  readonly id: InfrastructureNodeId;
  readonly type: InfraNodeType;
  readonly geom: Geometry;
  readonly status: InfraNodeStatus;
  readonly sourceId?: SourceId;
}

export interface MakeInfrastructureNodeInput {
  readonly id: InfrastructureNodeId;
  readonly type: InfraNodeType;
  readonly geom: Geometry;
  readonly status?: InfraNodeStatus; // schema default ONLINE
  readonly sourceId?: SourceId;
}

// Legal transitions per DOMAIN_MODEL §4. A node degrades one step at a time (ONLINE->AT_RISK->OFFLINE)
// and recovers to ONLINE from either state. A direct ONLINE->OFFLINE hop is illegal (T-055 acceptance).
const LEGAL_TRANSITIONS: Readonly<Record<InfraNodeStatus, readonly InfraNodeStatus[]>> = {
  ONLINE: ['AT_RISK'],
  AT_RISK: ['OFFLINE', 'ONLINE'],
  OFFLINE: ['ONLINE'],
};

export function canTransitionInfraNode(from: InfraNodeStatus, to: InfraNodeStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

const GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon', 'MultiPolygon'];

export function makeInfrastructureNode(input: MakeInfrastructureNodeInput): InfrastructureNode {
  if (!INFRA_NODE_TYPES.includes(input.type)) {
    throw new InvariantViolation(
      `InfrastructureNode.type must be one of ${INFRA_NODE_TYPES.join('|')}, got ${String(input.type)}`,
    );
  }
  if (input.geom === undefined || !GEOMETRY_TYPES.includes(input.geom.type)) {
    throw new InvariantViolation('InfrastructureNode.geom must be a valid GeoJSON geometry');
  }
  const status = input.status ?? 'ONLINE';
  if (!INFRA_NODE_STATUSES.includes(status)) {
    throw new InvariantViolation(
      `InfrastructureNode.status must be one of ${INFRA_NODE_STATUSES.join('|')}, got ${String(status)}`,
    );
  }
  const base = { id: input.id, type: input.type, geom: input.geom, status };
  return input.sourceId === undefined ? base : { ...base, sourceId: input.sourceId };
}

/** Transition a node's status; throws InvalidTransition on an illegal hop (e.g. ONLINE->OFFLINE). */
export function transitionInfraNode(
  node: InfrastructureNode,
  to: InfraNodeStatus,
): InfrastructureNode {
  if (!canTransitionInfraNode(node.status, to)) {
    throw new InvalidTransition(`InfrastructureNode cannot move ${node.status} -> ${to}`);
  }
  return { ...node, status: to };
}
