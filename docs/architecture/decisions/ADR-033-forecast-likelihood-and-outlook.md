# ADR-033 — Forecast likelihood classes, plural predictions, and the ranked Outlook

- **Status:** Accepted (2026-07-26)
- **Deciders:** Entrant + prod-architect (master-plan wave MW-B / MW-C)
- **Relates to:** ADR-001 (hexagonal ports-and-adapters — GloFAS stays behind its ACL), ADR-010 (interop —
  DRAFT alerts are still CAP-shaped), ADR-011 (multi-region registry — GloFAS is the global flood-forecast
  adapter every shipped zone can use), ADR-014 (threshold-rule engine — this ADR extends it to forecast
  crossings, does not replace it), ADR-015 (deterministic confidence-scoring — the sibling precedent for
  "the LLM never emits the number itself"), CONSTITUTION Art. XII (deterministic source of truth), Art. XIII
  (human-in-the-loop before any public/operational action), Art. XVI (total redundancy / no dead-end layer)
- **FR refs:** FR-PRED-1…6 (`docs/requirements/EARS_FINAL_VERSION.md:136-156`)

## Context

`CURRENT-MASTER-PLAN.md:85-90` (§2B) and `CURRENT-PLAN-2-GLOBAL-PREDICTION.md:69-78` (P2) both lock this
program: stop dropping GloFAS exceedance probability/tendency, add deterministic likelihood classes, extend
`Prediction` with `likelihoodClass?`/`etaHours?`, ship the two "promised-never-built" `ESCALATION`/
`IMPACT_OVER_TIME` kinds, make `predictions[]` plural end-to-end, add a ranked Outlook, and extend the
threshold engine to forecast crossings. This ADR records the verified current-state defects and the
deterministic design that fixes them.

## 1. The verified defect — GloFAS probability + tendency are parsed then discarded

`src/adapters/sources/glofas/glofas-acl.ts:32-46` declares the raw shape and explicitly documents
(`glofas-acl.ts:16-21`) that the source provides "exceedance probability, tendency (increasing/decreasing/
stagnant) and time to peak":

```ts
// src/adapters/sources/glofas/glofas-acl.ts:33-46
interface GlofasProps {
  ...
  readonly probability?: number | null;
  readonly tendency?: string | null;
  readonly peakForecast?: number | string | null;
  readonly timeToPeak?: string | null;
}
```

But the mapper that builds the canonical `Gauge` never reads `props.probability` or `props.tendency`:

```ts
// src/adapters/sources/glofas/glofas-acl.ts:77-92
export const glofasMapper: AntiCorruptionMapper<GlofasFeature, Gauge> = {
  toCanonical(raw: GlofasFeature, ctx: MapContext): Gauge {
    const [lon, lat] = requirePoint(raw.geometry);
    const props: GlofasProps = raw.properties ?? {};
    return makeGauge(
      definedOnly({
        id: pointId(props, lon, lat),
        geom: { type: 'Point', coordinates: [lon, lat] },
        floodCategory: categoryFromReturnPeriod(props.returnPeriod),
        sourceId: asId<SourceId>(ctx.sourceRecordId),
        crestForecast: num(props.peakForecast),
        crestTime: str(props.timeToPeak),
      }) as Parameters<typeof makeGauge>[0],
    );
  },
};
```

**Exact drop site: `src/adapters/sources/glofas/glofas-acl.ts:82-90`** — the `definedOnly({...})` object
literal has no `probability`/`tendency` key. Confirmed downstream: `src/domain/gauge.ts:22-30` (`Gauge`
interface) has no `probability`/`tendency` field to receive them even if the mapper did copy them — the
domain entity itself has never carried these fields. This is FR-PRED-1's motivating finding (FU-10,
`EARS_FINAL_VERSION.md:136,143-144`).

## 2. Decision — likelihood as an ordered CLASS, never an invented number

### 2.1 The three classes and their ordering

```ts
export const LIKELIHOOD_CLASSES = ['POSSIBLE', 'LIKELY', 'VERY_LIKELY'] as const;
export type LikelihoodClass = (typeof LIKELIHOOD_CLASSES)[number];
```

Ordered exactly as FU-11 states (`EARS_FINAL_VERSION.md:145-147`): `POSSIBLE < LIKELY < VERY_LIKELY`. Same
pattern as the existing ordered `FLOOD_CATEGORIES` (`src/domain/gauge.ts:9-15`, where "array index IS the
severity rank" and `compareFloodCategory` is `indexOf(a) - indexOf(b)`) — `likelihoodClassRank`/
`compareLikelihoodClass` follow the identical shape for consistency and reuse of the same review pattern.

### 2.2 Deterministic threshold table — source signal → class

Every source signal type gets its own documented, config-injectable threshold table (mirrors ADR-014's
config-not-code discipline and ADR-015's "weights in config" precedent):

| Source signal | Signal type | POSSIBLE | LIKELY | VERY_LIKELY |
|---|---|---|---|---|
| GloFAS reporting-point `probability` (exceedance probability, %) | continuous [0,1] | `probability < 0.30` → not classified (no `Prediction.likelihoodClass`, geometry still carried) | `0.30 ≤ probability < 0.60` | `probability ≥ 0.60` |
| GloFAS 51-member ensemble fraction over threshold (D1 anticipatory-action evaluator input, when available for the same gauge) | discrete fraction `k/51` | `< 0.30` | `0.30 – 0.60` | `> 0.60` |
| Categorical source levels (e.g. an aggregator's own `low`/`medium`/`high` advisory tier, MeteoAlarm-class) | ordinal enum | source `low` → `POSSIBLE` | source `medium` → `LIKELY` | source `high` → `VERY_LIKELY` |

Thresholds are a named config object (`DEFAULT_LIKELIHOOD_CONFIG`, same pattern as
`DEFAULT_FIRE_CONE_CONFIG`/`DEFAULT_FLOOD_IMPACT_CONFIG` in
`src/application/shared/config.ts` — referenced from `prediction-projection.ts:16-19,124-129`), never
hardcoded in the classifier function, and injectable per-region exactly like `PriorityWeights`
(`src/application/priority-ranking/priority-ranking.ts:33-41`). **The class is always displayed together
with the raw source value and the method** (FU-11, `EARS_FINAL_VERSION.md:146-147`) — the classifier returns
`{ class, rawValue, sourceField, method }`, never a bare enum, so the UI/SitRep can never show a class
without its evidence.

### 2.3 Constitution Art. XII enforcement — extending the existing contract test

`src/adapters/ai/llm/output-validator.ts:1-25` is the existing enforcement mechanism: `isValidNarration()`
(`:21-24`) rejects any LLM narration whose numeric tokens aren't already present in the supplied
`CitedFact[]` (`usesOnlyCitedNumbers`, `:12-18`, regex-matches `\d[\d,]*(?:\.\d+)?` tokens). This already
blocks the LLM from inventing an ETA-in-hours or a raw probability number, **as long as the deterministically
computed `likelihoodClass`/`etaHours` are supplied to the LLM as cited facts before narration** — the same
"deterministic→AI→human" pipeline this ADR's classifier feeds.

**Finding — a real gap the extension must close:** `usesOnlyCitedNumbers` only regex-matches *numeric*
tokens. `LIKELY`/`VERY_LIKELY`/`POSSIBLE` are word tokens, not numbers — an LLM could still narrate an
invented likelihood-class word (e.g. narrate "VERY_LIKELY" for a gauge whose cited fact says "LIKELY")
without tripping the existing check. This ADR requires a companion validator,
`usesOnlyCitedLikelihoodClasses(text, facts)`, added alongside `usesOnlyCitedNumbers` in the same file, that
extracts any `LIKELIHOOD_CLASSES` token appearing in the narration text and rejects it if it is not present
verbatim in the cited facts' claims — same reject-to-deterministic-only-rung behavior as today
(`output-validator.ts:1-4` header comment: "An ungrounded, uncited, or number-hallucinating narration is
REJECTED"). `isValidNarration` gains this as a third conjunct. This is a **new**, explicit, unit-tested
contract test — not an assumption that the existing one already covers it.

## 3. Domain fields

```ts
// src/domain/prediction.ts — additive fields on Prediction / MakePredictionInput
readonly likelihoodClass?: LikelihoodClass;   // from §2, always paired with method+rawValue in `inputs`
readonly etaHours?: number;                    // where the source supports a lead-time (>= 0)
```

Both optional, following the file's existing optionality discipline
(`src/domain/prediction.ts:61-71`, `definedOnly({...}) as Prediction` — undefined fields are dropped, not
serialized as `null`). `hazardArrival` (a computed ISO-8601 instant = now + `etaHours`) is **not** stored on
`Prediction` itself — it is derived at the application layer (mirrors `horizon` already being an
application-computed field passed into `makePrediction`, e.g. `prediction-projection.ts:61`,
`new Date(input.nowMs + input.horizonMs).toISOString()`), keeping the domain entity a pure value object with
no wall-clock dependency inside `makePrediction`.

### 3.1 The singular-prediction assumption — where it lives today, `file:line`

The "one prediction per incident/map" assumption runs through **four** layers in lockstep, all singular
optional fields, not arrays:

| Layer | File:line | Current shape |
|---|---|---|
| Application read-model source | `src/application/map-projection/map-projection.ts:196` | `readonly prediction?: Prediction;` on `MapSource` |
| Application projection output | `src/application/map-projection/map-projection.ts:137` | `readonly prediction?: ProjectedPrediction;` on `MapProjection` |
| Application projection fn | `src/application/map-projection/map-projection.ts:289-298,377,387` | `projectPrediction(p: Prediction)` takes one `Prediction`; `projectMap` reads `source.prediction` (singular) and spreads at most one `prediction` key |
| Frontend wire type | `app/_lib/types.ts:304-310,370` | `interface ProjectedPredictionData {...}` (singular shape) and `readonly prediction?: ProjectedPredictionData;` on `MapProjectionData` |
| Frontend mapper | `app/_lib/map-data.ts:98-103` | `function prediction(p: MapProjectionData): PredictionCone \| undefined` — takes the one `p.prediction`, returns at most one `PredictionCone` |
| Frontend layer builder | `app/_components/map/build-layers.ts:323-335` | `buildPredictionLayers(cone: PredictionCone \| undefined)` — one cone in, one descriptor out |

**What changes:** every one of the above becomes plural — `readonly predictions: readonly Prediction[]`
(default `[]`, not optional-singular) on `MapSource`/`MapProjection`, `readonly predictions:
readonly ProjectedPrediction[]` on the wire type, `projectPrediction` maps over the array
(`source.predictions.map(projectPrediction)` replacing the current single-value ternary at
`map-projection.ts:377,387`), the frontend `prediction()` mapper becomes `predictions()` returning
`readonly PredictionCone[]`, and `buildPredictionLayers` accepts `readonly PredictionCone[]` and emits one
descriptor per prediction with a `geom` (predictions without geometry, e.g. a bare `ESCALATION` trend value,
contribute no map descriptor but still feed the Outlook, §5). `app/_lib/map-data.ts:135-149`
`presentLayers()`'s `prediction: md.prediction !== undefined` becomes `prediction: (md.predictions?.length
?? 0) > 0`.

This is an additive, backward-compatible wire change in spirit (`MapProjectionData`'s existing comment at
`app/_lib/types.ts:360`, "each slice may be empty; prediction/route optional", already treats the field as
elective) but a **breaking rename** at the type level (`prediction` → `predictions`, singular → array) — every
one of the six sites above must move together or the build fails at `tsc --noEmit` (Gate 2), same
lockstep-checklist discipline as ADR-032 §2.

## 4. The two never-built kinds — `ESCALATION` and `IMPACT_OVER_TIME`

**Verified finding:** both kinds are declared in the domain enum (`src/domain/prediction.ts:8`,
`PREDICTION_KINDS`) and the schema CHECK constraint
(`src/adapters/persistence/schema/core-tables.ts:227-231`, `chk_prediction_kind`) but **no function anywhere
in `src/` constructs a `Prediction` with `kind: 'ESCALATION'` or `kind: 'IMPACT_OVER_TIME'`** — confirmed by
`grep -rn "ESCALATION\|IMPACT_OVER_TIME" src` matching only the two enum declarations, never a call site.
FEV-7 (`EARS_FINAL_VERSION.md:150-151`) requires both be produced, not merely declared.

**Finding — the ESCALATION building block already exists, just not as a `Prediction`.**
`src/application/escalation-trend/escalation-trend.ts:95-106` (`classifyTrend`) already computes exactly the
signal this kind needs: an ordinary-least-squares slope over `TrendSample[]` with a dead-band, returning
`SitRepTrend` (`'ESCALATING'|'STEADY'|'DEESCALATING'`, `src/domain/sitrep.ts:8-9`). It is currently wired
only into `SitRep.trend` (a single scalar label on the report), never into a `Prediction` record with its own
`method`/`inputs`/`uncertainty`/`geom`.

### 4.1 `ESCALATION` — deterministic derivation

New use-case `projectEscalation(signal: TrendSignal, incidentId, id, cfg)` that **wraps** `classifyTrend`
(reused, not reimplemented) and, when `trend !== 'STEADY'`, emits a `Prediction`:
- `kind: 'ESCALATION'`
- `method`: `'first-order projection: least-squares trend slope with dead-band (reused from SitRep trend classifier)'`
- `inputs`: `{ slopePerHour, samples, deadbandPerHour, trend }` (the full `TrendResult`, verbatim)
- `uncertainty`: derived from `samples` count (fewer samples ⇒ higher uncertainty — a documented, config-
  injectable curve, not invented per-call)
- `geom`: undefined (a trend is a scalar signal, not geolocated — the `Prediction.geom?` optionality
  (`prediction.ts:18`) already supports this; it contributes to the Outlook (§5) but not the map layer)
- `STEADY` ⇒ `null` (no prediction), same "labeled null, not a dead-end" idiom as
  `projectFireCone`/`projectFloodInundation` (`prediction-projection.ts:42,93,96,176,180`)

### 4.2 `IMPACT_OVER_TIME` — deterministic derivation

New use-case `projectImpactOverTime(series: TrendSample[], exposureBasis, incidentId, id, cfg)` that
projects the *count* (exposed population / exposed nodes, from the same deterministic
`computeExposures`/priority-ranking pipeline, never re-derived) forward along the same least-squares trend
used for `ESCALATION`, at a fixed set of horizon checkpoints (e.g. +6h/+12h/+24h, config-injectable). Output:
- `kind: 'IMPACT_OVER_TIME'`
- `method`: `'first-order projection: exposure-basis count projected along the least-squares trend slope at fixed horizon checkpoints'`
- `inputs`: `{ basis: 'exposedPopulation'|'exposedNodes', checkpoints: [{horizonHours, projectedCount}], slopePerHour }`
- `uncertainty`: compounds with horizon distance (further checkpoints ⇒ higher uncertainty), same
  `baseUncertainty + horizon * uncertaintyPerHour` shape as `projectFireCone`
  (`prediction-projection.ts:46`)
- `geom`: undefined (a scalar-over-time projection, like ESCALATION)
- Insufficient time-series data ⇒ `null` (same no-dead-end idiom)

Both are pure functions taking an injected `nowMs`/signal array — no clock reads, deterministic and
replayable, matching every other function in `prediction-projection.ts`.

## 5. Outlook ranking

**Total order:** likelihood class DESC, then soonest ETA ASC, then severity DESC as tiebreak (FEV-8,
`EARS_FINAL_VERSION.md:152-153`; `CURRENT-PLAN-2-GLOBAL-PREDICTION.md:74`, "sort: class rank, then ETA asc").

```ts
export function compareOutlookItems(a: OutlookItem, b: OutlookItem): number {
  const classDiff = likelihoodClassRank(b.likelihoodClass ?? 'POSSIBLE') - likelihoodClassRank(a.likelihoodClass ?? 'POSSIBLE');
  if (classDiff !== 0) return classDiff;
  const etaA = a.etaHours ?? Number.POSITIVE_INFINITY;
  const etaB = b.etaHours ?? Number.POSITIVE_INFINITY;
  if (etaA !== etaB) return etaA - etaB;
  return severityRank(b.severity) - severityRank(a.severity); // tiebreak only
}
```

A pure, injectable-clock-free comparator — same shape and same file-local placement discipline as
`rankPriorities`' comparator (`src/application/priority-ranking/priority-ranking.ts:76-83`,
`.sort((a, b) => b.score - a.score || tieBreakKey compare)`) and `compareFloodCategory`
(`src/domain/gauge.ts:18-20`). A prediction with no `likelihoodClass` (e.g. `ESCALATION`/
`IMPACT_OVER_TIME`, which are trend-derived, not source-probability-derived) ranks as `POSSIBLE` by default
— never crashes the comparator, never silently sorts to an arbitrary position.

**Surfaces:**
- **SitRep section:** `SitRep` (`src/domain/sitrep.ts:36-45`) gains `readonly outlook: readonly
  RankedOutlookItem[]` (default `[]`), following the exact existing pattern of `priorities`
  (`sitrep.ts:44`, `readonly priorities: readonly RankedPriority[]`) — itself already "engine-ranked...
  the LLM narrates them but never reorders or invents them" (`sitrep.ts:26-28`). `outlook` is the
  identical pattern applied to `predictions[]` sorted by `compareOutlookItems`. **Finding:** SitRep
  synthesis currently has zero references to `Prediction` anywhere in
  `src/application/sitrep-synthesis/` (`grep` confirmed no match in `sitrep-synthesis.ts` or
  `news-grounding.ts`) — this is a wholly new wiring, not a modification of existing prediction-aware
  logic.
- **COP Outlook panel:** a new frontend panel component reading `predictions[]` from the plural
  `MapProjectionData` (§3.1) client-side re-sorted by the same `compareOutlookItems` (imported, not
  reimplemented, to guarantee the panel and the SitRep never disagree on order).

## 6. Threshold engine extension — forecast crossings

`src/application/threshold-evaluation/threshold-evaluation.ts:12-15` — `SignalReading` currently supports
only two target shapes:
```ts
export interface SignalReading {
  readonly floodCategory?: FloodCategory; // GAUGE_CATEGORY target
  readonly hazardWithinBuffer?: boolean;  // HAZARD_BUFFER target
}
```
Both are **observed** signals. FEV-9 (`EARS_FINAL_VERSION.md:154-155`) requires a **forecast** crossing (not
only observed) to also fire a DRAFT alert stating the expected crossing time + forecast basis. This ADR adds
a third target kind:
```ts
readonly forecastCategory?: FloodCategory;      // FORECAST_GAUGE_CATEGORY target — the GloFAS-class forecast reading
readonly forecastEtaHours?: number;             // paired lead-time, carried into the DRAFT alert text
```
`ThresholdRule.target` (`src/domain/threshold-rule.ts` — extend its own closed enum the same way) gains
`'FORECAST_GAUGE_CATEGORY'`; `conditionMet()` (`threshold-evaluation.ts:43-49`) gains one more branch
mirroring the existing `GAUGE_CATEGORY` branch (`compareFloodCategory(reading.forecastCategory,
rule.value) >= 0`). **Everything else in the engine is reused unchanged**: `evaluateRule`
(`:55-75`), `isFiring` (`:78-82`, hysteresis/cooldown), and `buildDraftAlert`
(`:106-116`) already hardcode `capStatus: 'DRAFT'` — a forecast-crossing fire is exactly as DRAFT-only/HITL
as an observed-crossing fire (Art. XIII, unchanged). `DraftAlertRequest`
(`threshold-evaluation.ts:88-95`) gains an optional `forecastEtaHours` that flows into the alert text
("expected crossing in ~N h, basis: <source method>") — reusing ADR-014's exact "declarative JSON rules...
creates auditable DRAFT alerts" decision (`ADR-014-threshold-rule-engine.md:38-40`), extended by one target
kind per that ADR's own stated extension path ("new target kinds require a small code addition (acceptable;
Rule-of-Three)", `ADR-014-threshold-rule-engine.md:46`).

## 7. Honest limitations

- **Ensemble member fraction is NOT a calibrated probability.** GloFAS's 51-member ensemble
  exceedance fraction (§2.2 row 2) is a *model-spread* signal, not a meteorologically calibrated
  probability-of-occurrence — the same caveat the master plan states verbatim
  (`CURRENT-MASTER-PLAN.md:225`, "ensemble probability = member fraction, not calibrated"). The classifier's
  `method` string states this every time a class is shown.
- **Source vintage / lead-time caveats.** `glofas-acl.ts:23-26`'s existing honest-limitation comment
  ("GloFAS is a MODEL forecast, not an observed gauge... corroborating global context, not a physics-grade
  local prediction") applies unchanged to the new `likelihoodClass`/`etaHours` fields — they inherit the
  same caveat, not a weaker one.
- **Classes are BEACON's presentation of a source signal, not a new forecast.** The classifier performs no
  extrapolation, smoothing, or cross-source fusion — it is a pure threshold lookup (§2.2) on a value the
  source already computed. This is stated in the same "Known limitations" consolidated section
  (`CURRENT-MASTER-PLAN.md:223-226`) the master plan mandates.

## Verification

- **Threshold-table unit tests:** parametrized tests over `DEFAULT_LIKELIHOOD_CONFIG` boundary values
  (`0.30`/`0.60` edges, strict-vs-inclusive comparison, same "pin the exactly-on-boundary case" discipline
  as `escalation-trend.test.ts:33-45`'s dead-band boundary test) for every signal-type row in §2.2's table.
- **Comparator property tests:** `compareOutlookItems` — total-order properties (antisymmetry, transitivity)
  over randomized `OutlookItem` fixtures, plus the exact tiebreak-chain assertions (class beats ETA beats
  severity) mirroring `priority-ranking.test.ts`'s tie-break style
  (`priority-ranking.ts:82`, stable `tieBreakKey`).
- **No-invented-probability/class contract test:** extend `output-validator.ts`'s existing test file with
  `usesOnlyCitedLikelihoodClasses` cases (a narration citing a class not present in facts is rejected; a
  narration citing the exact cited class passes) — the new companion to `usesOnlyCitedNumbers`
  (`output-validator.ts:12-18`), per §2.3.
- **Replay determinism:** `deriveDraftAlerts`-equivalent test for the new `FORECAST_GAUGE_CATEGORY` target
  — same cached forecast reading replayed twice with the same injected `now` produces the identical fire/
  no-fire outcome and identical `RuleRuntimeState` (mirrors the master plan's own acceptance test c,
  `CURRENT-MASTER-PLAN.md:216`, "trigger-evaluator replay determinism (same cached ensemble → same
  decision)").
- **`ESCALATION`/`IMPACT_OVER_TIME` unit tests:** extend `src/application/prediction-projection/
  prediction-projection.test.ts`'s pattern (labeled-null-on-insufficient-input, uncertainty-scales-with-
  horizon) to the two new projector functions, reusing `escalation-trend.test.ts`'s `TrendSample` fixtures
  rather than duplicating them.
- **`predictions[]` plural regression:** a test asserting `MapProjection`/`MapProjectionData` carry N > 1
  predictions through `projectMap` → wire → `map-data.ts` → `buildPredictionLayers` without truncation
  (the exact bug class the singular-field design would otherwise silently reintroduce).

## Consequences

**Positive.** Closes a verified, already-paid-for data loss (GloFAS parses and discards its own probability/
tendency fields today); reuses three already-built deterministic primitives (`classifyTrend`,
`computeExposures`/priority-ranking, the threshold-rule engine) rather than inventing new machinery; the
Outlook ranking is a pure comparator, trivially unit-tested and shared verbatim between SitRep and the COP
panel so they cannot disagree.

**Negative / accepted.** The `prediction` → `predictions` rename (§3.1) touches six files in lockstep — a
missed one is a `tsc` failure, not a silent gap (same trade BEACON already accepts elsewhere, e.g. ADR-032
§2); the new `usesOnlyCitedLikelihoodClasses` check is an additional narration-validation pass on every AI
response (bounded cost — same regex-scan class as the existing number check).

## Alternatives considered

- **A raw numeric "confidence %" field on `Prediction` instead of an ordered class** — rejected: this is
  precisely FUW-3 (`EARS_FINAL_VERSION.md:156`, "SHALL NOT invent, interpolate, or model a probability value
  that a source did not [provide]") and repeats ADR-015's Option B mistake ("LLM emits a single confidence
  number... non-reproducible, ungrounded — violates Art. XII", `ADR-015-confidence-scoring.md:29-30`) one
  layer removed — a raw % implies a precision the underlying model-ensemble signal does not have. The
  ordered class is the honest granularity.
- **Store `hazardArrival` on `Prediction` itself** — rejected (§3): would require `makePrediction` to read
  the wall clock, breaking the pure-value-object discipline every other domain factory in this codebase
  follows (`makeHazardGeometry`, `makeGauge`, `makeAlert` all take injected timestamps, never `Date.now()`).
- **Keep `prediction` singular and add a second `secondaryPredictions[]` field** — rejected: doubles the
  `Record<LayerId,…>`/wire-type surface for no benefit over simply making the one field an array from the
  start; the plural design is also what the master plan explicitly names
  (`CURRENT-MASTER-PLAN.md:88`, "`predictions[]` plural end-to-end").
- **A single combined `ESCALATION_AND_IMPACT` kind** — rejected: `ESCALATION` (a trend label on one signal)
  and `IMPACT_OVER_TIME` (a projected count at multiple horizon checkpoints) have different `inputs` shapes
  and different consumers (SitRep trend narration vs. Outlook/predicted-impact panels per D2,
  `CURRENT-MASTER-PLAN.md:100-104`) — splitting them keeps each `Prediction.inputs` shape self-describing
  and keeps the schema CHECK constraint (`core-tables.ts:227-231`, already listing them separately)
  consistent with the domain enum it mirrors.

## Implementation status

**SHIPPED.** Corrected 2026-09-11.

This section said "Not started" while forecast likelihood and the outlook panel was fully built and running — `src/application/outlook/`, the `outlook.*` catalogue keys, and the Outlook panel in the COP are in
the repository and covered by the test suite. The sentence was written at S02, when it was true, and
was never revisited as the work landed.

It is recorded here rather than deleted because the failure mode matters: a reviewer reading these
four ADRs in order would have concluded that BEACON's flagship anticipatory capability was never
delivered, and would have been reading the project's own architecture record to reach that
conclusion. A decision record that lags the code is not a neutral omission; it actively misinforms
the one audience it exists for.

The original S02 planning text follows, unaltered, as the historical record:

> Not started — this ADR is the S02 architecture record for wave MW-C (`CURRENT-MASTER-PLAN.md:149-152`);
> implementation happens at S04/S05+ under the golden-thread requirement→spec→test→code discipline.

---

## Correction (2026-07-28, findings F-77 / F-85 / F-90 / F-91 / F-94) — the Outlook's SOURCE, its comparator, and its surface

§5 above is retained verbatim. Two of its statements were wrong in a way that would have shipped a defect,
and one was under-specified; all three are corrected here rather than quietly reinterpreted.

### 1. The COP Outlook panel reads the SITREP path, not `MapProjectionData` (F-77)

§5 "Surfaces" says the panel is "a new frontend panel component reading `predictions[]` from the plural
`MapProjectionData` (§3.1)". **That is incompatible with this ADR's own §4.1/§4.2**, which give `ESCALATION`
and `IMPACT_OVER_TIME` `geom: undefined` **by design**. `ProjectedPrediction.geometry` is REQUIRED, so
`projectMap` correctly skips a geometry-less prediction (`map-projection.ts` `projectPrediction` →
`undefined`, filtered by `present()`), and the map wire's `predictions[]` is therefore "map-plottable
predictions", not "all predictions". A panel sourced from it would have omitted **exactly the two kinds the
Outlook exists to show** — a silently incomplete Outlook, which is worse than no Outlook, because nothing on
the screen says anything is missing.

The Outlook is therefore sourced from the **SitRep path** — `GET /incidents/{id}/sitrep` → `outlook[]` —
which is what `SPEC-FINAL-VERSION-DELTA.md` §5 already specified. `SitRep.outlook` is the one surface that
carries every prediction regardless of geometry.

`ProjectedPrediction.geometry` was deliberately **NOT** weakened to optional. A projected map prediction
without a shape is meaningless: the map contract's requirement is correct, and relaxing a correct contract to
work around a doc error would have propagated the error into the type system (and into every
`buildPredictionLayers` consumer) instead of fixing it.

The panel and the SitRep still cannot disagree on order — §5's actual concern — but for a stronger reason
than "both import the same comparator": there is now **one** ranking, computed once by the engine
(`rankOutlook`, `src/application/outlook/outlook.ts`), and the client re-sorts nothing at all (Art. XII). The
comparator is not exported to the browser.

### 2. `OutlookItem.severity` is OPTIONAL (F-90)

§5's sketch types the tiebreak as `severityRank(b.severity)` — a required field. **No `Prediction` carries a
severity**: `src/domain/prediction.ts` has `kind`/`method`/`inputs`/`uncertainty`/`geom`/`horizon`/
`likelihoodClass`/`etaHours`/`sourceId` and never had one. Requiring it would have forced every caller to
manufacture a severity per prediction purely to satisfy a tiebreak — inventing precisely the class of figure
Art. XII forbids. It is therefore optional, supplied only by a caller that holds a **source-stated** severity
(e.g. an incident's DRAFT alert), and an absent severity ranks BELOW `MINOR`: an unstated severity can never
outrank a stated one. The likelihood-class default is unchanged (absent ⇒ `POSSIBLE`, as §5 states).

### 3. The ETA key is compared, not subtracted (F-91)

§5's sketch computes `etaA - etaB` after defaulting an absent ETA to `Number.POSITIVE_INFINITY`. That returns
**±Infinity** as soon as exactly one row states a lead time (the common case), and `NaN` for two `NaN` ETAs —
and a comparator that returns `NaN` is not a total order, so `Array.prototype.sort` may emit ANY permutation.
The shipped comparator normalises every non-finite ETA to `+Infinity` and returns `-1`/`1` from a comparison
instead of a subtraction. **The ORDER is exactly the one §5 specifies**; only its arithmetic is closed. The
ordering laws (reflexivity, antisymmetry, transitivity, transitivity-of-equality, sort stability) are
asserted exhaustively over the comparator's entire declared input space in
`src/application/outlook/outlook.test.ts`, because a comparator that is not a total order does not misplace
one row — it silently corrupts every ranking.

### 4. §4.2 is dimensionally under-specified — the resolution, recorded (F-85)

§4.2 says `IMPACT_OVER_TIME` projects the exposure-basis **count** "forward along the least-squares trend
slope". That slope is in SIGNAL units per hour (acres/h, metres/h) while the count is people or nodes, so
multiplying one by the other yields a figure whose unit does not exist. C2.2's implementation resolved it by
projecting along the signal's **relative** rate — `slopePerHour ÷ latest signal level`, a dimensionless
per-hour rate — and refusing to project at all when the latest level is ≤ 0. §4.2's `method` string is still
quoted verbatim by the projector so the displayed label cannot drift from this ADR; the arithmetic and its
caveat travel in `inputs.projection`/`inputs.caveat`. Recorded here (rather than left in the task log) so the
next reader does not re-derive the same problem, per C2.2's hand-off.

### 5. Where the Outlook is built, and what the LLM can do to it

`rankOutlook` runs inside `synthesizeSitRep` (`src/application/sitrep-synthesis/sitrep-synthesis.ts`) and its
result travels STRUCTURALLY to the wire. The narrator's payload is built by `toCitedFacts` from the grounded
`facts` alone, so no outlook row is ever handed to a model: "the LLM narrates them but never reorders or
invents them" is not a rule someone must remember here, it is unreachable by construction — the same property
`priorities` has always had. The existing narration guards (`usesOnlyCitedNumbers`,
`usesOnlyCitedLikelihoodClasses`, `output-validator.ts`) needed **no extension**: they already reject a
narration asserting a number or a likelihood word absent from the cited facts, which covers an invented
Outlook claim in the only direction the model can reach. Finding **F-62** remains: that guard is
English-surface-only and cannot police a translated narration.

### 6. The COP surface ships DISPLAY-GATED off (F-94)

The Outlook section lives inside the SitRep dock (`app/_components/panels/outlook-panel.tsx`, rendered by
`SitRepView`) and is gated by `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL` (default **off**) — the same build-time
seam as `NEXT_PUBLIC_FEATURE_CITIZEN_STREAM`. Measured, not assumed: rendering it grows the COP page from
1644 px to 1836 px, which fails all four `cop.png` visual baselines plus `cop-rtl.png`, and the feature's
remaining baseline-regeneration budget is a single unit that belongs to the orchestrator. The DATA is not
gated — `GET /incidents/{id}/sitrep` serves `outlook[]` unconditionally and `openapi.yaml` requires it — so
turning the surface on is one env var plus one baseline regeneration, with no code change. The flag-on
render was verified in a real browser (axe WCAG 2.2 AA + golden path, both green).

The section renders nothing when `outlook` is empty. An incident with no forecastable signal has no Outlook,
and an "Outlook: none" block on every incident would be noise rather than honesty (Art. XVI: an absent
section, never a faked one).

---

## Resolution note — 2026-08-01 (finding F-411, following F-340)

**§2.3 above is now historically accurate but technically stale, and is preserved rather than rewritten.**

That section describes the Art. XII enforcement mechanism as `usesOnlyCitedNumbers` — a check that the
narration's numeric tokens are all *members of* the supplied `CitedFact[]`. **That function no longer
exists.** The E3 re-audit (finding **F-340**) demonstrated that a membership check is not an enforcement of
Art. XII at all: eight fabricated figures were planted against realistic cited facts and the shipped
validator **accepted all eight**, including —

- `"Roughly 30 people are unaccounted for."` — the `30` donated by the timestamp `22:30` in a cited fact;
- `"About 2026 residents were evacuated."` — the year, borrowed from an ISO date;
- `"12.4 million dollars in damage."` and `"the crest will reach 12.4 metres."` — the cited crest value
  `12.4 feet`, re-attached to a different magnitude and a different unit;
- `"Fourteen thousand displaced."` — spelled-out numerals, which carry no digit to match;
- `"Butte County is the worst-hit and highest-priority area."` — a ranking containing no digit at all.

A ninth was found during the fix and is worth recording because it is invisible to English-only review:
the check was written with `\d`, which is **ASCII-only**, while the narrator is multilingual across
**14 locales** — Arabic-Indic numerals (`٤٧`) passed unexamined.

**The replacement is `narrationIsFigureFree(text)`** (`src/adapters/ai/llm/output-validator.ts`), composed
into `isValidNarration`. It does not compare the narration against the facts at all; it rejects **any**
figure in narration — Unicode `\p{N}`, number-words, and ranking-words, with a small bounded allowlist for
non-quantity idioms (`no one`, `first responders`, `first aid`, `one another`). This is a stricter and
much simpler contract, and it is the right one: **every figure the operator sees is rendered by the UI from
the deterministic record** (`sitrep-panel.tsx` renders `fields`/`trend`/`priorities` with citation chips);
the summary paragraph is prose only. No legitimate narration path needs a digit.

### What this means for §2.3's requirement
The companion validator this ADR asked for — `usesOnlyCitedLikelihoodClasses` — is **subsumed and
superseded**. Its purpose was to stop the LLM narrating an invented `LIKELY`/`VERY_LIKELY` class word that
the numeric check could not see. Under the new rule, ranking-words are rejected outright, so an invented
likelihood class cannot appear in narration whether or not it matches a cited fact. The ADR's *finding*
(word-tokens escape a numeric check) was correct and is what the new guard is built around; only its
proposed *mechanism* is obsolete.

> **Correction — 2026-08-02 (lens-1 docs↔code check).** "Subsumed and superseded" overstates it, and the
> code is the authority: **`usesOnlyCitedLikelihoodClasses` still exists and still runs.** It is defined at
> `src/adapters/ai/llm/output-validator.ts:100`, exported through `src/adapters/ai/index.ts:18`, and — this
> is the load-bearing part — **called by `isValidNarration` at `:116`, before the figure guard**:
> ```ts
> export function isValidNarration(narrative: Narrative, facts: readonly CitedFact[]): boolean {
>   if (narrative.text.trim().length === 0) return false;
>   if (narrative.citations.length === 0) return false;
>   if (!usesOnlyCitedLikelihoodClasses(narrative.text, facts)) return false;   // ← still live
>   return narrationIsFigureFree(narrative.text);
> }
> ```
> Delete it and narration validation changes behaviour, so it is wired, not vestigial. What is accurate is
> that it is **no longer the primary Art. XII guard** — `narrationIsFigureFree` is, and it independently
> rejects the ranking-words (`RANKING_WORD`, `:49`) that the likelihood check was originally proposed to
> catch. The two now overlap deliberately rather than one replacing the other. The paragraph above is left
> in place as the record of what the fix intended; this note records what the code does.

> **Also corrected 2026-08-02: §5 of this ADR** (the "Where the Outlook is built" section) still lists
> `usesOnlyCitedNumbers` among "the existing narration guards". **That function no longer exists anywhere
> under `src/`** — a repo-wide grep returns only documentation hits. §5's *conclusion* is unaffected (the
> guards needed no extension, and an invented Outlook claim is still unreachable), but the name is stale;
> read it as `narrationIsFigureFree` + `usesOnlyCitedLikelihoodClasses`.

### Honest cost of the stricter rule
A narration that names a numbered highway (`"Highway 70"`) or a clock time is now rejected, and the SitRep
degrades to the deterministic-only rung. That is a fail-safe loss of prose, never an unsafe pass — but it
is a real behavioural change and is recorded here rather than discovered later. Two knock-ons were required
to keep the fix honest rather than cosmetic: the offline mock narrator previously echoed cited claims
verbatim (digits included), which would have made every ladder test pass *vacuously* on the deterministic
floor; and the cloud system prompt still instructed the model to restate figures verbatim, which would have
silently disabled the cloud rung for every compliant completion. Both were corrected with the guard.
