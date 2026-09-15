// BEACON — Precise-PII RBAC gating on the map (E8·T-370; Art. XIV / ST3). A single pure decision:
// precise geometry is revealed ONLY to a RESPONDER-or-above principal; PUBLIC always sees the generalized
// (coarsened) location. Reuses the domain's `isResponder` rank gate so the UI never re-implements RBAC.
import { isResponder } from '@/domain/app-user.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type { ActorRole } from '../../_lib/types.js';
import type { GeoFeature } from './types.js';

/** True when the acting role may see precise SOS/PII geometry (RESPONDER, VERIFIER, EM). */
export function isPreciseVisible(role: ActorRole): boolean {
  return isResponder(role);
}

/**
 * The location to PLOT for a feature. Returns the precise geometry only when the feature carries one AND
 * the role is responder-level; otherwise the generalized public position (never leaks precise PII, Art. XIV).
 */
export function visibleGeometry(feature: GeoFeature, role: ActorRole): Position {
  if (feature.precisePosition !== undefined && isResponder(role)) {
    return feature.precisePosition;
  }
  return feature.position;
}
