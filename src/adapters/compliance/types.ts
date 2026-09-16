// BEACON — AICompliancePort gateway shared types (E6·T-256; ADR-017/018/022).
// The gateway is the MANDATORY chokepoint in front of EVERY LLM + Vision call. These types mirror
// schemas/policies.schema.json (the loaded, validated Policy) and extend the port's ComplianceRequest/
// ComplianceDecision with the gateway-internal call context + decision metadata (HTTP status, stage,
// EU-AI-Act transparency headers). Extra fields are covariant refinements so the class still
// `implements AICompliancePort` (return-type covariance; param stays exactly ComplianceRequest).
import type { ComplianceDecision, ComplianceRequest } from '@/ports/intel.js';

// ---- Loaded policy (1:1 with policies.schema.json) --------------------------------------------
export interface RolePolicy {
  readonly allowed_models: readonly string[];
  readonly allowed_tools: readonly string[];
  readonly max_tokens: number;
}
export interface NamedPattern {
  readonly name: string;
  readonly regex: string;
}
export type PiiAction = 'redact' | 'block' | 'hash';
export interface PiiPolicy {
  readonly action: PiiAction;
  readonly patterns: readonly NamedPattern[];
}
export interface ContentSafetyPolicy {
  readonly prompt_injection: boolean;
  readonly blocked_command_patterns: readonly NamedPattern[];
}
export interface RateLimitPolicy {
  readonly window_ms: number;
  readonly max_requests: number;
}
export interface BudgetPolicy {
  readonly per_incident_usd: number;
  readonly per_region_usd: number;
  readonly escalation_threshold_usd: number;
  readonly require_human_above_threshold: boolean;
}
export interface EuAiActPolicy {
  readonly transparency_headers: boolean;
  readonly log_retention_days: number;
}
export interface CircuitBreakerPolicy {
  readonly failure_threshold?: number;
  readonly open_duration_ms?: number;
}
export interface Policy {
  readonly version: string;
  readonly roles: Readonly<Record<string, RolePolicy>>;
  readonly pii: PiiPolicy;
  readonly content_safety: ContentSafetyPolicy;
  readonly rate_limit: RateLimitPolicy;
  readonly budget: BudgetPolicy;
  readonly eu_ai_act: EuAiActPolicy;
  readonly circuit_breaker?: CircuitBreakerPolicy;
}

/** A named policy pattern with its regex pre-compiled at boot (fail-fast on a bad pattern). */
export interface CompiledPattern {
  readonly name: string;
  readonly re: RegExp;
}
/** The Policy plus its compiled PII + blocked-command detectors (regex-compile boot check, D-29). */
export interface CompiledPolicy {
  readonly policy: Policy;
  readonly piiPatterns: readonly CompiledPattern[];
  readonly blockedPatterns: readonly CompiledPattern[];
}

// ---- Gateway request / decision --------------------------------------------------------------
export type GatewayStatus = 200 | 403 | 429 | 503;

/**
 * Call-scoped context the gateway reads off the request in addition to the port's ComplianceRequest.
 * All optional so a plain ComplianceRequest is still a valid GatewayRequest (deny-by-default defaults).
 */
export interface GatewayCallContext {
  readonly callerId?: string; // rate-limit bucket key; falls back to the actor role
  readonly incidentId?: string; // cost-accounting scope (per-incident cap, D-29)
  readonly regionId?: string; // per-region cap scope
  readonly requestedMaxTokens?: number; // checked against the role's max_tokens ceiling
  readonly estimatedCostUsd?: number; // caller worst-case estimate for reservation
  readonly humanApproved?: boolean; // HITL approval carried back after an escalation hold
  readonly approverId?: string; // recorded in the AUDIT_EVENT when humanApproved
  readonly imageConsented?: boolean; // vision consent gate (Art. XIV)
  readonly piiScreened?: boolean; // vision PII-screen gate (Art. XIV)
}

export type GatewayRequest<TReq> = ComplianceRequest<TReq> & GatewayCallContext;

/** ComplianceDecision refined with the transport status + stage + transparency metadata. */
export interface GatewayDecision<TRes> extends ComplianceDecision<TRes> {
  readonly status: GatewayStatus;
  readonly stage: string; // pipeline stage that decided (role-scope | firewall | pii | cost | audit | upstream)
  readonly policyVersion: string; // decision cites the exact policy version (EU AI Act Art.12)
  readonly aiInvolved: boolean;
  readonly headers: Readonly<Record<string, string>>; // EU AI Act transparency headers on AI-derived responses
  readonly requiresHumanApproval?: boolean; // true when held for HITL (cost escalation / cap)
}
