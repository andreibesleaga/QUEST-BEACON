// BEACON — AICompliancePort reverse-proxy gateway (E6·T-256…T-278a; FR-15/ADR-017).
// The MANDATORY chokepoint in front of EVERY LLM + Vision call. Fixed pipeline (ADR-017):
//   role-scope → rate-limit → circuit-breaker → semantic firewall (input) → policy-as-code →
//   PII detect/redact → cost guardrails (reserve) → hash-chained audit → upstream → output firewall.
// SAFETY stages FAIL CLOSED (a detector error blocks); AVAILABILITY stages (breaker/upstream) degrade
// down the AI ladder. Blocks short-circuit 403 (policy/role/firewall/PII), 429 (rate-limit), or 503
// (breaker-open / cost hold / audit failure). Adapters are reached ONLY with a minted gateway stamp.
import { CircuitState } from 'cockatiel';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { ModelTier } from '@/domain/audit-event.js';
import type { AICompliancePort, ComplianceRequest } from '@/ports/intel.js';
import type { CompiledPolicy, GatewayCallContext, GatewayDecision, GatewayRequest, GatewayStatus } from './types.js';
import type { GateSeal } from './gate-token.js';
import type { AuditSink } from './audit-chain.js';
import type { CostGuard } from './cost-guardrails.js';
import type { RateLimiter } from './rate-limit.js';
import type { Observability } from '@/adapters/ai/observability.js';
import { checkRoleScope } from './role-scope.js';
import { scanInjection, scanInput } from './firewall.js';
import { redactDeep } from './pii.js';
import { estimateReservationUsd, estimateTokens, computeCostUsd } from '@/adapters/ai/cost-rates.js';

/** Minimal breaker surface (cockatiel CircuitBreakerPolicy satisfies it). */
export interface BreakerLike {
  readonly state: CircuitState;
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

export interface UpstreamCall {
  readonly operation: string;
  readonly payload: unknown; // PII-redacted
  readonly token: string; // gateway seal
  readonly modelTier: ModelTier;
  readonly maxTokens: number;
}
export type Upstream = (call: UpstreamCall) => Promise<unknown>;

export interface GatewayDeps {
  readonly compiled: CompiledPolicy;
  readonly seal: GateSeal;
  readonly audit: AuditSink;
  readonly costGuard: CostGuard;
  readonly rateLimiter: RateLimiter;
  readonly breaker: BreakerLike;
  readonly upstream: Upstream;
  readonly observability: Observability;
  readonly enabled?: boolean; // COMPLIANCE_PROXY_ENABLED === 'on' (default true)
}

interface Halt {
  readonly status: GatewayStatus;
  readonly stage: string;
  readonly reason: string;
  readonly requiresHumanApproval?: boolean;
}
interface Prepared {
  readonly payload: unknown;
  readonly maxTokens: number;
  readonly reservedUsd: number;
  readonly inputTokens: number;
}
type PrepResult = { readonly halt: Halt } | { readonly prepared: Prepared };

const stringifyForScan = (value: unknown): string => JSON.stringify(value ?? null);

// Clamp a caller's requested output tokens to the role's ceiling (deny-by-default upper bound).
const resolveMaxTokens = (requested: number | undefined, ceiling: number): number => Math.min(requested ?? ceiling, ceiling);

export class ComplianceGateway implements AICompliancePort {
  readonly #d: GatewayDeps;

  constructor(deps: GatewayDeps) {
    this.#d = deps;
  }

  async mediate<TReq, TRes>(request: ComplianceRequest<TReq>): Promise<Result<GatewayDecision<TRes>, DomainError>> {
    const req = request as GatewayRequest<TReq>;
    if (this.#d.enabled === false) {
      return ok(this.#blocked<TRes>('proxy', 503, 'compliance proxy disabled — AI unreachable (fail-closed)', false));
    }
    const prep = this.#prepare(req);
    if ('halt' in prep) {
      this.#tryAuditBlock(req, prep.halt);
      this.#d.observability.decision(prep.halt.stage, prep.halt.status, prep.halt.reason);
      return ok(this.#blocked<TRes>(prep.halt.stage, prep.halt.status, prep.halt.reason, prep.halt.requiresHumanApproval ?? false));
    }
    return ok(await this.#dispatch<TRes>(req, prep.prepared));
  }

  // ---- input pipeline (fail-closed) ----------------------------------------------------------
  #prepare<TReq>(req: GatewayRequest<TReq>): PrepResult {
    const scope = checkRoleScope(this.#d.compiled.policy, this.#roleInput(req));
    if (!scope.allowed) return { halt: { status: 403, stage: 'role-scope', reason: scope.reason ?? 'denied' } };
    const avail = this.#availability(req);
    if (avail) return { halt: avail };
    const safety = this.#runSafety(req, stringifyForScan(req.payload));
    if ('halt' in safety) return safety;
    return this.#reserve(req, safety.prepared, resolveMaxTokens(req.requestedMaxTokens, scope.rolePolicy?.max_tokens ?? 0));
  }

  // Availability stages (rate-limit 429, breaker-open 503) — degrade, do not fail-closed on safety.
  #availability(req: GatewayRequest<unknown>): Halt | null {
    if (!this.#d.rateLimiter.check(req.callerId ?? req.actorRole)) {
      return { status: 429, stage: 'rate-limit', reason: 'rate limit exceeded — retry after window' };
    }
    if (this.#d.breaker.state === CircuitState.Open) {
      return { status: 503, stage: 'circuit-breaker', reason: 'breaker open — descending AI ladder' };
    }
    return null;
  }

  // Firewall (input) + policy-as-code + PII — all fail-closed (a thrown detector blocks).
  #runSafety<TReq>(req: GatewayRequest<TReq>, scanText: string): PrepResult {
    try {
      const fire = scanInput(scanText, this.#d.compiled.blockedPatterns);
      if (fire) return { halt: { status: 403, stage: 'firewall', reason: `firewall ${fire.kind}: ${fire.name}` } };
      const toolHalt = this.#checkTools(req.operation);
      if (toolHalt) return { halt: toolHalt };
      const pii = redactDeep(req.payload, this.#d.compiled.piiPatterns, this.#d.compiled.policy.pii.action);
      if (pii.blocked) return { halt: { status: 403, stage: 'pii', reason: `PII present (${pii.matches.join(',')}) — blocked` } };
      return { prepared: { payload: pii.value, maxTokens: 0, reservedUsd: 0, inputTokens: estimateTokens(scanText) } };
    } catch {
      // FAIL CLOSED: any safety-control error blocks the call (never forwards unscreened, F16).
      return { halt: { status: 403, stage: 'firewall', reason: 'safety control error — failing closed' } };
    }
  }

  // Cost guardrails: pre-step reservation. Soft within budget; HITL/hard-block above threshold/cap.
  #reserve<TReq>(req: GatewayRequest<TReq>, prepared: Prepared, maxTokens: number): PrepResult {
    const estimatedUsd = req.estimatedCostUsd ?? estimateReservationUsd(req.modelTier, prepared.inputTokens, maxTokens);
    const verdict = this.#d.costGuard.reserve({
      estimatedUsd,
      ...(req.incidentId !== undefined ? { incidentId: req.incidentId } : {}),
      ...(req.regionId !== undefined ? { regionId: req.regionId } : {}),
      ...(req.humanApproved !== undefined ? { humanApproved: req.humanApproved } : {}),
      ...(req.operation !== undefined ? { idempotencyKey: `${req.operation}:${stringifyForScan(prepared.payload)}` } : {}),
    });
    if (!verdict.allowed) {
      return { halt: { status: verdict.status, stage: 'cost', reason: verdict.reason ?? 'budget hold', ...(verdict.requiresHumanApproval ? { requiresHumanApproval: true } : {}) } };
    }
    return { prepared: { payload: prepared.payload, maxTokens, reservedUsd: verdict.reservedUsd, inputTokens: prepared.inputTokens } };
  }

  // ---- upstream + output firewall ------------------------------------------------------------
  async #dispatch<TRes>(req: GatewayRequest<unknown>, prepared: Prepared): Promise<GatewayDecision<TRes>> {
    // Audit BEFORE upstream (ADR-017 order): no audit write ⇒ no upstream call (fail-closed).
    const pre = this.#tryAuditCall(req, 'ai_call', prepared.reservedUsd, prepared.inputTokens, 0);
    if (!pre) return this.#blocked<TRes>('audit', 503, 'audit write failed — call refused (fail-closed)', false);

    const token = await this.#d.seal.mint({ operation: req.operation, modelTier: req.modelTier, maxTokens: prepared.maxTokens });
    let raw: unknown;
    try {
      raw = await this.#d.breaker.execute(() =>
        this.#d.upstream({ operation: req.operation, payload: prepared.payload, token, modelTier: req.modelTier, maxTokens: prepared.maxTokens }),
      );
    } catch {
      return this.#blocked<TRes>('upstream', 503, 'upstream unavailable — breaker/ladder degrade', false);
    }

    const screened = this.#screenOutput(raw);
    if ('halt' in screened) return this.#blocked<TRes>(screened.halt.stage, screened.halt.status, screened.halt.reason, false);

    const outputTokens = estimateTokens(stringifyForScan(screened.value));
    const costUsd = computeCostUsd(req.modelTier, prepared.inputTokens, outputTokens);
    const post = this.#tryAuditCall(req, 'ai_call.reconcile', costUsd, prepared.inputTokens, outputTokens);
    if (!post) return this.#blocked<TRes>('audit', 503, 'reconcile audit failed — result withheld (fail-closed)', false);

    this.#d.observability.aiCall({ operation: req.operation, model: req.modelTier, tier: req.modelTier, inputTokens: prepared.inputTokens, outputTokens, costUsd, stage: 'upstream', outcome: 'allow' });
    return this.#allowed<TRes>(screened.value as TRes);
  }

  // Output firewall (T-278a): block leaked instructions/injection echoes; redact PII in the response.
  #screenOutput(raw: unknown): { readonly value: unknown } | { readonly halt: Halt } {
    try {
      const text = stringifyForScan(raw);
      const inj = scanInjection(text);
      if (inj) return { halt: { status: 403, stage: 'output-firewall', reason: `unsafe output: ${inj.kind}` } };
      const redacted = redactDeep(raw, this.#d.compiled.piiPatterns, this.#d.compiled.policy.pii.action);
      if (redacted.blocked) return { halt: { status: 403, stage: 'output-firewall', reason: 'PII in output — blocked' } };
      return { value: redacted.value };
    } catch {
      return { halt: { status: 403, stage: 'output-firewall', reason: 'output-screen error — failing closed' } };
    }
  }

  // ---- helpers -------------------------------------------------------------------------------
  #roleInput<TReq>(req: GatewayRequest<TReq>): { role: GatewayRequest<TReq>['actorRole']; modelTier: ModelTier; requestedMaxTokens?: number } {
    return { role: req.actorRole, modelTier: req.modelTier, ...(req.requestedMaxTokens !== undefined ? { requestedMaxTokens: req.requestedMaxTokens } : {}) };
  }

  // BEACON's LLM has no tools (narration only); an operation naming a tool must be role-allowed.
  #checkTools(operation: string): Halt | null {
    if (!operation.startsWith('tool.')) return null;
    const anyAllowsTool = Object.values(this.#d.compiled.policy.roles).some((r) => r.allowed_tools.includes(operation));
    return anyAllowsTool ? null : { status: 403, stage: 'policy', reason: `tool '${operation}' not permitted by policy` };
  }

  #tryAuditCall(req: GatewayRequest<unknown>, action: string, costUsd: number, tokensIn: number, tokensOut: number): boolean {
    try {
      this.#d.audit.append({
        action,
        target: req.incidentId ? `incident:${req.incidentId}:${req.operation}` : req.operation,
        costUsd,
        costTokensIn: tokensIn,
        costTokensOut: tokensOut,
        modelTier: req.modelTier,
        ...(req.approverId !== undefined ? { actorId: req.approverId } : {}),
        ...(req.incidentId !== undefined ? { incidentId: req.incidentId } : {}),
        ...(req.regionId !== undefined ? { regionId: req.regionId } : {}),
      });
      return true;
    } catch {
      return false;
    }
  }

  #tryAuditBlock(req: GatewayRequest<unknown>, halt: Halt): void {
    try {
      this.#d.audit.append({ action: `ai_block:${halt.stage}`, target: req.operation, modelTier: req.modelTier });
    } catch {
      /* fail-closed already returns a block; a failed block-audit must not throw out of mediate */
    }
  }

  #headers(): Readonly<Record<string, string>> {
    if (!this.#d.compiled.policy.eu_ai_act.transparency_headers) return {};
    return { 'x-ai-involved': 'true', 'x-ai-content': 'AI-generated narrative', 'x-policy-version': this.#d.compiled.policy.version };
  }

  #allowed<TRes>(result: TRes): GatewayDecision<TRes> {
    return { allowed: true, result, status: 200, stage: 'upstream', policyVersion: this.#d.compiled.policy.version, aiInvolved: true, headers: this.#headers() };
  }

  #blocked<TRes>(stage: string, status: GatewayStatus, reason: string, requiresHumanApproval: boolean): GatewayDecision<TRes> {
    return { allowed: false, reason, status, stage, policyVersion: this.#d.compiled.policy.version, aiInvolved: false, headers: {}, ...(requiresHumanApproval ? { requiresHumanApproval } : {}) };
  }
}

export function makeComplianceGateway(deps: GatewayDeps): ComplianceGateway {
  return new ComplianceGateway(deps);
}

export type { GatewayCallContext };
