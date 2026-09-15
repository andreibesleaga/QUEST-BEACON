// BEACON — the ANTICIPATORY DRAFT's evidence, in the shape it travels to a surface in (WP A8 / finding
// F-301; ADR-033 §6, FEV-9, Art. XII/XVI).
//
// WHY THIS FILE EXISTS. `buildDraftAlert` already computes everything a forecast DRAFT rests on — the lead
// time, the expected crossing instant, the forecast vintage and the classified likelihood with its raw
// source value (`ForecastDraftContext`). It stopped at the composition root: `deriveDraftAlerts` narrows
// each proposal to its bare `Alert`, so the wire projected only {id,state,category,severity,incidentId} and
// a viewer saw THAT an anticipatory DRAFT existed, never WHY or HOW FAR AHEAD.
//
// WHAT IT ADDS, AND ONLY THAT: the two LABELS the predictions law requires beside any served figure — the
// METHOD that produced it and the UNCERTAINTY it carries. It computes NO number: `ForecastEvidence` extends
// the context rather than re-declaring it (the F-24/F-140/F-141 "derive, don't retype" rule), so a field
// added or renamed upstream is a compile-time event here rather than a silent divergence, and no value can
// be rescaled, rounded or invented on the way out.
//
// The labels are string CONSTANTS in the `PRE_POSITIONING_METHOD` house pattern
// (`@/application/pre-positioning/pre-positioning.js`): an honest sentence about what BEACON did and what it
// does not claim, stated once, so no surface can render one of these figures unlabelled.
import type { ForecastDraftContext } from '@/application/threshold-evaluation/threshold-evaluation.js';

/**
 * How the lead time and the expected crossing instant were arrived at (Art. XII). Both are first-order: the
 * hours are the SOURCE's own stated figure, and the instant is those hours added to the evaluation instant.
 */
export const FORECAST_EVIDENCE_METHOD =
  'first-order: the lead time is the number of hours the SOURCE stated, and the expected crossing is that ' +
  'lead time added to the evaluation instant; BEACON models no hazard travel time and rescales nothing';

/**
 * What these figures do NOT claim. Stated in the payload itself rather than left to a surface to remember,
 * because a lead time shown without it reads as a physics-grade arrival time — which it is not.
 */
export const FORECAST_EVIDENCE_UNCERTAINTY =
  'no confidence interval is published with these figures: the lead time is a single source-stated number, ' +
  'and the likelihood is a CLASS read from a fixed threshold table over the exceedance probability the ' +
  'source itself published — not a calibrated chance of occurrence';

/**
 * The forecast context plus its two labels. Every other field is the context's own, unchanged — this type
 * is a widening, never a re-declaration, so `ForecastDraftContext` stays the single source of the shape.
 */
export interface ForecastEvidence extends ForecastDraftContext {
  readonly method: string;
  readonly uncertainty: string;
}

/**
 * Label a forecast context for the wire. `undefined` in ⇒ `undefined` out: a DRAFT that fired on an OBSERVED
 * rule has no forecast evidence, and a labelled absence is the honest answer where a filled-in one would be
 * a fabrication (Art. XVI).
 */
export function toForecastEvidence(
  context: ForecastDraftContext | undefined,
): ForecastEvidence | undefined {
  return context === undefined
    ? undefined
    : { ...context, method: FORECAST_EVIDENCE_METHOD, uncertainty: FORECAST_EVIDENCE_UNCERTAINTY };
}
