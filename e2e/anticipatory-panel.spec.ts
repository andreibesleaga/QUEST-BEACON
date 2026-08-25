// BEACON — Anticipatory Action panel, in a REAL browser (D7; ADR-034, F-47).
//
// SKIPPED BY DEFAULT, ON PURPOSE. The panel ships display-gated OFF (`FEATURE_ANTICIPATORY_PANEL=off`), so
// the default build contains neither the tab trigger nor the panel body and there is nothing here to assert.
// A spec that FAILED in that build would be a spec that punishes the shipped default; a spec that SKIPS
// records honestly that this surface was verified under the flag it needs.
//
// Run it the way it was verified:
//   FEATURE_ANTICIPATORY_PANEL=on NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL=on \
//     rm -rf .next && ./node_modules/.bin/playwright test e2e/anticipatory-panel.spec.ts
//
// NOTE: turning the flag on necessarily changes the COP screenshot (a new tab trigger in the SitRep dock),
// so a flag-ON run of `e2e/visual.spec.ts` is EXPECTED to fail until the baseline is regenerated. That is
// the cost F-94 already priced for the Outlook section, and it is why the flag ships off.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { disableWebGL, selectRegion, waitForTruthPicture } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe('Anticipatory Action panel (flag ON)', () => {
  test.skip(
    process.env.NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL !== 'on',
    'ships display-gated off (FEATURE_ANTICIPATORY_PANEL=off) — run with the flag on to verify this surface',
  );

  test.beforeEach(async ({ context, page }) => {
    await disableWebGL(context);
    await page.goto('/');
    await waitForTruthPicture(page);
    await page.getByRole('tab', { name: /anticipatory/i }).click();
  });

  test('a region with no recorded forecast shows a LABELLED reason, never a blank board', async ({ page }) => {
    // Default region is us-ca: a protocol ships for it, recorded forecast runs do not.
    const panel = page.getByTestId('anticipatory-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/No recorded forecast for this protocol/i);
    await expect(panel).toContainText(/no wired live ensemble source/i);
  });

  test('the Danube protocol renders the ENGINE evaluation, labelled FIXTURE and never LIVE', async ({ page }) => {
    await selectRegion(page, 'ro');
    const panel = page.getByTestId('anticipatory-panel');
    await expect(panel).toBeVisible();
    // Two recorded runs replayed ⇒ two evaluation cycles, oldest first.
    await expect(page.getByTestId('anticipatory-cycle')).toHaveCount(2);
    // The engine's own figures: 37 of 51 members over 6,500 at the READINESS gate (run 1).
    await expect(page.getByTestId('anticipatory-members').first()).toHaveText(
      /37 of 51 forecast members over 6,500 cubic metres per second/,
    );
    await expect(page.getByTestId('anticipatory-lead-time').first()).toContainText(/110/);
    // Honesty: the tier, the replay note, and the absence of any live claim.
    await expect(panel).toContainText('FIXTURE');
    await expect(page.getByTestId('anticipatory-replay-note')).toContainText(/Not live data/i);
    await expect(panel).toContainText(/NOT a calibrated probability and NOT a chance of occurrence/i);
    await expect(panel).toContainText('ILLUSTRATIVE');
  });

  test('a fired rung and a not-yet-fired rung are distinguishable by TEXT, not colour alone', async ({ page }) => {
    await selectRegion(page, 'ro');
    const firstCycle = page.getByTestId('anticipatory-cycle').first();
    await expect(firstCycle).toContainText('Fired');
    await expect(firstCycle).toContainText('Not fired');
  });

  test('Art. XIII: the panel offers no control that could act, and says a human must approve', async ({ page }) => {
    await selectRegion(page, 'ro');
    const panel = page.getByTestId('anticipatory-panel');
    await expect(panel.getByRole('button')).toHaveCount(0);
    await expect(panel.getByRole('link')).toHaveCount(0);
    await expect(page.getByTestId('anticipatory-approval')).toContainText(/Awaiting human approval by/i);
    await expect(panel).toContainText(/Nothing on this panel dispatches a resource or emits a public alert/i);
  });

  test('has no serious/critical WCAG 2.2 AA violations', async ({ page }, testInfo) => {
    await selectRegion(page, 'ro');
    await expect(page.getByTestId('anticipatory-panel')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-testid="anticipatory-panel"]').withTags(TAGS).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    await testInfo.attach('axe-anticipatory.json', {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });
    expect(blocking, `serious/critical: ${blocking.map((v) => v.id).join(', ') || 'none'}`).toEqual([]);
  });
});
