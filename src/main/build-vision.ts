// BEACON — Vision compliance-proxy composition (E6·T-290/T-291; ADR-008/008a/ADR-017, Art. XII/XIV).
// Mirrors build-ai.ts's seal handshake for the advisory VisionPort: the SAME mandatory chokepoint shape
// (role-scope → rate-limit → breaker → input firewall → policy → PII → cost → hash-chained audit →
// upstream → output firewall) in front of the seal-gated VisionAdapter (consent + PII-screen gated,
// Art. XIV — un-stamped calls are refused, F16). Gated by FEATURE_VISION, deliberately INDEPENDENT of
// AI_MODE (a deployment may narrate without vision, or vice versa). The provider ladder is resolved from env
// (`vision-config.ts`): `VISION_MODE=off` — the default — is the deterministic in-process MockVision (no
// network, no egress) so the demo stays air-gapped even with vision ON, while `cloud`/`local` put a real
// multimodal rung in front of a LABELLED degraded mock. The composition root (build-core.ts) only
// wires `services.vision` when FEATURE_VISION=on — off/unset is byte-identical to today (the field is
// simply absent), mirroring how AI_MODE=off never constructs buildComplianceAi.
import { pino } from 'pino';
import { ConsecutiveBreaker, circuitBreaker, handleAll } from 'cockatiel';
import type { AICompliancePort, VisionMediatePayload } from '@/ports/intel.js';
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
import { makeVisionAdapter } from '@/adapters/ai/vision/vision-adapter.js';
import type { VisionProvider } from '@/adapters/ai/vision/mock-vision.js';
import { resolveVisionProviders, type VisionEnv } from '@/adapters/ai/vision/vision-config.js';

/** The wired vision gateway + its hash-chained audit sink (mirrors ComplianceAi in build-ai.ts). */
export interface ComplianceVision {
  readonly vision: AICompliancePort;
  readonly audit: AuditSink;
}

export interface BuildComplianceVisionOptions {
  /** Explicit provider ladder — overrides env resolution entirely (tests inject a stub rung here). */
  readonly providers?: readonly VisionProvider[];
  /**
   * Raw env record carrying the OpenRouter credentials the cloud rung REUSES (`LLM_TIER_FALLBACK_KEY` /
   * `OPENROUTER_API_KEY`). Those keys live outside EnvSchema by design (build-ai.ts:39), so — exactly as
   * `BuildComplianceAiOptions.env` does for the LLM ladder — they arrive here rather than through `config`.
   * Absent ⇒ an empty record ⇒ a cloud rung with no key degrades to the LABELLED mock (never throws).
   */
  readonly env?: VisionEnv;
  /** Observability sink (defaults to pino at LOG_LEVEL). Tests inject a silent one. */
  readonly observability?: Observability;
}

/**
 * Build the compliance-gated AICompliancePort the verify flow requests advisory findings through. The
 * VisionAdapter is reachable ONLY via the gateway seal (an un-stamped call is refused), so the proxy is
 * the single runtime chokepoint for every vision call, exactly like the LLM ladder in build-ai.ts.
 */
export function buildComplianceVision(config: Env, options: BuildComplianceVisionOptions = {}): ComplianceVision {
  const compiled = loadPolicy(config.COMPLIANCE_POLICIES_PATH);
  const seal = makeGateSeal();
  const audit = makeAuditChain();
  const costGuard = new CostGuard(compiled.policy.budget, audit);
  const rateLimiter = makeRateLimiter(compiled.policy.rate_limit.window_ms, compiled.policy.rate_limit.max_requests);
  const breaker = circuitBreaker(handleAll, { halfOpenAfter: 60_000, breaker: new ConsecutiveBreaker(5) });
  const observability = options.observability ?? makeObservability(pino({ level: config.LOG_LEVEL }));
  // THE ladder (S2·Lane V — was `[makeMockVision()]`, a hardcode that made every documented VISION_* var
  // inert; UNIMPLEMENTED_REGISTER row 27). `VISION_MODE=off` still resolves to exactly that mock, so the
  // offline default is unchanged; cloud/local add a real rung IN FRONT of a labelled degraded mock.
  const providers = options.providers ?? resolveVisionProviders(config, options.env ?? {});
  // FEATURE_VISION=off ⇒ the adapter itself refuses every call (DISABLED) — the gateway pipeline still
  // runs (role/rate/firewall/PII/cost/audit), so a misconfigured caller gets an honest audited refusal
  // rather than a silent no-op; build-core.ts additionally never wires `services.vision` when off.
  const visionAdapter = makeVisionAdapter(providers, seal, config.FEATURE_VISION === 'on');
  // The upstream reaches the adapter ONLY with the gateway's minted seal (un-stamped calls refused, F16).
  // Consent + PII-screen (Art. XIV) travel inside the (PII-screened) payload — UpstreamCall has no
  // dedicated gate-context field — and are re-checked by VisionAdapter.sealed as a second, independent gate.
  const upstream: Upstream = async ({ token, payload }) => {
    const { request, context } = payload as VisionMediatePayload;
    const found = await visionAdapter.sealed(token, context).analyze(request);
    if (!found.ok) throw found.error; // disabled/unconsented/unavailable → breaker/ladder degrade (503)
    return found.value;
  };
  const vision = makeComplianceGateway({
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
  return { vision, audit };
}
