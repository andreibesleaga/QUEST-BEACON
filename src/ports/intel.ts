// BEACON — Intel ports (E1·T-087; ADR-001 P6/P11/Vision/ADR-017). News, LLM, vision, AI compliance gateway.
// Interface signatures only. GUARDRAIL (Art. XII): the LLM NARRATES cited facts — it never produces a
// number/ranking/distance/confidence. Those come from deterministic ports (SpatialPort/SQL) only.
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { ModelTier } from '@/domain/audit-event.js';
import type { Sourced } from './infra.js';
// Cross-cluster domain entities (E1 W1, written in parallel).
import type { Citation } from '@/domain/citation.js'; // cross-cluster entity — E1·T-065 (citation.ts)
import type { SitRep } from '@/domain/sitrep.js';

/** Deterministic source-authority tier for a news/intel item (adapter-assigned, never LLM-produced). */
export type SourceAuthority = 'OFFICIAL' | 'MEDIA' | 'SOCIAL';

/** P6 — news/intel items (GDELT/ReliefWeb/agency-RSS/vetted-social). Advisory context, always provenance-anchored. */
export interface NewsItem {
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string; // ISO-8601
  readonly summary?: string;
  /**
   * Deterministic credibility score in [0,1] (authority tier + corroboration blend, computed by the
   * adapter/use-case — NEVER the LLM, Art. XII). Low-credibility items are flagged, not merged (Art. XIV).
   */
  readonly credibility?: number;
  /** Which trust tier produced the item — official agency, verified media outlet, or (vetted) social. */
  readonly sourceAuthority?: SourceAuthority;
}

export interface NewsIntelPort {
  fetchNews(query: string): Promise<Result<Sourced<readonly NewsItem[]>, DomainError>>;
}

/**
 * A pre-computed, already-cited fact handed to the LLM. The deterministic layer produces the claim +
 * its citation; the LLM only weaves prose around it. The port deliberately has NO tool/number method.
 */
export interface CitedFact {
  readonly claim: string;
  readonly citation: Citation;
}

export interface NarrativeRequest {
  readonly facts: readonly CitedFact[]; // the ONLY inputs — the model may not introduce new figures
  readonly style?: string; // e.g. 'sitrep' | 'public-advisory'
  /**
   * BCP-47 tag for the language the PROSE should be written in (ADR-030; FR-I18N-2). Optional: absent ⇒
   * English. This is the one place the model is told about language, and it changes nothing else — the
   * `facts` it may draw on are unchanged, and Art. XII still forbids it from producing any figure, in any
   * language. The grounding check (`isGrounded`) compares citation SOURCE IDS, not words, so it stays
   * valid whatever language the narration comes back in.
   */
  readonly locale?: string;
}

/** Narrative output: prose grounded ONLY in the supplied cited facts (each field traceable to a Citation). */
export interface Narrative {
  readonly text: string;
  readonly citations: readonly Citation[];
}

/**
 * P11 — LLM narrator (AI_MODE cloud→local→deterministic ladder). NARRATE-ONLY by design:
 * the single method returns cited prose; there is intentionally no method that emits a figure or calls a tool.
 */
export interface LLMPort {
  narrate(request: NarrativeRequest): Promise<Result<Narrative, DomainError>>;
}

/** Vision analysis (FEATURE_VISION). Advisory, confidence-scored, cited — never auto-alerts (Art. XII). */
export interface VisionRequest {
  readonly imageRef: string; // reference/handle only — PII-screened + consented upstream
  readonly task: 'burn-area' | 'flood-extent' | 'damage-severity' | 'scene';
}

export interface VisionFinding {
  readonly label: string;
  readonly confidence: number; // 0..1 (deterministically thresholded downstream)
  readonly notes?: string;
}

export interface VisionPort {
  analyze(request: VisionRequest): Promise<Result<VisionFinding, DomainError>>;
}

/**
 * Consent + PII-screen gate context for a `vision.analyze` call (Art. XIV). Required here (a caller must
 * state its posture explicitly) — structurally compatible with the adapter-side `VisionGateContext`
 * (`adapters/ai/vision/vision-adapter.ts`), which re-checks both flags before any image is processed.
 */
export interface VisionGateInput {
  readonly imageConsented: boolean;
  readonly piiScreened: boolean;
}

/**
 * The payload every `vision.analyze` `ComplianceRequest` carries. `AICompliancePort.mediate`'s payload is
 * a generic/opaque `TReq` (no dedicated gateway field for the consent context), so the request and its
 * gate context travel together — the compliance gateway's PII/firewall stages screen this whole object.
 */
export interface VisionMediatePayload {
  readonly request: VisionRequest;
  readonly context: VisionGateInput;
}

/**
 * AICompliancePort (ADR-017) — the MANDATORY chokepoint for every model call: role → breaker →
 * rate-limit → firewall → policy → PII → cost → audit → upstream. Fail-closed on any safety stop.
 * `mediate` is the single gateway signature; it wraps the real upstream call (LLM/Vision) generically.
 */
export interface ComplianceRequest<TReq> {
  readonly actorRole: AppUserRole; // JWT/role checked at the gate
  readonly modelTier: ModelTier;
  readonly operation: string; // e.g. 'llm.narrate' | 'vision.analyze'
  readonly payload: TReq;
}

export interface ComplianceDecision<TRes> {
  readonly allowed: boolean;
  readonly result?: TRes; // present only when allowed
  readonly reason?: string; // policy/PII/breaker reason when blocked
}

export interface AICompliancePort {
  mediate<TReq, TRes>(
    request: ComplianceRequest<TReq>,
  ): Promise<Result<ComplianceDecision<TRes>, DomainError>>;
}

/**
 * Durable SitRep history (ADR-039). Records what BEACON reported, and on which sources, for AUDIT — never
 * for display: re-rendering a stored report as the current picture would show an operator a footprint the
 * sources have since moved past.
 *
 * `null` = the report was SKIPPED because its incident has no stored row; that is a reportable outcome, not
 * an error. Composed only under `FEATURE_STORE=postgres`.
 */
export interface SitRepHistoryPort {
  record(report: SitRep): Promise<Result<{ readonly rowId: string } | null, DomainError>>;
}
