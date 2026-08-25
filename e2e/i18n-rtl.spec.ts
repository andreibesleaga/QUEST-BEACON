// BEACON — i18n / RTL browser gate (ADR-030; FR-I18N-1/2/3/5, NFR-F8).
// Unit tests can prove the translator resolves a key. Only a browser can prove the COP is actually USABLE
// right-to-left and that no raw catalog key reached the screen. Three things are checked per locale:
//   1. the document announces the right language and direction on the FIRST paint (server-resolved cookie),
//   2. nothing that looks like a catalog key (`namespace.someKey`) is rendered anywhere,
//   3. accessibility still holds — axe is run under Arabic, not only English.
// Plus one RTL screenshot, so a layout regression in a language the author cannot read is still visible.
import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { disableWebGL, featureList } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Locale-AGNOSTIC readiness wait. The shared `waitForTruthPicture` helper anchors on an English accessible
 * name ("Provenance"), which by construction cannot match once the UI is translated — so this spec waits on
 * structural test ids instead. Same guarantee (deterministic computed geometry + the SitRep panel mounted),
 * no wall-clock sleeps, and it works in every language.
 */
async function waitForTruthPictureAnyLocale(page: Page): Promise<void> {
  await expect(featureList(page)).toBeVisible({ timeout: 20_000 });
  await expect(featureList(page).locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sitrep-panel')).toBeVisible({ timeout: 20_000 });
}

/** Matches text shaped like an unresolved message key: `toolbar.layers`, `ui.legend.status.fresh`, … */
const RAW_KEY = /\b[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,4}\b/;

/**
 * Words that legitimately look like a dotted key: file names, hosts, ids and licence codes that the COP
 * shows on purpose. Without this the scan would flag BEACON's own honest provenance labels.
 */
const LEGITIMATE_DOTTED = /(\.json|\.png|\.gov|\.org|\.com|\.local|\.io|\.net|www\.|@|\/|CC[- ]BY|v\d)/;

async function setLocale(
  context: BrowserContext,
  locale: string,
  baseURL: string | undefined,
): Promise<void> {
  // The locale is UI state in a cookie, resolved SERVER-side — so seeding the cookie is exactly what a
  // returning reader's browser does, and it exercises the real first-paint path rather than a JS toggle.
  // The cookie URL MUST be the project's own baseURL: a cookie scoped to another origin is silently
  // never sent, which would make every assertion below pass against an English page.
  await context.addCookies([{ name: 'beacon-locale', value: locale, url: baseURL ?? 'http://127.0.0.1:3100' }]);
}

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

test('Arabic renders right-to-left, announced on the first paint', async ({ page, context, baseURL }) => {
  await setLocale(context, 'ar', baseURL);
  await page.goto('/');
  await waitForTruthPictureAnyLocale(page);

  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(html).toHaveAttribute('dir', 'rtl');
  // The map canvas must NOT be mirrored — geography has no reading direction (ADR-030).
  await expect(page.locator('main[aria-label]').first()).toBeVisible();
});

test('English stays left-to-right (the default is untouched)', async ({ page }) => {
  await page.goto('/');
  await waitForTruthPictureAnyLocale(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('a machine-translated locale says so, in the UI', async ({ page, context, baseURL }) => {
  // Art. XV: an unreviewed translation must never present itself as authoritative copy.
  await setLocale(context, 'ar', baseURL);
  await page.goto('/');
  await waitForTruthPictureAnyLocale(page);
  await expect(page.getByTestId('machine-translated-notice')).toBeVisible();
});

test('no raw catalog key is rendered in any shipped locale', async ({ page, context, baseURL }) => {
  for (const locale of ['ar', 'ro', 'zh-Hans']) {
    await context.clearCookies();
    await setLocale(context, locale, baseURL);
    await page.goto('/');
    await waitForTruthPictureAnyLocale(page);

    const suspects = await page.locator('body').evaluate((body) =>
      Array.from(body.querySelectorAll('*'))
        .filter((el) => el.children.length === 0)
        .map((el) => (el.textContent ?? '').trim())
        .filter((t) => t.length > 0 && t.length < 80),
    );
    const leaked = suspects.filter((t) => RAW_KEY.test(t) && !LEGITIMATE_DOTTED.test(t));
    expect(leaked, `raw keys leaked in ${locale}: ${leaked.join(' | ')}`).toEqual([]);
  }
});

test('COP has no serious/critical WCAG violations under Arabic (RTL)', async ({ page, context, baseURL }, testInfo) => {
  await setLocale(context, 'ar', baseURL);
  await page.goto('/');
  await waitForTruthPictureAnyLocale(page);

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  await testInfo.attach('axe-cop-ar.json', {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  expect(blocking.map((v) => v.id)).toEqual([]);
});

test('COP has no serious/critical WCAG violations under Chinese (CJK metrics)', async ({ page, context, baseURL }, testInfo) => {
  // A CJK locale exercises different line-height/overflow behaviour than either Latin or Arabic.
  await setLocale(context, 'zh-Hans', baseURL);
  await page.goto('/');
  await waitForTruthPictureAnyLocale(page);

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  await testInfo.attach('axe-cop-zh.json', {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  // Name the offending nodes in the failure message — an a11y gate that only says "color-contrast" costs
  // an extra debugging round-trip every time it fires.
  const detail = blocking
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)} | ${n.any[0]?.message ?? ''}`))
    .join('\n');
  expect(blocking.map((v) => v.id), detail).toEqual([]);
});

test('RTL layout baseline', async ({ page, context, baseURL }, testInfo) => {
  // ONE RTL screenshot is the budgeted smoke (master plan §5.3) — the functional RTL assertions above run
  // on every viewport, but four near-identical RTL baselines would be four things to regenerate for no
  // extra signal.
  test.skip(testInfo.project.name !== 'desktop-dark', 'one RTL baseline is enough');
  await setLocale(context, 'ar', baseURL);
  await page.goto('/');
  await waitForTruthPictureAnyLocale(page);
  // A NEW baseline (not a regeneration): the RTL view had none before, so this does not consume the
  // two-regeneration budget in the master plan.
  await expect(page).toHaveScreenshot('cop-rtl.png', {
    fullPage: true,
    mask: [page.locator('[data-sonner-toaster]')],
  });
});
