// BEACON test harness — AI-layer fakes (TEST_PLAN §4; F3/F4/F7/F16/F17). All three are toggleable so
// the redundancy + governance suites can drive their failure modes deterministically:
//   FakeLLM        — narrate-only (Art. XII). Default output is NON-NUMERIC prose grounded ONLY in the
//                    supplied cited facts. `disabled` → typed error (AI-down ladder, F7). `leakNumbers`
//                    → injects a figure so the F3 no-LLM-numbers guard can be shown to bite.
//   FakeVision     — advisory, confidence-scored finding; `disabled` degrades gracefully (skip rung).
//   FakeCompliance — the ADR-017 gateway chokepoint (F16): fail-closed on PII/injection, hard-block over
//                    budget (F17); otherwise allow. It is the ONLY sanctioned path to a model call.
import type {
  AICompliancePort,
  ComplianceDecision,
  ComplianceRequest,
  LLMPort,
  Narrative,
  NarrativeRequest,
  VisionFinding,
  VisionPort,
  VisionRequest,
} from '@/ports/intel.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError as DomainErr } from '@/domain/errors.js';

export interface FakeLLMOptions {
  readonly disabled?: boolean; // simulate the whole AI ladder being down (F7)
  readonly leakNumbers?: boolean; // simulate an F3 violation (LLM authors a number)
}

export class FakeLLM implements LLMPort {
  public disabled: boolean;
  public leakNumbers: boolean;
  public calls = 0;

  constructor(options: FakeLLMOptions = {}) {
    this.disabled = options.disabled ?? false;
    this.leakNumbers = options.leakNumbers ?? false;
  }

  narrate(request: NarrativeRequest): Promise<Result<Narrative, DomainError>> {
    this.calls++;
    if (this.disabled) {
      return Promise.resolve(err(new DomainErr('CONFLICT', 'LLM unavailable (AI ladder down)')));
    }
    const base = 'The situation is summarized from the cited facts provided; consult citations for specifics.';
    const text = this.leakNumbers ? `${base} Estimated spread is 5 km.` : base;
    return Promise.resolve(ok({ text, citations: request.facts.map((f) => f.citation) }));
  }
}

export interface FakeVisionOptions {
  readonly disabled?: boolean;
  readonly confidence?: number;
}

export class FakeVision implements VisionPort {
  public disabled: boolean;
  private readonly confidence: number;

  constructor(options: FakeVisionOptions = {}) {
    this.disabled = options.disabled ?? false;
    this.confidence = options.confidence ?? 0.72;
  }

  analyze(request: VisionRequest): Promise<Result<VisionFinding, DomainError>> {
    if (this.disabled) {
      return Promise.resolve(err(new DomainErr('CONFLICT', 'vision model unavailable (skip rung)')));
    }
    return Promise.resolve(
      ok({ label: request.task, confidence: this.confidence, notes: 'advisory; cited; not auto-alerting' }),
    );
  }
}

export interface FakeComplianceOptions {
  readonly blockPii?: boolean; // fail-closed PII egress (F16)
  readonly blockInjection?: boolean; // fail-closed prompt-injection (F16)
  readonly overBudget?: boolean; // hard-block above escalation threshold (F17)
}

export class FakeCompliance implements AICompliancePort {
  public blockPii: boolean;
  public blockInjection: boolean;
  public overBudget: boolean;
  public readonly mediated: Array<{ operation: string; allowed: boolean }> = [];

  constructor(options: FakeComplianceOptions = {}) {
    this.blockPii = options.blockPii ?? false;
    this.blockInjection = options.blockInjection ?? false;
    this.overBudget = options.overBudget ?? false;
  }

  private denialReason(): string | undefined {
    if (this.blockPii) return 'PII egress blocked (fail-closed, F16)';
    if (this.blockInjection) return 'prompt-injection blocked (fail-closed, F16)';
    if (this.overBudget) return 'reserved cost ≥ escalation_threshold_usd — hard-block for HITL (F17)';
    return undefined;
  }

  mediate<TReq, TRes>(
    request: ComplianceRequest<TReq>,
  ): Promise<Result<ComplianceDecision<TRes>, DomainError>> {
    const reason = this.denialReason();
    const allowed = reason === undefined;
    this.mediated.push({ operation: request.operation, allowed });
    const decision: ComplianceDecision<TRes> = allowed ? { allowed } : { allowed, reason };
    return Promise.resolve(ok(decision));
  }
}
