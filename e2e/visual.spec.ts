// BEACON — S06 visual-regression gate. Captures COP baselines across the project matrix
// (dark/light × desktop/tablet/phone). WebGL is disabled so the map region is the DETERMINISTIC accessible
// list rather than an opaque, frame-varying GL canvas. The screenshot is gated behind the app's own rendered
// truth picture, so a blank/crashed page fails the wait instead of minting a misleading baseline.
// NOTE: the FIRST run CREATES baselines (no regression protection yet); protection begins on the NEXT run.
import { test, expect } from '@playwright/test';
import { disableWebGL, waitForTruthPicture } from './helpers.js';

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

test('COP baseline', async ({ page }) => {
  await page.goto('/');
  await waitForTruthPicture(page);
  // Freshness relative-times live only inside the Layers popover (kept closed here), so the default COP
  // view carries no wall-clock text; animations are disabled via playwright.config. Deterministic.
  await expect(page).toHaveScreenshot('cop.png', {
    fullPage: true,
    // Mask the toast region defensively (sonner is portal-rendered, transient).
    mask: [page.locator('[data-sonner-toaster]')],
  });
});
