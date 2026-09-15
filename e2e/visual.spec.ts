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
  // NOT fully deterministic, and the tolerance is what absorbs it. This comment used to claim the default
  // COP view carries no wall-clock text. It does: the status strip renders a live UTC time and a data-age
  // figure that counts minutes from the seed's fixed timestamps, so both drift on every run. They survive
  // only because `maxDiffPixelRatio: 0.02` is ~28k pixels and the drifting glyphs are a few hundred.
  // The part that is NOT absorbed is HEIGHT: a size mismatch fails outright whatever the ratio says, so the
  // day data-age gains a digit and wraps this strip to a second line, this gate fails for a reason that has
  // nothing to do with the UI. At the baseline below the line ends ~22px short of the gutter and one digit
  // costs ~10px, so it fits — for now. The durable fix is to mask the two volatile cells, which needs a
  // baseline recaptured on CI's renderer; tracked in docs/features/V2-RESUME-2026-09-12.md.
  // Animations are disabled via playwright.config.
  await expect(page).toHaveScreenshot('cop.png', {
    fullPage: true,
    // Mask the toast region defensively (sonner is portal-rendered, transient).
    mask: [page.locator('[data-sonner-toaster]')],
  });
});
