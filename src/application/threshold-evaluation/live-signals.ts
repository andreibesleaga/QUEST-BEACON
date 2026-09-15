// BEACON — threshold signals from the LIVE picture (V3 §3.13, 2026-09-14).
//
// UNTIL NOW the threshold engine only ever evaluated the hand-seeded demo specs: a fixed reading, a fixed
// rule, a fixed incident, mode MOCK. Twenty-six live sources and five discovered wildfires later, no live
// incident could raise a DRAFT alert, because nothing turned live geometry into a reading. This module
// does that, and only that: given a region's rules and the incidents and layers the composition just
// assembled, it produces the same `ThresholdAlertSpec` the existing draft-alert path already consumes —
// so the DRAFT → human approval → CAP handshake (Art. XIII) is unchanged, and so is the evaluator with
// its edge/dwell/cooldown state.
//
// EVERY READING IS COMPUTED, NEVER NARRATED (Art. XII):
//   HAZARD_BUFFER      — the incident's own hazards against the region's lifeline nodes, through the same
//                        exposure derivation the COP draws; "within" means inside the hazard or closer than
//                        the rule's metres.
//   GAUGE_CATEGORY     — the highest observed flood category among the region's served gauges; a reading
//                        for FLOOD incidents (a gauge says nothing about a fire).
//   FORECAST_GAUGE_CATEGORY — NOT derived here: no live source yet publishes a forecast CATEGORY, only a
//                        crest figure, and a category invented from it would be a derived claim. Those
//                        rules keep their seeded/forecast path.
import type { HazardGeometry } from '@/domain/hazard-geometry.js';
import type { Gauge, FloodCategory } from '@/domain/gauge.js';
import { compareFloodCategory } from '@/domain/gauge.js';
import type { InfraNodeType, InfrastructureNode } from '@/domain/infrastructure-node.js';
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import type { AlertCategory, AlertSeverity } from '@/domain/alert.js';
import type { AlertId, IncidentId, SourceId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { PolygonGeometry } from '@/domain/value-objects/geo.js';
import { positionsOf } from '@/application/shared/region-clip.js';
import type { SpatialPort } from '@/ports/infra.js';
import { deriveExposures } from '@/application/derivation/derive-cop.js';
import type { ThresholdAlertSpec } from '@/application/derivation/derive-alerts.js';
import { evaluateRule } from './threshold-evaluation.js';
import type { RuleRuntimeState, SignalReading } from './threshold-evaluation.js';

/** What a live incident brings to the evaluation: its identity, type, own hazards and founding source. */
export interface LiveIncidentForSignals {
  readonly id: IncidentId;
  readonly type: string;
  readonly hazards: readonly HazardGeometry[];
  readonly sourceId: SourceId;
}

export interface LiveSignalsInput {
  readonly rules: readonly ThresholdRule[];
  readonly incidents: readonly LiveIncidentForSignals[];
  readonly infrastructure: readonly InfrastructureNode[];
  readonly buffers: Readonly<Record<InfraNodeType, number>>;
  readonly gauges: readonly Gauge[];
  readonly computedAt: string;
  readonly spatial: SpatialPort;
  /** Per-alert runtime state from the previous cycle (edge/dwell/cooldown), keyed by alert id. */
  readonly previous: ReadonlyMap<string, RuleRuntimeState>;
}

/** The stable id of the DRAFT a (rule, incident) pair proposes — the same pair, the same draft, every cycle. */
export function liveAlertId(rule: ThresholdRule, incidentId: IncidentId): AlertId {
  return asId<AlertId>(`live:${String(rule.id)}:${String(incidentId)}`);
}

/** One spec per (rule, incident) pair that has a computable reading. Deterministic and order-stable. */
export function liveThresholdSpecs(input: LiveSignalsInput): readonly ThresholdAlertSpec[] {
  const out: ThresholdAlertSpec[] = [];
  for (const incident of input.incidents) {
    for (const rule of input.rules) {
      const reading = readingFor(rule, incident, input);
      if (reading === undefined) continue;
      const alertId = liveAlertId(rule, incident.id);
      const previous = input.previous.get(String(alertId));
      out.push({
        rule,
        reading,
        incidentId: incident.id,
        alertId,
        category: categoryFor(incident.type),
        severity: severityFor(rule),
        sourceId: incident.sourceId,
        ...(previous !== undefined ? { previous } : {}),
      });
    }
  }
  return out;
}

/** The evaluator's own runtime state after this cycle, to be handed back as `previous` next time. */
export function nextRuleStates(
  specs: readonly ThresholdAlertSpec[],
  now: number,
): ReadonlyMap<string, RuleRuntimeState> {
  const next = new Map<string, RuleRuntimeState>();
  for (const spec of specs) {
    const outcome = evaluateRule({
      rule: spec.rule,
      reading: spec.reading,
      now,
      ...(spec.previous !== undefined ? { previous: spec.previous } : {}),
    });
    next.set(String(spec.alertId), outcome.state);
  }
  return next;
}

/**
 * The footprint an incident's hazards cover, as the bounding rectangle of every vertex: the polygon a
 * road route must avoid and the extent the map's projections start from. A rectangle, deliberately — a
 * convex hull would still be a derived shape, and the rectangle is the honest "somewhere in here".
 */
export function clusterFootprint(hazards: readonly HazardGeometry[]): PolygonGeometry | undefined {
  // A hazard is placed by its `geometry` field — the same collector the region clip uses (ADR-042).
  const positions = hazards.flatMap((h) => positionsOf(h));
  if (positions.length === 0) return undefined;
  let [w, s, e, n] = [positions[0]![0], positions[0]![1], positions[0]![0], positions[0]![1]];
  for (const [lon, lat] of positions) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  // A single point (one perimeter vertex, one hotspot) still needs an area; pad by ~100 m.
  const pad = 0.001;
  if (e - w < pad) {
    w -= pad;
    e += pad;
  }
  if (n - s < pad) {
    s -= pad;
    n += pad;
  }
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

function readingFor(
  rule: ThresholdRule,
  incident: LiveIncidentForSignals,
  input: LiveSignalsInput,
): SignalReading | undefined {
  if (rule.target === 'HAZARD_BUFFER') return hazardBufferReading(rule, incident, input);
  if (rule.target === 'GAUGE_CATEGORY') return gaugeCategoryReading(incident, input.gauges);
  return undefined; // FORECAST_GAUGE_CATEGORY: no live forecast category exists to read (header)
}

function hazardBufferReading(
  rule: ThresholdRule,
  incident: LiveIncidentForSignals,
  input: LiveSignalsInput,
): SignalReading | undefined {
  const metres = metresOf(rule.value);
  if (metres === undefined) return undefined;
  if (incident.hazards.length === 0 || input.infrastructure.length === 0) return undefined;
  // The RULE's distance is the buffer, for every lifeline type: "a node within 2000 m" is the rule's
  // claim, not the COP's per-type drawing distance (`input.buffers` supplies the type list only).
  const buffers = Object.fromEntries(
    Object.keys(input.buffers).map((type) => [type, metres]),
  ) as Readonly<Record<InfraNodeType, number>>;
  const exposures = deriveExposures(
    {
      incidentId: incident.id,
      hazards: incident.hazards,
      nodes: input.infrastructure,
      buffers,
      computedAt: input.computedAt,
    },
    input.spatial,
  );
  if (!exposures.ok) return undefined;
  // An exposure row exists only for a node inside the hazard or within the buffer of it.
  return { hazardWithinBuffer: exposures.value.length > 0 };
}

/** `2000`, `2000m`, `2 km` → metres; anything else is not a distance (the live table holds `1000m`). */
function metresOf(value: string): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m|km)?\s*$/i.exec(value);
  if (m === null) return undefined;
  const n = Number(m[1]);
  const metres = m[2]?.toLowerCase() === 'km' ? n * 1000 : n;
  return Number.isFinite(metres) ? metres : undefined;
}

function gaugeCategoryReading(
  incident: LiveIncidentForSignals,
  gauges: readonly Gauge[],
): SignalReading | undefined {
  if (incident.type !== 'FLOOD' || gauges.length === 0) return undefined;
  let worst: FloodCategory = 'NONE';
  for (const g of gauges)
    if (compareFloodCategory(g.floodCategory, worst) > 0) worst = g.floodCategory;
  return { floodCategory: worst };
}

function categoryFor(incidentType: string): AlertCategory {
  return incidentType === 'WILDFIRE' ? 'Fire' : 'Met';
}

/** Severity is the RULE's (its target and its threshold value), never a judgement about the incident. */
function severityFor(rule: ThresholdRule): AlertSeverity {
  if (rule.target === 'HAZARD_BUFFER') return 'SEVERE';
  if (rule.value === 'MAJOR') return 'EXTREME';
  if (rule.value === 'MODERATE') return 'SEVERE';
  return 'MODERATE';
}
