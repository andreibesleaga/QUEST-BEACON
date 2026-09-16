// BEACON — compliance adapter barrel (E6; ADR-017/018/022). The AICompliancePort gateway + stages.
export { loadPolicy } from './policy-loader.js';
export { compilePolicyRegex, isValidPolicyRegex } from './regex-util.js';
export { GateSeal, makeGateSeal } from './gate-token.js';
export type { StampClaims } from './gate-token.js';
export { checkRoleScope } from './role-scope.js';
export type { RoleScopeInput, RoleScopeVerdict } from './role-scope.js';
export { makeRateLimiter } from './rate-limit.js';
export type { RateLimiter } from './rate-limit.js';
export { scanInjection, scanBlockedCommands, scanInput } from './firewall.js';
export type { FirewallHit, FirewallKind } from './firewall.js';
export { applyPii, detectPii, redactDeep } from './pii.js';
export type { PiiOutcome, DeepPiiOutcome } from './pii.js';
export { CostGuard, classifyEscalation, DEFAULT_LIMITS } from './cost-guardrails.js';
export type {
  GuardLimits,
  ReserveInput,
  ReserveVerdict,
  Escalation,
  SpendLedger,
} from './cost-guardrails.js';
export { AuditChain, makeAuditChain } from './audit-chain.js';
export type { AuditSink, AuditAppendInput } from './audit-chain.js';
export { ComplianceGateway, makeComplianceGateway } from './compliance-gateway.js';
export type { BreakerLike, GatewayDeps, Upstream, UpstreamCall } from './compliance-gateway.js';
export type {
  CompiledPolicy,
  CompiledPattern,
  GatewayCallContext,
  GatewayDecision,
  GatewayRequest,
  GatewayStatus,
  Policy,
} from './types.js';
