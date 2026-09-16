// BEACON — envelope → FE-typed mappers (E8·seam). The SINGLE place the frontend reads its typed data OUT of
// the raw `Envelope<T>.data` the API returns, so the wire↔type seam is crossed in exactly one, test-covered
// spot. Each mapper is PURE and framework-free; the seam/contract test (mappers.contract.test.ts) pipes the
// ACTUAL HTTP handler output through these — any envelope↔type drift fails vitest, not just a browser.
import type { Envelope, CitationView } from '@/ports/interaction.js';
import type {
  AlertSummary,
  AlertsData,
  IncidentSummary,
  IncidentsData,
  ReportSummary,
  ReportsData,
  SitRepData,
} from './types.js';

/** GET /regions/:id/incidents — the envelope `data` is an OBJECT; the incident list lives under `.incidents`. */
export function incidentsOf(env: Envelope<IncidentsData>): readonly IncidentSummary[] {
  return env.data.incidents;
}

/** The SitRep body + its grounding: `data` (numbers/priorities) plus the envelope's top-level citations[] (F2). */
export interface SitRepView {
  readonly data: SitRepData;
  readonly citations: readonly CitationView[];
}

/** GET /incidents/:id/sitrep — join the SitRep `data` with the envelope-level citations[] (never on data). */
export function sitRepOf(env: Envelope<SitRepData>): SitRepView {
  return { data: env.data, citations: env.citations ?? [] };
}

/** GET /reports — the verifier queue array lives under `data.reports`. */
export function reportsOf(env: Envelope<ReportsData>): readonly ReportSummary[] {
  return env.data.reports;
}

/**
 * One confidence-blend component ready for a labelled bar — its key and its [0,1] engine value.
 *
 * The human LABEL is deliberately absent. It used to live here as an English literal ('Geocode', 'Source
 * authority', …) and was rendered raw by the verifier queue, so four labels on the surface where a report
 * is approved or rejected stayed English in all 14 locales. They are now catalog keys
 * (`verifierQueue.component.<key>`, mirrored in every messages/<locale>.json) looked up at the render site,
 * which is the only place that has a translator — and keeps this seam pure and framework-free.
 */
export interface ConfidenceComponentView {
  readonly key: 'geocode' | 'authority' | 'classifier' | 'corroboration';
  readonly value: number;
}

// Fixed display order for the deterministic blend (Art. XII — the UI renders, never computes).
const CONFIDENCE_COMPONENT_ORDER: ReadonlyArray<ConfidenceComponentView['key']> = [
  'geocode',
  'authority',
  'classifier',
  'corroboration',
];

/**
 * Project a report's deterministic confidence components into ordered, labelled rows for the verifier UI.
 * Only present sub-scores are surfaced (an absent component is omitted, never rendered as 0). The client
 * NEVER computes a value here — it renders exactly what the engine returned (Art. XII).
 */
export function confidenceComponentsOf(report: ReportSummary): readonly ConfidenceComponentView[] {
  const components = report.confidenceComponents;
  if (components === undefined) return [];
  const rows: ConfidenceComponentView[] = [];
  for (const key of CONFIDENCE_COMPONENT_ORDER) {
    const value = components[key];
    if (value !== undefined) rows.push({ key, value });
  }
  return rows;
}

/** GET /alerts — the DRAFT alert array lives under `data.alerts`. */
export function alertsOf(env: Envelope<AlertsData>): readonly AlertSummary[] {
  return env.data.alerts;
}

/** A deterministic decision figure — label + engine number (+ optional engine detail). Never client-computed. */
export interface FigureView {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
}

/**
 * Decision-support figures DERIVED from the SitRep's engine-ranked priorities (Art. XII: render what the
 * engine returned; the client never computes a number). Each ranked priority → one figure: the asset label,
 * its deterministic rank, and the engine's blended-score detail as the unit.
 */
export function decisionFiguresOf(data: SitRepData): readonly FigureView[] {
  return data.priorities.map((p) => ({
    label: p.label,
    value: p.rank,
    ...(p.detail !== undefined ? { unit: p.detail } : {}),
  }));
}
