// BEACON — AI compliance-proxy composition (E-main; FR-15/ADR-017, Art. XII/XV). Assembles the MANDATORY
// AICompliancePort chokepoint the SitRep narration path routes through WHEN AI is enabled (AI_MODE=cloud|
// local): the ComplianceGateway (role-scope → rate-limit → breaker → input firewall → policy → PII → cost →
// hash-chained audit → upstream → output firewall) in front of the seal-gated LLM ladder. The DEFAULT provider
// is the deterministic, in-process MOCK (no network, no egress) so the demo stays air-gapped even with AI ON;
// real providers plug in via env (ladder-config). AI_MODE=off never constructs this — build-core injects the
// deterministic-only stub → the offline default is unchanged. COMPLIANCE_PROXY_ENABLED=off makes the gateway
// fail-closed (503) so narration degrades to deterministic-only: the proxy is mandatory, never bypassable.
import { pino } from 'pino';
import { ConsecutiveBreaker, circuitBreaker, handleAll } from 'cockatiel';
import type { AICompliancePort, NarrativeRequest } from '@/ports/intel.js';
import type { Env } from '@/config/index.js';
import {
  loadPolicy,
  makeGateSeal,
  makeAuditChain,
  CostGuard,
  makeRateLimiter,
  makeComplianceGateway,
  type AuditSink,
  type Upstream,
} from '@/adapters/compliance/index.js';
import { makeObservability, type Observability } from '@/adapters/ai/observability.js';
import { makeLlmLadder } from '@/adapters/ai/llm/llm-ladder.js';
import { makeMockProvider, type LlmProvider } from '@/adapters/ai/llm/mock-provider.js';
import { makeHttpClient } from '@/adapters/ai/http-client.js';
import { resolveLadder, type AiEnv } from '@/adapters/ai/llm/ladder-config.js';

/** The wired gateway + its hash-chained audit sink (exposed so an integration test can prove the in-path audit). */
export interface ComplianceAi {
  readonly ai: AICompliancePort;
  readonly audit: AuditSink;
}

export interface BuildComplianceAiOptions {
  /** Provider ladder (defaults to the deterministic in-process MOCK — offline, no egress, F3-safe). */
  readonly providers?: readonly LlmProvider[];
  /**
   * Raw env record carrying the LLM_TIER_* vars (NOT the parsed Env — those keys live outside EnvSchema).
   * When present and `providers` is not given, the real env-driven ladder (Groq → OpenRouter → Ollama) is
   * resolved from it; an empty real ladder (no tiers configured) falls back to the offline MOCK.
   */
  readonly env?: AiEnv;
  /** Observability sink (defaults to pino at LOG_LEVEL). Tests inject a silent one. */
  readonly observability?: Observability;
}

/**
 * Build the compliance-gated AICompliancePort the SitRep path narrates through. The LLM ladder is reachable
 * ONLY via the gateway seal (an un-stamped provider call is refused — F16), so the proxy is the single runtime
 * chokepoint for every model call.
 */
export function buildComplianceAi(config: Env, options: BuildComplianceAiOptions = {}): ComplianceAi {
  const compiled = loadPolicy(config.COMPLIANCE_POLICIES_PATH);
  const seal = makeGateSeal();
  const audit = makeAuditChain();
  const costGuard = new CostGuard(compiled.policy.budget, audit);
  const rateLimiter = makeRateLimiter(compiled.policy.rate_limit.window_ms, compiled.policy.rate_limit.max_requests);
  const breaker = circuitBreaker(handleAll, { halfOpenAfter: 60_000, breaker: new ConsecutiveBreaker(5) });
  const observability = options.observability ?? makeObservability(pino({ level: config.LOG_LEVEL }));
  // Real tiers when configured (AI_MODE=cloud|local + LLM_TIER_*); an empty real ladder falls back to the
  // offline MOCK so AI ON with no keys still narrates offline (F3-safe). NEVER drop the mock fallback.
  const resolved = options.providers ?? (options.env ? resolveLadder(options.env, makeHttpClient()) : []);
  const providers = resolved.length > 0 ? resolved : [makeMockProvider()];
  const ladder = makeLlmLadder(providers, seal);
  // The upstream reaches the ladder ONLY with the gateway's minted seal (un-stamped calls are refused, F16).
  const upstream: Upstream = async ({ token, payload }) => {
    const narrated = await ladder.sealed(token).narrate(payload as NarrativeRequest);
    if (!narrated.ok) throw narrated.error; // availability failure → breaker/ladder degrade (503)
    return narrated.value;
  };
  const ai = makeComplianceGateway({
    compiled,
    seal,
    audit,
    costGuard,
    rateLimiter,
    breaker,
    upstream,
    observability,
    enabled: config.COMPLIANCE_PROXY_ENABLED === 'on',
  });
  return { ai, audit };
}
