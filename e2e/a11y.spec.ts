// BEACON — S06 axe WCAG 2.2 AA gate (F13). Scans the REAL COP + key interactive surfaces for
// serious/critical accessibility violations. Both themes are covered by the desktop-dark / desktop-light
// projects (colorScheme is set per-project). Scans are gated behind the app's own rendered truth picture,
// so a runtime failure surfaces as a failed wait (honest) rather than a trivially-clean scan of a blank page.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { disableWebGL, waitForTruthPicture } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

interface AxeViolation {
  readonly id: string;
  readonly impact?: string | null;
}
function seriousOrCritical(violations: readonly AxeViolation[]): AxeViolation[] {
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test('COP page has no serious/critical WCAG 2.2 AA violations', async ({ page }, testInfo) => {
  await page.goto('/');
  await waitForTruthPicture(page);

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = seriousOrCritical(results.violations);
  // Report the full impact breakdown for the audit (moderate/minor are logged, not gating).
  await testInfo.attach('axe-cop.json', {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  expect(blocking, `serious/critical: ${blocking.map((v) => v.id).join(', ') || 'none'}`).toEqual([]);
});

test('Command palette (dialog) has no serious/critical violations', async ({ page }) => {
  await page.goto('/');
  await waitForTruthPicture(page);
  await page.getByTestId('command-palette-trigger').click();
  // cmdk's outer dialog wrapper has no visible box; assert the actual search input (the interactive surface).
  await expect(page.getByPlaceholder(/jump to a region/i)).toBeVisible();

  // Scope the scan to the open palette so it audits the palette itself (the COP-wide scan is a separate test).
  const results = await new AxeBuilder({ page }).include('[cmdk-dialog]').withTags(TAGS).analyze();
  const blocking = seriousOrCritical(results.violations);
  expect(blocking, `serious/critical: ${blocking.map((v) => v.id).join(', ') || 'none'}`).toEqual([]);
});

test('SOS intake form has no serious/critical violations', async ({ page }) => {
  await page.goto('/');
  await waitForTruthPicture(page);
  await page.getByRole('tab', { name: /report sos/i }).click();
  await expect(page.getByTestId('sos-form')).toBeVisible();

  const results = await new AxeBuilder({ page }).include('[data-testid=sos-form]').withTags(TAGS).analyze();
  const blocking = seriousOrCritical(results.violations);
  expect(blocking, `serious/critical: ${blocking.map((v) => v.id).join(', ') || 'none'}`).toEqual([]);
});

test('Layers popover has no serious/critical violations', async ({ page }) => {
  await page.goto('/');
  await waitForTruthPicture(page);
  await page.getByRole('button', { name: 'Layers' }).click();
  await expect(page.getByTestId('layer-toggle-panel')).toBeVisible();

  // Scope to the popover contents (the COP-wide scan is the separate COP-page test).
  const results = await new AxeBuilder({ page }).include('[data-testid=layer-toggle-panel]').withTags(TAGS).analyze();
  const blocking = seriousOrCritical(results.violations);
  expect(blocking, `serious/critical: ${blocking.map((v) => v.id).join(', ') || 'none'}`).toEqual([]);
});
