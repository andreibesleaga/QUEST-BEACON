// BEACON — the ANTICIPATORY (forecast-crossing) DRAFT alert, in a REAL browser (finding F-81).
//
// Why this file exists. `FORECAST_GAUGE_CATEGORY` (ADR-033 §6 / FEV-9) was fully implemented and fully
// unit-tested, but **no seed ever built one**, so nothing in the running app ever exercised it: a feature
// with no on-camera moment, and a claim no browser gate backed. `src/main/feature-seed.ts` now seeds one
// forecast rule for the RO flood incident, and this spec is the end-to-end proof that the path is reachable.
//
// What is asserted, and why each assertion is not vacuous:
//   1. The DRAFT exists in the RUNNING app (GET /alerts as VERIFIER) — the feature is reachable, not just tested.
//   2. It cannot have come from an OBSERVED crossing: the same server reports the zone's observed gauge
//      category as MINOR, which is BELOW the rule's MODERATE value. Only the FORECAST target can fire here.
//      (This is the strongest statement the current wire supports — see the KNOWN GAP note at the bottom.)
//   3. Art. XIII, twice: the alert is cap_status DRAFT (never ACTUAL), and promotion is refused (403) to an
//      unauthenticated PUBLIC principal at the app's OWN API. No report is anywhere in this path.
//   4. A human reviewer really SEES it: the VERIFIER's DRAFT-alert panel lists it with its DRAFT state badge
//      and a review/approve control — the HITL moment the demo needs.
//
// This spec deliberately does NOT click approve: the promotion mechanism is already exercised one-shot in
// golden-path.spec.ts, and leaving this DRAFT unpromoted keeps it available on the shared in-memory server
// for the filmed demo and keeps this spec free of order-dependent state.
import { test, expect } from '@playwright/test';
import { disableWebGL, waitForTruthPicture, selectRegion, escalateToVerifier, fetchEnvelope, fetchMapWire } from './helpers.js';

/** Seeded by `defaultForecastThresholds` in src/main/feature-seed.ts (rule `ro-forecast-crossing-rule`). */
const FORECAST_ALERT_ID = 'ro-alert-forecast-draft-1';
/**
 * The ONE seeded alert `golden-path.spec.ts` drives through the real HITL approve gate (DRAFT→ACTUAL).
 * All four Playwright projects share a single in-memory server, so by the second project this alert is
 * legitimately ACTUAL. Named here rather than inlined so the coupling between the two specs is explicit
 * instead of a silent order dependence (F-412).
 */
const GOLDEN_PATH_PROMOTED_ALERT_ID = 'ca-alert-draft-1';
const FORECAST_INCIDENT_ID = 'ro-flood-demo';
const FORECAST_REGION = 'ro';
/** The rule's threshold. The observed category must stay strictly BELOW it or assertion 2 proves nothing. */
const RULE_VALUE = 'MODERATE';
const FLOOD_CATEGORY_RANK = ['NONE', 'ACTION', 'MINOR', 'MODERATE', 'MAJOR'];

interface AlertsData {
  readonly alerts: readonly {
    readonly id: string;
    readonly state: string;
    readonly category?: string;
    readonly severity?: string;
    readonly incidentId?: string;
  }[];
}

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

test('a forecast crossing produces a DRAFT alert in the running app, and only a DRAFT (Art. XIII)', async ({
  request,
}) => {
  const envelope = await fetchEnvelope<AlertsData>(request, '/alerts', 'VERIFIER');
  const forecastAlert = envelope.data.alerts.find((a) => a.id === FORECAST_ALERT_ID);
  expect(forecastAlert, `${FORECAST_ALERT_ID} is not served — the forecast path is unreachable again`).toBeDefined();
  expect(forecastAlert?.state).toBe('DRAFT');
  expect(forecastAlert?.incidentId).toBe(FORECAST_INCIDENT_ID);

  // EVERY alert the threshold ENGINE computes is a DRAFT. A fire can never mint an ACTUAL (Art. XIII).
  //
  // F-412 — this loop used to cover the whole queue, and that made it FALSE in a correct system. The
  // `/alerts` queue lives on ONE shared in-memory server across all four Playwright projects, and
  // `golden-path.spec.ts` deliberately drives the real HITL gate on `ca-alert-draft-1`, promoting it to
  // ACTUAL. So the first project to run passed and the other three failed — an alert that an authenticated
  // human approved through the audited gate is the invariant WORKING, not a counterexample to it. The
  // file header even claimed this spec was "free of order-dependent state"; it was not.
  //
  // This is a CORRECTION, not a relaxation: the engine-authored invariant is unchanged and still covers
  // every alert nothing has approved. The one exclusion is by id, with its reason, so a NEW alert appearing
  // as ACTUAL still fails here loudly.
  const HITL_PROMOTED = new Set([GOLDEN_PATH_PROMOTED_ALERT_ID]);
  const engineAuthored = envelope.data.alerts.filter((a) => !HITL_PROMOTED.has(a.id));
  expect(engineAuthored.length, 'no engine-authored alert remains to assert on — the guard would be vacuous').toBeGreaterThan(0);
  for (const alert of engineAuthored) {
    expect(alert.state, `${alert.id} was computed as ${alert.state} — a fire may only produce a DRAFT`).toBe('DRAFT');
  }

  // The engine's own provenance is carried and labelled (Art. XVI — never an unlabelled figure).
  expect(envelope.provenance.length).toBeGreaterThan(0);
  for (const ref of envelope.provenance) expect(['LIVE', 'CACHED', 'MOCK']).toContain(ref.mode);
});

test('the DRAFT is anticipatory: the OBSERVED gauge is still below the rule threshold', async ({ request }) => {
  const wire = await fetchMapWire(request, FORECAST_REGION);
  const gauge = wire.gauges[0] as { readonly floodCategory?: string } | undefined;
  expect(gauge, 'the ro zone serves no gauge — the anticipatory claim has no observed baseline').toBeDefined();
  const observed = gauge?.floodCategory;
  expect(observed, 'the served gauge carries no observed flood category').toBeDefined();
  // Strictly below the rule's value ⇒ no OBSERVED (GAUGE_CATEGORY) rule at this threshold could have fired;
  // the DRAFT above can only have come from the FORECAST target.
  expect(
    FLOOD_CATEGORY_RANK.indexOf(observed ?? ''),
    `observed category ${String(observed)} is not below ${RULE_VALUE} — the anticipatory claim is not proven`,
  ).toBeLessThan(FLOOD_CATEGORY_RANK.indexOf(RULE_VALUE));
});

test('promoting the forecast DRAFT requires an authenticated role at the API (Art. XIII)', async ({ request }) => {
  const asPublic = await request.post(`/api/v1/alerts/${FORECAST_ALERT_ID}/approve`);
  expect(asPublic.status()).toBe(403);
  expect(JSON.stringify(await asPublic.json())).toMatch(/FORBIDDEN|requires VERIFIER/i);
});

test('a VERIFIER sees the forecast DRAFT in the review panel, with its DRAFT badge and HITL control', async ({
  page,
}) => {
  await page.goto('/');
  await selectRegion(page, FORECAST_REGION);
  await waitForTruthPicture(page);
  await escalateToVerifier(page, FORECAST_REGION);

  await page.getByRole('tab', { name: /draft alerts/i }).click();
  const review = page.getByTestId('draft-alert-review');
  await expect(review).toBeVisible();

  // The panel headline is `${severity} ${category} — ${incidentId}`, so the row is identified by incident.
  const row = review.locator('li').filter({ hasText: FORECAST_INCIDENT_ID }).first();
  await expect(row, 'the forecast DRAFT is not listed for the VERIFIER').toBeVisible();
  await expect(row).toContainText('DRAFT');
  await expect(row).not.toContainText('ACTUAL');
  await expect(row.getByRole('button', { name: /review.*approve/i })).toBeVisible();
});

// ── KNOWN GAP, recorded here so it cannot be claimed away (finding F-301) ────────────────────────────────
// The forecast EVIDENCE — lead time, expected crossing instant, forecast vintage, likelihood class + the raw
// source value behind it — is computed and carried by `DraftAlertProposal.forecast`, but it stops at the
// composition root: `buildFeatureDeps` narrows proposals to bare `Alert`s, the alert store/`GET /alerts` wire
// projects only {id,state,category,severity,incidentId}, and the `alert` table has no column for any of it.
// So a viewer sees THAT an anticipatory DRAFT exists, not WHY or HOW FAR AHEAD. Surfacing it needs
// application changes beyond a seeded rule (wire type + panel + persistence, F-44's three-mirror rule) and is
// deliberately NOT half-wired here. Until then the honest claim is exactly what this spec asserts.
