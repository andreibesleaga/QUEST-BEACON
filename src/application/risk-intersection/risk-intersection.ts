// BEACON — risk intersection / exposure use-case (E5·T-190/T-192; FR-3, SPEC §5.1, ADR-005).
// Deterministic: ALL geometry decisions come from the injected SpatialPort (Art. XII — never the LLM).
// Imports PORTS + DOMAIN only (§4 boundary).
import type { SpatialPort } from '@/ports/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { IncidentId, InfrastructureNodeId } from '@/domain/value-objects/ids.js';
import type { InfrastructureNode, InfraNodeType } from '@/domain/infrastructure-node.js';
import type { HazardGeometry } from '@/domain/hazard-geometry.js';
import type { Exposure } from '@/domain/exposure.js';
import { ok, isErr } from '@/domain/shared/result.js';
import { makeExposure } from '@/domain/exposure.js';
import { representativePoint, polygonsOf } from '@/application/shared/geo.js';

/** Inputs for one incident's exposure computation. Buffers are per node type (config-injected). */
export interface ExposureQuery {
  readonly incidentId: IncidentId;
  readonly hazards: readonly HazardGeometry[];
  readonly nodes: readonly InfrastructureNode[];
  readonly buffers: Readonly<Record<InfraNodeType, number>>;
  readonly computedAt: string; // ISO-8601 — injected deterministic compute instant
  readonly outageNodeIds?: readonly InfrastructureNodeId[];
}

export interface ExposureResult {
  readonly exposures: readonly Exposure[];
}

/**
 * Classify each infrastructure node against the incident's hazard footprint (SPEC §5.1):
 * OUTAGE (declared) → IN_POLYGON (point within any hazard polygon) → IN_BUFFER (its type-buffer
 * intersects a hazard) → otherwise not exposed (no row). Every geometry test is delegated to the
 * SpatialPort; a port error short-circuits to Err (never a partial/guessed result).
 */
export function computeExposures(
  query: ExposureQuery,
  spatial: SpatialPort,
): Result<ExposureResult, DomainError> {
  const outages = new Set<string>(query.outageNodeIds ?? []);
  const exposures: Exposure[] = [];
  for (const node of query.nodes) {
    if (outages.has(node.id)) {
      exposures.push(exposureFor(query, node.id, 'OUTAGE', false));
      continue;
    }
    const classified = classifyNode(node, query, spatial);
    if (isErr(classified)) return classified;
    const row = classified.value;
    if (row !== null) exposures.push(row);
  }
  return ok({ exposures });
}

type NodeClass = Result<Exposure | null, DomainError>;

function classifyNode(node: InfrastructureNode, query: ExposureQuery, spatial: SpatialPort): NodeClass {
  const point = representativePoint(node.geom);
  const inside = isInsideAnyHazard(point, query.hazards, spatial);
  if (isErr(inside)) return inside;
  if (inside.value) return ok(exposureFor(query, node.id, 'IN_POLYGON', true));

  const bufferM = query.buffers[node.type];
  const inBuffer = isWithinBuffer(point, bufferM, query.hazards, spatial);
  if (isErr(inBuffer)) return inBuffer;
  if (inBuffer.value) return ok(exposureFor(query, node.id, 'IN_BUFFER', false));
  return ok(null);
}

function isInsideAnyHazard(
  point: readonly [number, number],
  hazards: readonly HazardGeometry[],
  spatial: SpatialPort,
): Result<boolean, DomainError> {
  for (const hz of hazards) {
    for (const poly of polygonsOf(hz.geometry)) {
      const r = spatial.pointInPolygon(point, poly);
      if (isErr(r)) return r;
      if (r.value) return ok(true);
    }
  }
  return ok(false);
}

function isWithinBuffer(
  point: readonly [number, number],
  bufferM: number,
  hazards: readonly HazardGeometry[],
  spatial: SpatialPort,
): Result<boolean, DomainError> {
  const buffered = spatial.buffer({ type: 'Point', coordinates: point }, bufferM);
  if (isErr(buffered)) return buffered;
  for (const hz of hazards) {
    const r = spatial.intersect(buffered.value, hz.geometry);
    if (isErr(r)) return r;
    if (r.value) return ok(true);
  }
  return ok(false);
}

function exposureFor(
  query: ExposureQuery,
  nodeId: InfrastructureNodeId,
  reason: Exposure['reason'],
  insideHazard: boolean,
): Exposure {
  return makeExposure({
    incidentId: query.incidentId,
    nodeId,
    reason,
    insideHazard,
    computedAt: query.computedAt,
  });
}
