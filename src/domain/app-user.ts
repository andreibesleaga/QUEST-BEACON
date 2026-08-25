// BEACON — APP_USER entity (E1·T-081). RBAC principal (PRD §11). Role drives access decisions.
// Pure domain: no framework/HTTP/DB imports (F9).
import type { AppUserId, OrgId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';

// Enum mirrors schema.sql app_user.role CHECK. Ordered low→high privilege for RBAC rank comparisons.
export const APP_USER_ROLES = ['PUBLIC', 'RESPONDER', 'VERIFIER', 'EM'] as const;
export type AppUserRole = (typeof APP_USER_ROLES)[number];

// Privilege rank: higher number = more authority. Used for "role ≥ X" gates (e.g. precise-PII view, Art. XIV).
const ROLE_RANK: Readonly<Record<AppUserRole, number>> = Object.freeze({
  PUBLIC: 0,
  RESPONDER: 1,
  VERIFIER: 2,
  EM: 3,
});

export interface AppUser {
  readonly id: AppUserId;
  readonly role: AppUserRole;
  readonly orgId?: OrgId; // nullable in the DDL
}

export interface MakeAppUserInput {
  readonly id: AppUserId;
  readonly role?: AppUserRole; // defaults to PUBLIC (schema default — least privilege)
  readonly orgId?: OrgId;
}

/** Numeric privilege rank for a role (PUBLIC=0 … EM=3). Enables ordered RBAC comparisons. */
export function roleRank(role: AppUserRole): number {
  return ROLE_RANK[role];
}

/**
 * True when the role has responder-level access or above (RESPONDER, VERIFIER, EM).
 * This is the gate for responder-only surfaces such as precise SOS location (Art. XIV).
 */
export function isResponder(role: AppUserRole): boolean {
  return roleRank(role) >= ROLE_RANK.RESPONDER;
}

export function makeAppUser(input: MakeAppUserInput): AppUser {
  const role = input.role ?? 'PUBLIC';
  if (!APP_USER_ROLES.includes(role)) {
    throw new InvariantViolation(`AppUser.role must be one of ${APP_USER_ROLES.join('|')}, got ${String(role)}`);
  }
  return {
    id: input.id,
    role,
    ...(input.orgId !== undefined ? { orgId: input.orgId } : {}),
  };
}
