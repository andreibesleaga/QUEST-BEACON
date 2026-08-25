// BEACON — SitRep synthesis use-case (E5·T-239…T-246; FR-4, SPEC §2.4/§6.3/§6.5).
// The deterministic→AI→human KEYSTONE. Contract (Art. XI/XII):
//   1. Assemble the cited fact bundle DETERMINISTICALLY, before any model call (T-243). Every number/label
//      comes from the deterministic engine; each fact is grounded to a SOURCE_RECORD (F2/F3).
//   2. Narrate ONLY through the E6 AICompliancePort — never an LLM adapter (T-244/T-246). The model weaves
//      prose around the supplied cited facts; it introduces no new figures.
//   3. Enforce grounding on the model's output; ANY block / error / ungrounded narration ⇒ reject and fall
//      back to a deterministic-only SitRep (T-245, F4/F7). The report is always valid, always cited.
// Pure application layer: imports PORTS + DOMAIN only (no adapters/framework — F9/ADR-001).
import type { Result, SitRep, SitRepField, MakeSitRepInput, AiMode, RankedPriority } from '@/domain/index.js';
import type { Prediction, RankedOutlookItem } from '@/domain/index.js';
import type { IncidentId, SitRepId, SourceId, CitationId, AppUserRole, ModelTier } from '@/domain/index.js';
import { ok, err, isErr, makeSitRep, makeCitation, definedOnly, InvariantViolation } from '@/domain/index.js';
import type { AICompliancePort, ComplianceRequest, NarrativeRequest, Narrative, CitedFact, NewsItem } from '@/ports/intel.js';
import { rankOutlook } from '@/application/outlook/outlook.js';
import { groundNews, type NewsGroundingOptions } from './news-grounding.js';

/** One deterministic, already-grounded fact slot for the SitRep (its claim + the source that grounds it). */
export interface GroundedFact {
  readonly field: string; // SitRep field name, e.g. 'exposure' | 'priorities' | 'crest'
  readonly claim: string; // deterministic sentence — numbers come from the engine, never the LLM (F3)
  readonly sourceId: SourceId; // primary grounding → SOURCE_RECORD (F2)
  readonly citationId: CitationId; // stable id for this grounding
  /** Additional sources that corroborate the SAME claim (multi-source facts, e.g. news). F2 breadth. */
  readonly corroboratingSourceIds?: readonly SourceId[];
  /** Art. XIV: a flagged, uncorroborated/unverified signal — labelled, never boosts a corroboration count. */
  readonly flagged?: boolean;
}

/** The deterministic fact bundle assembled offline, before the model is ever consulted (T-243). */
export interface SitRepFacts {
  readonly incidentId: IncidentId;
  readonly trend?: SitRep['trend']; // from escalation-trend (deterministic); optional
  readonly facts: readonly GroundedFact[];
  readonly priorities?: readonly RankedPriority[]; // engine-ranked attention areas (SPEC §2.4/§5.2); optional
  /**
   * The incident's labeled predictions, in derivation order (ADR-033 §5). Ranked into `SitRep.outlook` by
   * the OUTLOOK ENGINE below — never by the narrator, which never receives them. Absent/empty ⇒ no Outlook.
   * Geometry-less kinds (`ESCALATION`/`IMPACT_OVER_TIME`) belong here exactly like a cone: this is the path
   * that carries ALL predictions, unlike the map wire which by contract carries only plottable ones (F-77).
   */
  readonly predictions?: readonly Prediction[];
  /**
   * Raw region-scoped news/social items (GDELT/ReliefWeb/agency-RSS/vetted-social/MeteoAlarm). Grounded
   * DETERMINISTICALLY into corroboration/misinformation facts BEFORE the LLM (Art. XII/XIV) and merged into
   * `facts`; both the AI narration path AND the AI-off deterministic path see the identical grounded facts.
   */
  readonly news?: readonly NewsItem[];
  /** Options for the news grounding pass (region label, corroboration window). */
  readonly newsOptions?: NewsGroundingOptions;
}

export interface SynthesizeSitRepInput {
  readonly id: SitRepId;
  readonly generatedAt: string; // ISO-8601 UTC
  readonly actorRole: AppUserRole; // requester role — checked at the compliance gate
  readonly facts: SitRepFacts;
  /**
   * The requester's display language (ADR-030; FR-I18N-2). Threaded to the NARRATOR only — the
   * deterministic facts this SitRep is built from stay English and language-marked, because translating an
   * engine-produced claim would place a translator between the data and the figure (Art. XII). Absent ⇒
   * English. The deterministic fallback summary is likewise always English, and honestly so.
   */
  readonly locale?: string;
}

export interface SitRepSynthesisDeps {
  readonly ai: AICompliancePort; // the ONLY model seam — the gateway wraps the LLM upstream (ADR-017)
  readonly aiEnabled?: boolean; // AI_MODE off ⇒ deterministic-only (default true)
  readonly aiMode?: Extract<AiMode, 'cloud' | 'local'>; // label when narration succeeds (default 'cloud')
  readonly modelTier?: ModelTier; // tier for the compliance request (default 'CLOUD')
}

/**
 * Synthesize a cited SitRep. Deterministic facts always win; the LLM only supplies the summary prose, and
 * only when the compliance gateway allows it AND the narration stays grounded in the supplied sources.
 */
export async function synthesizeSitRep(
  input: SynthesizeSitRepInput,
  deps: SitRepSynthesisDeps,
): Promise<Result<SitRep, DomainErrorLike>> {
  // Deterministic fusion (Art. XII): the engine's facts + the news/social facts minted BEFORE any model
  // call. Merged once, so the AI narration path AND the AI-off degrade path see the identical fact set.
  const facts = mergeNewsFacts(input.facts);
  const problem = factsError(facts);
  if (problem !== null) return err(new InvariantViolation(problem));

  const fields = buildFields(facts);
  const prose = deps.aiEnabled === false ? null : await narrate(input, facts, deps);
  return prose !== null
    ? ok(assemble(input, fields, prose, deps.aiMode ?? 'cloud'))
    : ok(assemble(input, fields, deterministicSummary(facts), 'deterministic-only'));
}

/** Fuse the engine facts with the deterministically-grounded news/social facts (Art. XII/XIV), if any. */
function mergeNewsFacts(bundle: SitRepFacts): readonly GroundedFact[] {
  if (bundle.news === undefined || bundle.news.length === 0) return bundle.facts;
  const newsFacts = groundNews(bundle.news, bundle.newsOptions ?? {}).facts;
  return [...bundle.facts, ...newsFacts];
}

// Domain's Result defaults its error to DomainError; alias keeps the public signature readable.
type DomainErrorLike = InstanceType<typeof InvariantViolation>;

/** Every generated field carries its claim + a citation to EACH grounding source (F2 — 100% coverage). */
function buildFields(facts: readonly GroundedFact[]): readonly SitRepField[] {
  return facts.map((f) => ({ field: f.field, claim: f.claim, citations: sourcesOf(f).map((sourceId) => ({ sourceId })) }));
}

/** The full source set that grounds a fact: the primary plus any corroborating sources (multi-source facts). */
function sourcesOf(f: GroundedFact): readonly SourceId[] {
  return f.corroboratingSourceIds && f.corroboratingSourceIds.length > 0
    ? [f.sourceId, ...f.corroboratingSourceIds]
    : [f.sourceId];
}

/** Deterministic-only summary: the engine's own claims, joined. No model involved (F7 fallback). */
function deterministicSummary(facts: readonly GroundedFact[]): string {
  return facts.map((f) => f.claim).join(' ');
}

/** Narrate via the compliance gateway. Returns grounded prose, or null on any block / error / ungrounded output. */
async function narrate(
  input: SynthesizeSitRepInput,
  facts: readonly GroundedFact[],
  deps: SitRepSynthesisDeps,
): Promise<string | null> {
  const request: ComplianceRequest<NarrativeRequest> = {
    actorRole: input.actorRole,
    modelTier: deps.modelTier ?? 'CLOUD',
    operation: 'llm.narrate',
    payload: {
      facts: toCitedFacts(input, facts),
      style: 'sitrep',
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
    },
  };
  const res = await deps.ai.mediate<NarrativeRequest, Narrative>(request);
  if (isErr(res)) return null; // gateway/upstream failure ⇒ degrade
  const decision = res.value;
  if (!decision.allowed || decision.result === undefined) return null; // blocked by policy/firewall/breaker
  const allowed = new Set(facts.flatMap((f) => sourcesOf(f).map((s) => String(s))));
  return isGrounded(decision.result, allowed) ? decision.result.text : null; // T-245 enforcement
}

/** Grounded ⇔ non-empty prose AND every cited source was one we supplied (no invented references, F4). */
function isGrounded(narrative: Narrative, allowedSources: ReadonlySet<string>): boolean {
  if (narrative.text.trim() === '' || narrative.citations.length === 0) return false;
  return narrative.citations.every((c) => allowedSources.has(String(c.sourceId)));
}

/** Promote deterministic facts to the CitedFact shape the narrator consumes (its ONLY permitted inputs). */
/**
 * Strip every FIGURE from a claim before a model is allowed to see it (F-418).
 *
 * Art. XII says the LLM never emits a figure. The F-340 guard enforces that on the OUTPUT — correctly, and
 * strictly: no digit in any script, no number-word, no ranking. But the model was still being handed claims
 * full of figures and asked not to repeat them, which is a request no competent narrator can honour: given
 * *"2 electrical substations intersect the footprint"*, three consecutive live Claude Haiku 4.5 calls each
 * wrote *"**Two** electrical substations…"* and *"the **highest-priority** asset"* — obedient to the letter
 * of "no numerals", and rejected by the guard every time. **The result was that cloud AI narration could
 * never succeed: every SitRep silently degraded to deterministic-only, so the flagship AI feature was dead
 * on arrival while looking like a transient fallback.**
 *
 * The fix is to make the invariant structural instead of aspirational: **the engine keeps the numbers and
 * does not show them to the model at all.** A narrator that never sees "2" cannot restate it, round it,
 * swap its unit, or spell it out — the whole F-340 bypass family becomes unreachable by construction rather
 * than caught after the fact. The guard stays exactly as strict; it is now a backstop rather than the only
 * line of defence.
 *
 * NOTHING the operator sees changes. `buildFields` still carries the FULL deterministic claim, and the UI
 * renders every figure from that record with its citation. This trims only the model's input.
 */
export function qualitativeClaim(claim: string): string {
  return (
    claim
      // Numerals in ANY script (\p{N} covers Arabic-Indic etc. — `\d` is ASCII-only), with any attached
      // unit/symbol, plus a leading article that would be left dangling ("of 2 assessed" → "assessed").
      .replace(/\b(?:of|at|by|to)?\s*[-+]?\p{N}[\p{N},.:]*\s*(?:%|°[CF]?|[a-zA-Z]{1,4}\b)?/gu, ' ')
      // Spelled-out numbers — the bypass class F-340 was opened for.
      .replace(
        /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|score|hundreds?|thousands?|millions?|billions?)\b/gi,
        ' ',
      )
      // Rankings/superlatives — a ranking is a figure with the number filed off.
      .replace(/\b(?:highest|lowest|worst|best|largest|smallest|greatest|most|least|top|first|second|third)[- ]?\w*/gi, ' ')
      .replace(/\(\s*[),]?\s*\)/g, '') // empty parens left behind by the strips
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .trim()
  );
}

function toCitedFacts(input: SynthesizeSitRepInput, facts: readonly GroundedFact[]): readonly CitedFact[] {
  return facts.map((f) => ({
    // F-418: the MODEL sees the figure-free claim. `buildFields` (the operator-facing record) keeps the
    // full one — the split IS the deterministic→AI handshake, made structural.
    claim: qualitativeClaim(f.claim),
    citation: makeCitation({
      id: f.citationId,
      sitrepId: input.id,
      sourceId: f.sourceId,
      field: f.field,
      claim: f.claim,
    }),
  }));
}

function assemble(
  input: SynthesizeSitRepInput,
  fields: readonly SitRepField[],
  summary: string,
  aiMode: AiMode,
): SitRep {
  return makeSitRep(
    definedOnly({
      id: input.id,
      incidentId: input.facts.incidentId,
      generatedAt: input.generatedAt,
      aiMode,
      fields,
      priorities: input.facts.priorities,
      outlook: outlookOf(input),
      summary,
      trend: input.facts.trend,
    }) as MakeSitRepInput,
  );
}

/**
 * Build the ranked Outlook (ADR-033 §5, FEV-8). The ENGINE sorts — `rankOutlook` is called HERE, before the
 * SitRep is assembled, and the result travels STRUCTURALLY to the wire. The narrator's payload is built by
 * `toCitedFacts` from `facts` alone, so no outlook row is ever handed to a model: the LLM may narrate the
 * Outlook (from the cited facts an engine wrote) but cannot reorder or invent one, exactly as `priorities`
 * has always worked (`sitrep.ts` `RankedPriority`, Art. XII/F3).
 *
 * `hazardArrival` per row is computed from the SitRep's own `generatedAt` — an injected instant, never a
 * clock read (the same rule `forecast-likelihood.ts` follows). Assembly runs in BOTH rungs (AI narration and
 * the deterministic-only fallback), so a degraded SitRep carries the identical Outlook (Art. XVI).
 */
function outlookOf(input: SynthesizeSitRepInput): readonly RankedOutlookItem[] {
  const predictions = input.facts.predictions;
  if (predictions === undefined || predictions.length === 0) return [];
  return rankOutlook(predictions, { nowMs: Date.parse(input.generatedAt) });
}

/** Guard the fact bundle so makeCitation/makeSitRep never throw — a bad bundle is a typed error, not a crash. */
function factsError(facts: readonly GroundedFact[]): string | null {
  if (facts.length === 0) return 'SitRep synthesis requires at least one grounded fact';
  for (const f of facts) {
    if (!f.field.trim() || !f.claim.trim() || !f.sourceId) {
      return 'Each grounded fact needs a field, a claim, and a sourceId';
    }
  }
  return null;
}
