// BEACON — E2E screenshot capture for docs/E2E_TESTING_PLAYBOOK.md (dev tool, not a gate). Drives the REAL
// running COP (offline seed, no keys, no network) and saves PNGs of the golden-path states to
// docs/screenshots/ for EVERY SHIPPED ZONE (list derived from config/regions.json — F-72), across the playwright.config
// project matrix (desktop-dark / desktop-light / tablet / phone → dark+light × breakpoints). Reuses the
// deterministic helpers (WebGL neutered → the accessible MapFeatureList is captured, never a blank canvas).
// OPT-IN ONLY: playwright.config.ts `testIgnore`s this file unless `CAPTURE_SCREENSHOTS=on`, so the normal
// e2e gate never runs it (it mutates docs/screenshots/). Run deliberately:
//   `rm -rf .next && CAPTURE_SCREENSHOTS=on AUTH_DEV_TRUST_HEADER=on npx playwright test capture-screenshots`.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  disableWebGL,
  waitForTruthPicture,
  selectRegion,
  escalateToVerifier,
  SHIPPED_REGION_IDS,
} from './helpers.js';

const DIR = 'docs/screenshots';
mkdirSync(DIR, { recursive: true });

// Default: WebGL neutered → deterministic accessible MapFeatureList (doc shots never show a half-loaded
// canvas). CAPTURE_LIVE_MAP=on keeps WebGL ON for demo/"photo" captures of the REAL deck.gl/MapLibre map
// with its layers (added 2026-08-04 for the live-demo evidence pack — the map, not the fallback, is the
// point there; chromium-1228 headless has working WebGL, see webgl-smoke.spec.ts).
const LIVE_MAP = process.env.CAPTURE_LIVE_MAP === 'on';

test.beforeEach(async ({ context }) => {
  if (!LIVE_MAP) await disableWebGL(context);
});

/**
 * Truth-picture wait that matches the capture mode. The shared waitForTruthPicture asserts the accessible
 * MapFeatureList — which EXISTS ONLY when WebGL is neutered. In live-map mode the success branch renders
 * the MapLibre canvas instead (same selector webgl-smoke.spec.ts uses), so wait on that + the SitRep
 * provenance affordance, then give deck.gl a beat to paint its layers before the shot.
 */
async function waitForPicture(page: Page): Promise<void> {
  if (!LIVE_MAP) return waitForTruthPicture(page);
  await expect(page.locator('[data-testid="map-canvas"] canvas.maplibregl-canvas')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId('sitrep-panel').getByRole('button', { name: /provenance/i })).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(2_000); // deck.gl paints asynchronously; a fixed beat beats a flaky pixel probe
}

/** Save a full-page PNG named <project>-<slug>.png so dark/light/breakpoint variants never collide. */
async function shot(page: Page, project: string, slug: string): Promise<void> {
  await page.screenshot({ path: `${DIR}/${project}-${slug}.png`, fullPage: true });
}

for (const id of SHIPPED_REGION_IDS) {
  test(`screenshots — ${id}`, async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    // ── MONITOR (PUBLIC) — the Common Operating Picture ────────────────────────
    await page.goto('/');
    await selectRegion(page, id);
    await waitForPicture(page);
    await shot(page, project, `${id}-01-cop`);

    // ── ASSESS — the cited SitRep panel (deterministic-only: citation chips, trend, priorities) ──
    const sitrep = page.getByTestId('sitrep-panel');
    await expect(sitrep).toBeVisible();
    await sitrep.scrollIntoViewIfNeeded();
    await sitrep.screenshot({ path: `${DIR}/${project}-${id}-02-sitrep.png` });

    // ── DECIDE — decision support (engine figures beside citations; HITL notice) ──
    await page.getByRole('tab', { name: /decision/i }).click();
    await expect(page.getByRole('region', { name: /decision support/i })).toBeVisible();
    await shot(page, project, `${id}-03-decision`);

    // ── ACT (PUBLIC) — the consent-gated SOS form ──────────────────────────────
    await page.getByRole('tab', { name: /report sos/i }).click();
    const sos = page.getByTestId('sos-form');
    await expect(sos).toBeVisible();
    await sos.getByRole('textbox', { name: /what is happening/i }).fill(`SOS ${id}: smoke on the ridge, need guidance`);
    await shot(page, project, `${id}-04-sos`);

    // ── ACT (VERIFIER) — escalate, then the verifier queue + draft-alert review ─
    // escalateToVerifier's elevation wait reads the accessible feature list — which only exists with
    // WebGL neutered. In live-map mode do the same role-switch + region re-key inline and let the NEXT
    // assertion (the verifier queue's own visibility below) observe the elevation instead.
    if (LIVE_MAP) {
      const other = SHIPPED_REGION_IDS.find((r) => r !== id);
      if (other === undefined) throw new Error('need ≥2 shipped regions to re-key the query');
      await page.getByTestId('role-switcher').selectOption('VERIFIER');
      await selectRegion(page, other);
      await selectRegion(page, id);
    } else {
      await escalateToVerifier(page, id);
    }
    await page.getByRole('tab', { name: /verify/i }).click();
    await expect(page.getByTestId('verifier-queue')).toBeVisible();
    await shot(page, project, `${id}-05-verifier-queue`);

    await page.getByRole('tab', { name: /draft alerts/i }).click();
    await expect(page.getByTestId('draft-alert-review')).toBeVisible();
    await shot(page, project, `${id}-06-draft-alerts`);

    // ── Command palette (⌘K / Ctrl-K) — keyboard-first navigation (a11y) ───────
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    // Trigger-click is a FALLBACK for when the shortcut did not open the palette — never both. When
    // Ctrl-K succeeds the open cmdk dialog intercepts pointer events, so the old unconditional click
    // timed out against the very dialog it had just opened (found 2026-08-04 on the live capture run).
    // Probe the palette's INPUT, not the `[cmdk-dialog]` wrapper: the wrapper carries no box of its own
    // (`class=""`), so isVisible() is false on it even while the open palette is plainly on screen —
    // which is why the first version of this guard still fell through to the click.
    if (!(await page.locator('[cmdk-input]').isVisible().catch(() => false))) {
      const trigger = page.getByTestId('command-palette-trigger');
      if (await trigger.isVisible().catch(() => false)) await trigger.click();
      await page.waitForTimeout(300);
    }
    await shot(page, project, `${id}-07-command-palette`);
    await page.keyboard.press('Escape');
  });
}
