// BEACON — EXPOSURE entity (E1·T-057). Deterministic incident<->node intersection result (Art. XII).
// Pure domain: no framework/HTTP/DB imports (F9). No LLM-derived numbers ever land here.
import type { IncidentId, InfrastructureNodeId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';

// Enum mirrors schema.sql exposure.reason CHECK constraint.
export const EXPOSURE_REASONS = ['IN_POLYGON', 'IN_BUFFER', 'OUTAGE'] as const;
export type ExposureReason = (typeof EXPOSURE_REASONS)[number];

export interface Exposure {
  readonly incidentId: IncidentId;
  readonly nodeId: InfrastructureNodeId;
  readonly reason: ExposureReason;
  readonly insideHazard: boolean;
  readonly computedAt: string; // ISO-8601 — deterministic compute timestamp (Art. XII)
  readonly distanceM?: number;
}

export interface MakeExposureInput {
  readonly incidentId: IncidentId;
  readonly nodeId: InfrastructureNodeId;
  readonly reason: ExposureReason;
  readonly computedAt: string;
  readonly insideHazard?: boolean; // schema default false
  readonly distanceM?: number;
}

export function makeExposure(input: MakeExposureInput): Exposure {
  if (!EXPOSURE_REASONS.includes(input.reason)) {
    throw new InvariantViolation(`Exposure.reason must be one of ${EXPOSURE_REASONS.join('|')}, got ${String(input.reason)}`);
  }
  if (input.computedAt === undefined || Number.isNaN(Date.parse(input.computedAt))) {
    throw new InvariantViolation(`Exposure.computedAt must be a valid ISO-8601 instant, got ${String(input.computedAt)}`);
  }
  // Distance is a physical measurement — negative is nonsensical and signals a compute bug.
  if (input.distanceM !== undefined && (Number.isNaN(input.distanceM) || input.distanceM < 0)) {
    throw new InvariantViolation(`Exposure.distanceM must be >= 0, got ${input.distanceM}`);
  }
  const base: Exposure = {
    incidentId: input.incidentId,
    nodeId: input.nodeId,
    reason: input.reason,
    insideHazard: input.insideHazard ?? false,
    computedAt: input.computedAt,
  };
  return input.distanceM === undefined ? base : { ...base, distanceM: input.distanceM };
}
