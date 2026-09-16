// BEACON — pipeline stage 1: JWT/role scope (E6·T-258; ADR-017/CM-C2/ASI03/LLM06).
// Deny-by-default RBAC: a role only reaches the model tiers + tools + token ceiling its policy grants.
// The domain role is uppercase (app-user.ts); policies.yml keys are lowercase — mapped here.
import type { AppUserRole } from '@/domain/app-user.js';
import type { ModelTier } from '@/domain/audit-event.js';
import type { Policy, RolePolicy } from './types.js';

const ROLE_KEY: Readonly<Record<AppUserRole, string>> = {
  EM: 'em',
  VERIFIER: 'verifier',
  RESPONDER: 'responder',
  PUBLIC: 'public',
};

// Which policy model-id a request's ModelTier represents (policies.yml allowed_models ladder ids).
const TIER_MODEL_ID: Readonly<Record<ModelTier, string>> = {
  CLOUD: 'default',
  LOCAL: 'local',
  VISION: 'vision',
  DETERMINISTIC: 'deterministic',
};

export interface RoleScopeInput {
  readonly role: AppUserRole;
  readonly modelTier: ModelTier;
  readonly requestedMaxTokens?: number;
}

export interface RoleScopeVerdict {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly rolePolicy?: RolePolicy;
}

function modelAllowed(rolePolicy: RolePolicy, tier: ModelTier): boolean {
  // The deterministic-only rung never egresses to a model, so it is always in-scope (safe fallback).
  if (tier === 'DETERMINISTIC') return true;
  return (
    rolePolicy.allowed_models.includes('*') ||
    rolePolicy.allowed_models.includes(TIER_MODEL_ID[tier])
  );
}

/** Enforce role → allowed_models / max_tokens; deny-by-default when the role has no policy. */
export function checkRoleScope(policy: Policy, input: RoleScopeInput): RoleScopeVerdict {
  const rolePolicy = policy.roles[ROLE_KEY[input.role]];
  if (!rolePolicy)
    return { allowed: false, reason: `role '${input.role}' has no AI policy (deny-by-default)` };
  if (!modelAllowed(rolePolicy, input.modelTier)) {
    return {
      allowed: false,
      reason: `role '${input.role}' may not use model tier ${input.modelTier}`,
      rolePolicy,
    };
  }
  if (input.requestedMaxTokens !== undefined && input.requestedMaxTokens > rolePolicy.max_tokens) {
    return {
      allowed: false,
      reason: `requested max_tokens ${input.requestedMaxTokens} exceeds role ceiling ${rolePolicy.max_tokens}`,
      rolePolicy,
    };
  }
  return { allowed: true, rolePolicy };
}
