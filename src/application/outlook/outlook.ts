// BEACON — Outlook ranking use-case (C2.3; ADR-033 §5, FEV-8/FR-PRED-5, Art. XII/F3).
//
// The ENGINE decides the order of the Outlook. `compareOutlookItems` is a pure, clock-free total order —
// same discipline as `rankPriorities`' comparator (`priority-ranking.ts:82`) and `compareFloodCategory`
// (`gauge.ts:18-20`) — and `rankOutlook` is the only place a `SitRep.outlook` is ever built. The LLM never
// sees the outlook (it is not part of the narrator payload, `sitrep-synthesis.ts` `toCitedFacts`), so it can
// neither reorder nor invent a row: the boundary is structural, not a rule someone has to remember.
//
// The order (ADR-033 §5, from FEV-8 "ordered by likelihood class then soonest ETA"):
//   1. likelihood class DESC   (VERY_LIKELY before LIKELY before POSSIBLE; absent ⇒ POSSIBLE)
//   2. soonest ETA ASC         (a stated lead time always precedes an absent one)
//   3. severity DESC           (tiebreak only; an absent severity never outranks a stated one)
// Items equal on all three keep their INPUT order — `Array.prototype.sort` is required to be stable
// (ES2019+), so the derivation order the engine handed us survives, exactly as `tieBreakKey` guarantees for
// the priority ranking.
import type { Prediction, LikelihoodClass } from '@/domain/prediction.js';
import type { AlertSeverity } from '@/domain/alert.js';
import type { RankedOutlookItem } from '@/domain/sitrep.js';
import { LIKELIHOOD_CLASSES, likelihoodClassRank } from '@/domain/prediction.js';
import { ALERT_SEVERITIES } from '@/domain/alert.js';
import { definedOnly } from '@/domain/shared/guard.js';
import { hazardArrival } from '@/application/forecast-likelihood/forecast-likelihood.js';

/**
 * The comparator's view of an Outlook row: the three ranking keys and nothing else, so any caller with a
 * `Prediction` (or a future entity carrying the same signals) can be ordered by the identical rule.
 *
 * `severity` is OPTIONAL because no `Prediction` carries one (`src/domain/prediction.ts` — the entity has
 * `kind`/`method`/`inputs`/`uncertainty`/`likelihoodClass`/`etaHours`, never a severity), and manufacturing a
 * severity per prediction to satisfy a tiebreak would be inventing the very kind of figure Art. XII forbids.
 * ADR-033 §5's sketch typed it as required; see the dated §5 addendum. An absent severity ranks BELOW
 * `MINOR`, so a row whose severity nobody stated can never outrank one that a source did state.
 */
export interface OutlookItem {
  readonly likelihoodClass?: LikelihoodClass;
  readonly etaHours?: number;
  readonly severity?: AlertSeverity;
}

/** The class an unclassified prediction ranks as: the LOWEST class, never a promoted guess (ADR-033 §5). */
const DEFAULT_LIKELIHOOD_CLASS: LikelihoodClass = LIKELIHOOD_CLASSES[0];

/**
 * Severity rank by array index (the `FLOOD_CATEGORIES`/`LIKELIHOOD_CLASSES` idiom: the index IS the rank).
 * `undefined` ⇒ `-1`, i.e. strictly below `MINOR`.
 */
function severityRank(severity: AlertSeverity | undefined): number {
  return severity === undefined ? -1 : ALERT_SEVERITIES.indexOf(severity);
}

/**
 * The ETA sort key. Absent ⇒ `+Infinity` (last), per ADR-033 §5.
 *
 * A NON-FINITE number is also mapped to `+Infinity` rather than passed through: `NaN` would make the
 * comparator intransitive (every comparison involving it returns `NaN`), which silently corrupts the whole
 * ranking instead of misplacing one row. `makePrediction` already rejects a non-finite `etaHours`, so this
 * guard is defence-in-depth for the structurally-typed `OutlookItem` — a total order must be total for
 * EVERY input of its declared type, not only for the ones the domain factory would have accepted.
 */
function etaKey(etaHours: number | undefined): number {
  return etaHours === undefined || !Number.isFinite(etaHours) ? Number.POSITIVE_INFINITY : etaHours;
}

/**
 * Total order over Outlook rows (ADR-033 §5). Pure: no clock, no config, no I/O. Returns 0 only for rows
 * that are equal on all three keys — `sort` is stable, so those keep their input (derivation) order.
 */
export function compareOutlookItems(a: OutlookItem, b: OutlookItem): number {
  const classDiff =
    likelihoodClassRank(b.likelihoodClass ?? DEFAULT_LIKELIHOOD_CLASS) -
    likelihoodClassRank(a.likelihoodClass ?? DEFAULT_LIKELIHOOD_CLASS);
  if (classDiff !== 0) return classDiff;
  const etaA = etaKey(a.etaHours);
  const etaB = etaKey(b.etaHours);
  // Compared, not subtracted: `etaA - etaB` is ±Infinity as soon as exactly one lead time is absent
  // (ADR-033 §5's sketch), and a comparator that can return a non-finite number is one refactor away from
  // returning NaN. The ORDER is identical; only its arithmetic is now closed over the integers.
  if (etaA !== etaB) return etaA < etaB ? -1 : 1;
  return severityRank(b.severity) - severityRank(a.severity); // tiebreak only
}

/** Options for building the Outlook. `nowMs` is INJECTED — this module never reads a wall clock. */
export interface RankOutlookOptions {
  /**
   * The SitRep's own generation instant as epoch ms, used ONLY to compute each row's `hazardArrival`
   * (= now + `etaHours`, FU-12). A non-finite value (an unparseable timestamp) yields rows with no
   * `hazardArrival` rather than an invalid date — the lead time itself is still shown.
   */
  readonly nowMs?: number;
  /**
   * Severity per prediction id, when a CALLER holds a source-stated severity for it (e.g. the DRAFT alert an
   * incident already carries). Never derived here: an absent entry means "nobody stated one", which the
   * comparator ranks below `MINOR` (ADR-033 §5 tiebreak).
   */
  readonly severityByPredictionId?: ReadonlyMap<string, AlertSeverity>;
}

/** The prediction's labelled projection into an Outlook row (rank is assigned after sorting). */
function toItem(
  prediction: Prediction,
  rank: number,
  options: RankOutlookOptions,
): RankedOutlookItem {
  const eta = prediction.etaHours;
  const nowMs = options.nowMs;
  const arrival =
    eta !== undefined && nowMs !== undefined && Number.isFinite(nowMs) && Number.isFinite(eta)
      ? hazardArrival(nowMs, eta)
      : undefined;
  return definedOnly({
    rank,
    predictionId: String(prediction.id),
    kind: prediction.kind,
    method: prediction.method,
    uncertainty: prediction.uncertainty,
    likelihoodClass: prediction.likelihoodClass,
    etaHours: eta,
    hazardArrival: arrival,
  }) as RankedOutlookItem;
}

/**
 * Rank every prediction into the SitRep's Outlook (ADR-033 §5). Deterministic: same predictions in the same
 * derivation order ⇒ byte-identical output, including the 1-based `rank`. `[]` in ⇒ `[]` out — an incident
 * with no prediction has no Outlook, which is an honest answer rather than an empty-looking forecast.
 *
 * Geometry is irrelevant here, which is the whole point of sourcing the Outlook from the SitRep path: the
 * `ESCALATION`/`IMPACT_OVER_TIME` kinds carry `geom: undefined` BY DESIGN (ADR-033 §4.1/§4.2) and are
 * therefore absent from the map wire's `predictions[]` (finding F-77) — they rank here exactly like a cone.
 */
export function rankOutlook(
  predictions: readonly Prediction[],
  options: RankOutlookOptions = {},
): readonly RankedOutlookItem[] {
  // Decorate → sort → undecorate: each row's three sort keys are computed ONCE, so the comparator stays a
  // pure function of two plain records and no severity lookup happens inside the sort loop.
  return predictions
    .map((prediction) => ({ prediction, keys: sortKeysOf(prediction, options) }))
    .sort((a, b) => compareOutlookItems(a.keys, b.keys))
    .map(({ prediction }, i) => toItem(prediction, i + 1, options));
}

/** The three ranking keys of one prediction (severity only when a caller actually stated one). */
function sortKeysOf(prediction: Prediction, options: RankOutlookOptions): OutlookItem {
  return definedOnly({
    likelihoodClass: prediction.likelihoodClass,
    etaHours: prediction.etaHours,
    severity: options.severityByPredictionId?.get(String(prediction.id)),
  }) as OutlookItem;
}
