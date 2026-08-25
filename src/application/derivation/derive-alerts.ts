// BEACON — DRAFT-alert derivation use-case (E5; FR-11, ADR-014, Art. XIII). The deterministic seam that
// turns seeded threshold RULES + the current gauge/hazard-buffer READINGS into the COMPUTED DRAFT alerts the
// HITL approve gate (POST /alerts/:id/approve) loads. A rule that FIRES (edge + dwell + cooldown, via the
// threshold-evaluation engine) proposes a DRAFT alert; a reading below its threshold proposes NONE — the one
// hand-seeded draft is now a computed output. Every proposal is cap_status=DRAFT: a fire can never produce an
// ACTUAL/approved alert (that requires a human — Art. XIII). Pure application layer: imports the engine +
// DOMAIN only (no adapters/framework — F9/ADR-001).
import type { Alert, AlertCategory, AlertSeverity } from '@/domain/alert.js';
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import type { AlertId, IncidentId, SourceId } from '@/domain/value-objects/ids.js';
import {
  evaluateRule,
  buildDraftAlert,
  type DraftAlertProposal,
  type SignalReading,
  type RuleRuntimeState,
} from '@/application/threshold-evaluation/threshold-evaluation.js';
import type { ForecastTriggerConfig } from '@/application/threshold-evaluation/forecast-trigger-config.js';

/** One seeded rule + its current reading + the identity of the DRAFT alert to propose when it fires. */
export interface ThresholdAlertSpec {
  readonly rule: ThresholdRule;
  /**
   * The current raw signal: observed gauge category / hazard-within-buffer, or — for a
   * `FORECAST_GAUGE_CATEGORY` rule — the forecast category with its lead time, source issue instant and
   * classified likelihood (C2.4, ADR-033 §6).
   */
  readonly reading: SignalReading;
  readonly incidentId: IncidentId;
  readonly alertId: AlertId; // stable id for the proposed DRAFT (EV6 rule→alert traceability)
  readonly category: AlertCategory;
  readonly severity: AlertSeverity;
  readonly sourceId: SourceId; // provenance → the triggering SOURCE_RECORD (F8/Art. XI)
  readonly previous?: RuleRuntimeState; // persisted per-rule runtime state (edge/dwell/cooldown) across cycles
}

export interface DeriveDraftAlertsInput {
  readonly specs: readonly ThresholdAlertSpec[];
  readonly now: number; // epoch ms — injected deterministic evaluation instant
  /** Forecast-crossing gate table (lead-time window, vintage window, likelihood floor). Defaults to shipped. */
  readonly forecastConfig?: ForecastTriggerConfig;
}

/**
 * Compute the DRAFT alerts the current readings produce. Each spec is evaluated by the threshold engine;
 * only a FIRING rule yields a DRAFT alert (a below-threshold reading yields none). Change the reading —
 * lift it across the threshold — and a DRAFT alert appears; every emitted alert is cap_status=DRAFT
 * (never ACTUAL — Art. XIII). Deterministic over its injected `now`.
 */
export function deriveDraftAlerts(input: DeriveDraftAlertsInput): readonly Alert[] {
  return deriveDraftAlertProposals(input).map((p) => p.alert);
}

/**
 * The same computation, keeping each proposal WHOLE (C2.4). `deriveDraftAlerts` above narrows it to bare
 * `Alert`s for the callers that only persist the entity; a caller that must show WHY the DRAFT exists —
 * notably a `FORECAST_GAUGE_CATEGORY` fire, whose `forecast` context carries the lead time, the expected
 * crossing instant, the forecast vintage and the likelihood evidence (FEV-9) — reads the proposals instead.
 * Same DRAFT-only guarantee: `DraftAlertProposal.alert` is typed `DraftAlert`, so no proposal from here can
 * be handed to the alert sink (Art. XIII, enforced by `tsc`).
 */
export function deriveDraftAlertProposals(input: DeriveDraftAlertsInput): readonly DraftAlertProposal[] {
  const proposals: DraftAlertProposal[] = [];
  for (const spec of input.specs) {
    const outcome = evaluateRule({
      rule: spec.rule,
      reading: spec.reading,
      now: input.now,
      ...(spec.previous !== undefined ? { previous: spec.previous } : {}),
      ...(input.forecastConfig !== undefined ? { forecastConfig: input.forecastConfig } : {}),
    });
    if (!outcome.fired) continue;
    proposals.push(
      buildDraftAlert({
        rule: spec.rule,
        incidentId: spec.incidentId,
        alertId: spec.alertId,
        category: spec.category,
        severity: spec.severity,
        sourceId: spec.sourceId,
        reading: spec.reading,
        now: input.now,
      }),
    );
  }
  return proposals;
}
