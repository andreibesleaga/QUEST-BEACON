// BEACON — the FORECAST threshold rule is reachable from the RUNNING app (UNIMPLEMENTED_REGISTER row 21 /
// finding F-81; FR-LD-15).
//
// WHY THIS FILE EXISTS. `FORECAST_GAUGE_CATEGORY` (ADR-033 §6, FEV-9) was fully implemented and fully
// unit-tested at the ENGINE level, while nothing in the composed app ever built one — a feature with tests
// and no reachable path. `src/main/feature-seed.ts` now seeds exactly one such rule
// (`defaultForecastThresholds` → `ro-forecast-crossing-rule`), and `e2e/forecast-draft-alert.spec.ts` proves
// it in a browser. But Playwright is not the vitest gate: until this file, the SEED itself had no
// deterministic assertion, so the rule could silently stop firing and only a browser run would notice.
//
// This is that assertion, at the composition level and under the project's fixed clock: the SHIPPED seed,
// composed by the SHIPPED `buildFeatureDeps`, puts the anticipatory DRAFT into the alert store the running
// app serves `GET /alerts` from — and every alert it computes is a DRAFT, never an ACTUAL (Art. XIII).
//
// It asserts the CONTRACT of the seed, not its literals: the rule's category, lead time and vintage may be
// retuned without touching this file, but the rule vanishing, ceasing to fire, or producing anything
// publishable fails it.
import { describe, expect, it } from 'vitest';
import { buildFeatureDeps, DEFAULT_FEATURE_SEED } from './feature-seed.js';

const T0 = '2026-07-05T22:00:00.000Z';
const clock = (): string => T0;

/** The anticipatory rule + the DRAFT it proposes, as `src/main/feature-seed.ts` seeds them. */
const FORECAST_RULE_ID = 'ro-forecast-crossing-rule';
const FORECAST_ALERT_ID = 'ro-alert-forecast-draft-1';
const FORECAST_INCIDENT_ID = 'ro-flood-demo';

/** The seeded anticipatory spec at the fixed instant. Throws (fails the test) if the seed ever loses it. */
function seededForecastSpec(): NonNullable<ReturnType<NonNullable<typeof DEFAULT_FEATURE_SEED.forecastThresholds>>>[number] {
  const spec = (DEFAULT_FEATURE_SEED.forecastThresholds?.(Date.parse(T0)) ?? [])[0];
  if (spec === undefined) throw new Error('the shipped seed carries no forecast threshold rule (F-81 regressed)');
  return spec;
}

describe('the shipped feature seed carries a FORECAST threshold rule (row 21 / F-81)', () => {
  it('seeds exactly one FORECAST_GAUGE_CATEGORY rule, as a function of the evaluation instant', () => {
    const specs = DEFAULT_FEATURE_SEED.forecastThresholds?.(Date.parse(T0)) ?? [];
    const forecast = specs.filter((s) => s.rule.target === 'FORECAST_GAUGE_CATEGORY');
    expect(forecast).toHaveLength(1);
    expect(String(forecast[0]?.rule.id)).toBe(FORECAST_RULE_ID);
  });

  it('re-issues the reading RELATIVE to the injected instant, so the seed cannot age out of its vintage gate', () => {
    // The vintage gate in config/forecast-trigger.json refuses a forecast older than one source cycle. A seed
    // with a FIXED issue instant would fire on the day it was written and then quietly stop forever — the
    // exact rot this signature (a function of `now`) exists to prevent. Two distant instants, both current.
    const early = DEFAULT_FEATURE_SEED.forecastThresholds?.(Date.parse('2026-01-01T00:00:00.000Z')) ?? [];
    const late = DEFAULT_FEATURE_SEED.forecastThresholds?.(Date.parse('2027-01-01T00:00:00.000Z')) ?? [];
    expect(early[0]?.reading.forecastIssuedAt).not.toBe(late[0]?.reading.forecastIssuedAt);
    expect(early[0]?.reading.forecastEtaHours).toBe(late[0]?.reading.forecastEtaHours);
  });

  it('carries the forecast evidence a DRAFT must state: category, lead time, vintage and a classified likelihood', () => {
    const spec = seededForecastSpec();
    const { reading } = spec;
    expect(reading.forecastCategory).toBeDefined();
    expect(reading.forecastEtaHours).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(reading.forecastIssuedAt ?? ''))).toBe(false);
    expect(reading.forecastLikelihood).toBeDefined();
    expect(reading.forecastLikelihood?.likelihoodClass).toBeDefined();
    // The class never travels without the source value that produced it (Art. XII / FEV-9).
    expect(reading.forecastLikelihood?.rawValue).toBeDefined();
    expect(spec.sourceId).toBeDefined(); // provenance → the triggering SOURCE_RECORD (F8/Art. XI)
  });
});

describe('the seeded forecast rule FIRES through the real composition root (FR-LD-15)', () => {
  it('puts the anticipatory DRAFT into the alert store the running app serves', async () => {
    const features = buildFeatureDeps({ clock });
    const alerts = await features.interop.alerts.list();

    const forecast = alerts.find((a) => String(a.id) === FORECAST_ALERT_ID);
    expect(forecast, `${FORECAST_ALERT_ID} is absent — the forecast path is unreachable again (F-81)`).toBeDefined();
    expect(String(forecast?.incidentId)).toBe(FORECAST_INCIDENT_ID);
    expect(String(forecast?.thresholdRuleId)).toBe(FORECAST_RULE_ID); // rule → alert traceability (EV6)
  });

  it('produces a DRAFT and NEVER an ACTUAL — a fire cannot mint a publishable alert (Art. XIII)', async () => {
    const alerts = await buildFeatureDeps({ clock }).interop.alerts.list();
    expect(alerts.length).toBeGreaterThan(0); // otherwise the loop below would be vacuous
    for (const alert of alerts) {
      expect(alert.capStatus, `${String(alert.id)} was computed as ${alert.capStatus}`).toBe('DRAFT');
      expect(alert.approvedBy).toBeUndefined(); // promotion requires an authenticated human, not a threshold
      expect(alert.sentAt).toBeUndefined();
    }
  });

  it('is ANTICIPATORY: the DRAFT exists only because of the FORECAST target', async () => {
    // Prove the negative that makes the claim meaningful — remove the forecast rules and the alert is gone,
    // so it cannot be coming from the observed (GAUGE_CATEGORY / HAZARD_BUFFER) rules.
    const withoutForecast = { ...DEFAULT_FEATURE_SEED };
    delete (withoutForecast as { forecastThresholds?: unknown }).forecastThresholds;
    const alerts = await buildFeatureDeps({ clock, seed: withoutForecast }).interop.alerts.list();
    expect(alerts.some((a) => String(a.id) === FORECAST_ALERT_ID)).toBe(false);
    // …while the observed CA rule still fires, so the composition itself was not broken by the removal.
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('is deterministic in the injected clock — the same instant composes the same DRAFT set', async () => {
    const a = await buildFeatureDeps({ clock }).interop.alerts.list();
    const b = await buildFeatureDeps({ clock }).interop.alerts.list();
    expect(a.map((x) => String(x.id)).sort()).toEqual(b.map((x) => String(x.id)).sort());
  });
});
