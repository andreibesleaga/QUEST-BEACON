// BEACON — GET /alerts carries the FORECAST evidence (WP A8 / finding F-301). Deterministic: the SHIPPED
// composition root under a fixed clock, no IO, no network.
//
// THE DEFECT THIS FILE PINS. Lead time, expected crossing instant, forecast vintage and the classified
// likelihood are computed by `buildDraftAlert` (threshold-evaluation.ts) and carried whole by
// `deriveDraftAlertProposals`, but the composition root called `deriveDraftAlerts`, which narrows every
// proposal to its bare `Alert` — so the wire projected only {id,state,category,severity,incidentId} and a
// viewer saw THAT an anticipatory DRAFT existed, never WHY or HOW FAR AHEAD.
//
// The assertions are CONTRACT-shaped, not literal: the seed may retune its lead time, category or vintage
// without touching this file, but the evidence vanishing, arriving unlabelled, or being fabricated for a
// non-forecast DRAFT fails it.
import { describe, it, expect } from 'vitest';
import { buildFeatureDeps } from '@/main/feature-seed.js';
import type { Envelope } from '@/ports/interaction.js';
import { handleAlertsGet, type AlertQueueItem } from './queue.js';

const T0 = '2026-07-05T22:00:00.000Z';
const clock = (): string => T0;

/** The anticipatory DRAFT the shipped seed computes, and an OBSERVED one that must stay evidence-free. */
const FORECAST_ALERT_ID = 'ro-alert-forecast-draft-1';
const OBSERVED_ALERT_ID = 'ca-alert-draft-1';

function rowsOf(body: unknown): readonly AlertQueueItem[] {
  return (body as Envelope<{ readonly alerts: readonly AlertQueueItem[] }>).data.alerts;
}

/** GET /alerts exactly as the running app serves it: composed deps → the shipped handler. */
async function servedAlerts(env: Record<string, string | undefined> = {}): Promise<{
  readonly body: unknown;
  readonly rows: readonly AlertQueueItem[];
}> {
  const features = buildFeatureDeps({ clock, env });
  const res = await handleAlertsGet(
    { role: 'VERIFIER' },
    {
      alerts: features.interop.alerts,
      clock: features.clock,
      ...(features.forecastEvidenceFor !== undefined
        ? { forecastEvidenceFor: features.forecastEvidenceFor }
        : {}),
    },
  );
  expect(res.status).toBe(200);
  return { body: res.body, rows: rowsOf(res.body) };
}

const forecastRow = (rows: readonly AlertQueueItem[]): AlertQueueItem | undefined =>
  rows.find((a) => a.id === FORECAST_ALERT_ID);

describe('GET /alerts serves the forecast evidence (F-301)', () => {
  it('carries the lead time and the expected crossing instant of the anticipatory DRAFT', async () => {
    const { rows } = await servedAlerts();
    const row = forecastRow(rows);
    expect(
      row,
      `${FORECAST_ALERT_ID} is absent — the forecast path regressed (F-81)`,
    ).toBeDefined();
    expect(row?.forecast?.leadTimeHours).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(row?.forecast?.expectedCrossingAt ?? ''))).toBe(false);
    // The vintage the DRAFT rests on — a forecast figure without its issue instant is unauditable.
    expect(Number.isNaN(Date.parse(row?.forecast?.forecastIssuedAt ?? ''))).toBe(false);
  });

  it('carries the likelihood CLASS with the raw source value and the classifier method (FU-11)', async () => {
    const row = forecastRow((await servedAlerts()).rows);
    expect(row?.forecast?.likelihoodClass).toBeDefined();
    // A class never travels without the evidence that produced it (Art. XII / FEV-9).
    expect(row?.forecast?.likelihoodRawValue).toBeDefined();
    expect(row?.forecast?.likelihoodSourceField).toBeDefined();
    expect(row?.forecast?.likelihoodMethod).toBeTruthy();
  });

  it('labels every served figure with its own method and uncertainty (the predictions law)', async () => {
    const row = forecastRow((await servedAlerts()).rows);
    expect(row?.forecast?.method).toBeTruthy();
    expect(row?.forecast?.uncertainty).toBeTruthy();
  });

  it('omits the field entirely for an OBSERVED DRAFT — an absent forecast is never fabricated', async () => {
    const { rows } = await servedAlerts();
    const observed = rows.find((a) => a.id === OBSERVED_ALERT_ID);
    expect(observed, `${OBSERVED_ALERT_ID} is absent — the observed rule regressed`).toBeDefined();
    expect(observed).not.toHaveProperty('forecast');
  });

  it('is purely ADDITIVE: the pre-existing row keys and the mandatory envelope parts are unchanged', async () => {
    const { body, rows } = await servedAlerts();
    const row = forecastRow(rows);
    expect(row?.state).toBe('DRAFT');
    expect(row?.category).toBeTruthy();
    expect(row?.severity).toBeTruthy();
    expect(row?.incidentId).toBeTruthy();
    const envelope = body as Envelope<unknown>;
    expect(envelope.provenance.length).toBeGreaterThan(0); // F1 — provenance is MANDATORY on every data response
    expect(envelope.freshness).toBe(T0);
  });

  // Art. XII: these are deterministic engine values. If the served evidence ever varied with the model being
  // reachable, an LLM would have become a source of a number — the one thing this codebase forbids.
  it('is IDENTICAL with the LLM disabled — the evidence never depends on a model (Art. XII)', async () => {
    const off = await servedAlerts({ AI_MODE: 'off' });
    const on = await servedAlerts({ AI_MODE: 'cloud', OPENROUTER_API_KEY: 'test-key' });
    expect(JSON.stringify(off.rows)).toBe(JSON.stringify(on.rows));
    expect(forecastRow(off.rows)?.forecast).toBeDefined();
  });
});
