// BEACON — S06 Gate-8 golden-path e2e (E8·Gate-8; the rubric headline flow: monitor → assess → decide → act).
// Drives the REAL running COP (offline, in-memory seed) for EVERY SHIPPED ZONE — the zone list is derived
// from config/regions.json (helpers.ts `SHIPPED_REGIONS`), so all five zones (us-ca, ro, es, gr, ph) walk the
// same path and a sixth zone gets one for free (finding F-72: this file used to iterate a hand-authored
// two-entry map, so three of the five zones the entrant claims on camera had never run in a browser).
// WebGL is disabled so the deterministic computed geometry is asserted via the accessible MapFeatureList
// fallback (see helpers.ts / S06_BROWSER_GATES.md). No route stubbing — this exercises the app as shipped.
//
// Nothing zone-specific is authored here either: each zone's expected feature ids and its coarse/precise PII
// pair are read from the app's own `GET /regions/:id/map` wire, so every zone is asserted against ITS OWN
// seeded geometry rather than against a generic "some row exists" (which would pass on an empty map).
//
// Determinism: the 4 projects share ONE in-memory dev server, so the suite runs with workers:1
// (playwright.config.ts). Verify-a-report approves the first PENDING queue row (always ≥1 after an SOS
// submit). The one-shot DRAFT→ACTUAL UI promotion (the seeded us-ca draft alert) is exercised once
// in a dedicated desktop-dark test; the constitutional gate itself is asserted on every project via API.
import { test, expect } from '@playwright/test';
import {
  disableWebGL,
  waitForTruthPicture,
  selectRegion,
  escalateToVerifier,
  featureList,
  expectedFeatureLabels,
  fetchMapWire,
  piiPair,
  SHIPPED_REGIONS,
} from './helpers.js';

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

for (const region of SHIPPED_REGIONS) {
  const id = region.id;
  test(`golden path — ${id} (${region.name})`, async ({ page }) => {
    // The zone's OWN geometry, straight off the wire the COP renders (never hand-authored per zone).
    const wire = await fetchMapWire(page.request, id);
    const labels = expectedFeatureLabels(wire);
    expect(
      labels.length,
      `${id} projects NO map features — an empty COP is a failure, not a pass`,
    ).toBeGreaterThan(0);

    // ── MONITOR (as PUBLIC, least privilege) ───────────────────────────────────
    await page.goto('/');
    await selectRegion(page, id);
    await waitForTruthPicture(page);

    // Real computed geometry present in the accessible list (the deterministic core, Art. XII) — EVERY
    // feature the server projected for this zone, not merely "a row".
    for (const label of labels) {
      await expect(
        featureList(page),
        `${id} feature ${label} missing from the accessible list`,
      ).toContainText(label);
    }

    // Freshness (FR-2/U4): the Layers popover renders each layer's honest FreshnessBadge (MOCK → "Unavailable").
    await page.getByRole('button', { name: 'Layers' }).click();
    await expect(page.getByTestId('layer-toggle-panel')).toBeVisible();
    await expect(page.getByText(/Unavailable|Live|Stale/).first()).toBeVisible();
    await page.getByTestId('layer-toggle-panel').getByRole('checkbox').first().click(); // monitor interaction
    await page.keyboard.press('Escape');

    // Provenance (F1): the SitRep provenance control opens the SOURCE_RECORD list.
    await page
      .getByTestId('sitrep-panel')
      .getByRole('button', { name: /provenance/i })
      .click();
    await expect(page.getByText(/firms|glofas|open-meteo|MOCK/i).first()).toBeVisible();
    await page.keyboard.press('Escape');

    // ── ASSESS (F2 grounding + COMPUTED trend/priorities) ──────────────────────
    const sitrep = page.getByTestId('sitrep-panel');
    await expect(sitrep).toBeVisible();
    await expect(sitrep.getByText(/trend/i).first()).toBeVisible(); // trend rendered (deterministic-only rung too)
    await expect(sitrep.getByText(/priorities/i).first()).toBeVisible();
    await expect(sitrep.getByRole('list', { name: /ranked priorities/i })).toBeVisible();
    // Per-field citation chips present (each SitRep field cites a SOURCE_RECORD) and NO uncited-error marker (F2).
    await expect(sitrep.getByText(/firms|glofas|open-meteo/i).first()).toBeVisible();
    await expect(page.getByTestId('uncited-field')).toHaveCount(0);

    // ── DECIDE ─────────────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: /decision/i }).click();
    const decision = page.getByRole('region', { name: /decision support/i });
    await expect(decision).toBeVisible();
    await expect(decision.getByText(/deterministic figures/i)).toBeVisible(); // engine numbers beside narration
    await expect(page.getByText(/human approval is required/i)).toBeVisible();

    // Draft-alert review is reachable; as PUBLIC it exposes NO approve control (GET /alerts is 403 → empty).
    await page.getByRole('tab', { name: /draft alerts/i }).click();
    await expect(page.getByTestId('draft-alert-review')).toBeVisible();
    await expect(
      page.getByTestId('draft-alert-review').getByRole('button', { name: /approve/i }),
    ).toHaveCount(0);

    // ── ACT · part 1 (as PUBLIC) — SOS submit + RBAC/PII negatives ─────────────
    await page.getByRole('tab', { name: /report sos/i }).click();
    const sos = page.getByTestId('sos-form');
    await expect(sos).toBeVisible();
    await sos
      .getByRole('textbox', { name: /what is happening/i })
      .fill(`SOS ${id}: trapped near the hazard, need help`);
    const submit = page.getByTestId('sos-submit');
    await expect(submit).toBeDisabled(); // consent gates submit (EV4)
    await sos.getByRole('checkbox').check();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText(/report received/i)).toBeVisible();

    // As PUBLIC the verifier queue exposes NO approve control (Art. XIII).
    await page.getByRole('tab', { name: /verify/i }).click();
    await expect(page.getByTestId('verifier-queue')).toBeVisible();
    await expect(page.getByTestId('verify-report-btn')).toHaveCount(0);

    // Art. XIV: PUBLIC never sees precise PII geometry — only the generalized report location. The pair is
    // DERIVED per zone (the same map fetched as PUBLIC and as RESPONDER), so any zone that seeds a report
    // with a precise geometry is covered automatically; a zone that seeds none has nothing to assert here.
    const pii = await piiPair(page.request, id);
    if (pii !== undefined) {
      await expect(featureList(page)).not.toContainText(pii.precise); // responder-only coord
      await expect(featureList(page)).toContainText(pii.coarse); // coarse public coord
    }

    // ── ACT · part 2 (escalate to VERIFIER) — verify a report (HITL) ───────────
    await escalateToVerifier(page, id);

    // Art. XIV: a responder-level principal now DOES see the precise report geometry.
    if (pii !== undefined) {
      await expect(featureList(page)).toContainText(pii.precise);
    }

    // The VERIFIER queue is populated; approve the first pending report → it transitions to VERIFIED.
    await page.getByRole('tab', { name: /verify/i }).click();
    const queue = page.getByTestId('verifier-queue');
    await expect(page.getByTestId('verify-report-btn').first()).toBeVisible();
    const pendingRow = queue
      .locator('li')
      .filter({ has: page.getByTestId('verify-report-btn') })
      .first();
    await pendingRow.getByTestId('verify-report-btn').click();
    await expect(pendingRow.getByText('VERIFIED')).toBeVisible(); // server-confirmed (optimistic rolls back on error)

    // As VERIFIER the DRAFT-alerts surface is reachable (HITL review). The computed DRAFT's presence +
    // actual promotion are one-shot (single seeded alert on a shared server) and are asserted in the
    // dedicated one-shot test below, which runs before the promotion consumes it.
    await page.getByRole('tab', { name: /draft alerts/i }).click();
    await expect(page.getByTestId('draft-alert-review')).toBeVisible();
  });
}

// One-shot: the single seeded DRAFT alert promotes to ACTUAL exactly once (shared in-memory server).
// Exercise the real HITL promotion click on a single project so it is deterministic and not a cross-worker
// race. The gate that MUST hold on every run is asserted separately (API test below + PUBLIC UI above).
test('DRAFT→ACTUAL alert promotion via the VERIFIER UI (HITL, one-shot)', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-dark',
    'one-shot promotion — run once to avoid state races',
  );
  await page.goto('/');
  await selectRegion(page, 'us-ca');
  await waitForTruthPicture(page);
  await escalateToVerifier(page, 'us-ca');
  await page.getByRole('tab', { name: /draft alerts/i }).click();
  const review = page.getByTestId('draft-alert-review');
  // The computed alert is listed with a DRAFT state badge and a HITL approve control (fresh server).
  // Scoped to the us-ca incident by name: GET /alerts is deployment-wide, so the queue also carries the RO
  // FORECAST draft (F-81) and `.first()` alone would be an ordering assumption, not an identification.
  const alertRow = review.locator('li').filter({ hasText: 'us-ca-wildfire-demo' }).first();
  await expect(alertRow).toContainText('DRAFT');
  const approveBtn = alertRow.getByRole('button', { name: /review.*approve/i });
  await expect(approveBtn).toBeVisible();
  await approveBtn.click();
  // The HITL approve promotes the alert: its state badge flips DRAFT → ACTUAL (GET /alerts refetch).
  await expect(alertRow).toContainText('ACTUAL', { timeout: 10_000 });
  await expect(alertRow).not.toContainText('DRAFT');
});

// The DRAFT→ACTUAL promotion gate is enforced server-side and requires an authenticated VERIFIER/EM.
// Asserted against the app's OWN API — the same handler the COP calls — proving the public-action barrier
// holds regardless of the client. Deterministic: PUBLIC is ALWAYS 403 (RBAC is checked before alert state).
//
// The VERIFIER half deliberately targets an alert id that does NOT exist: `handleAlertApprove` checks the
// role BEFORE loading the alert (interop.ts), so a VERIFIER getting 404 NOT_FOUND — not 403 — proves RBAC
// passed while MUTATING NOTHING. The previous version posted approve on the real seeded alert with a
// tolerant `.not.toBe(403)`, which made this test the suite's second promoter of `ca-alert-draft-1`
// (behind the one-shot UI click above) — a mutation a gate test has no business performing.
test('DRAFT→ACTUAL promotion requires an authenticated role at the API (Art. XIII)', async ({
  request,
}) => {
  const asPublic = await request.post('/api/v1/alerts/ca-alert-draft-1/approve');
  expect(asPublic.status()).toBe(403);
  expect(JSON.stringify(await asPublic.json())).toMatch(/FORBIDDEN|requires VERIFIER/i);

  const asVerifier = await request.post('/api/v1/alerts/e2e-no-such-alert/approve', {
    headers: { 'x-beacon-role': 'VERIFIER' },
  });
  expect(asVerifier.status()).toBe(404); // past RBAC (403 would mean the role was refused), into the lookup — and nothing mutated
  expect(JSON.stringify(await asVerifier.json())).toMatch(/NOT_FOUND/i);
});
