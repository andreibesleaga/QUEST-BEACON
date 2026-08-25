// BEACON — S06 TTTP perf gate (F14). Measures time-to-truth-picture: navigation start → the COP shows its
// first fully-provenanced picture (computed map geometry + SitRep provenance surfaced). Budget < 10_000 ms.
// Measured for EVERY SHIPPED ZONE — the list is derived from config/regions.json (helpers.ts), so es/gr/ph
// now carry the same budget us-ca and ro always did, and a sixth zone is measured with no edit here (F-72).
// Deterministic offline seed → fast. Measured against a PRODUCTION build (next build && next start — the
// playwright.config webServer), so the number is a fair perf claim, not a dev-server artifact. Real measured
// ms per region are reported in docs/audit/S06_BROWSER_GATES.md.
import { test, expect } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { disableWebGL, waitForTruthPicture, selectRegion, SHIPPED_REGIONS } from './helpers.js';

const BUDGET_MS = 10_000;

// ── NFR-F2 / NFR-F3 build-size budgets (finding F-415) ────────────────────────────────────────────────
//
// `docs/requirements/EARS_FINAL_VERSION.md:325` states NFR-F2 is "Verified by: build-size check in perf
// spec". **There was no such check.** This file was 36 lines and measured only TTTP. The verification was
// asserted in the requirements register and implemented nowhere — the same "code exists, nothing runs it"
// class as F-53/F-320, but one level up: the *claim of verification* was the thing that did not exist.
//
// HONEST SCOPE CHANGE. NFR-F2 is written as "**Added** client JS ≤ +300 KB gzipped", and that is not
// measurable retroactively: no pre-feature baseline was ever recorded, so there is no "before" to subtract.
// Rather than fabricate one, this enforces what CAN be measured and is what the budget actually protects —
// a TOTAL ceiling, ratcheted at the value measured on 2026-08-01 plus modest headroom. Growth now fails
// here instead of being discovered on a judge's laptop.
//
// The JS figure gzips EVERY emitted chunk, which is a superset of what any single route loads (Next
// code-splits, and `next build` reported 756 kB First Load JS for `/`). A superset is the right choice for
// a ratchet: it cannot under-report, and it catches a regression in a lazily-loaded chunk too.
const BUILD_DIR = '.next';
/** Measured 886.2 KB gzipped on 2026-08-01. Ceiling carries ~7% headroom — RAISE ONLY WITH A REASON. */
const JS_GZIP_CEILING_KB = 950;
/**
 * NFR-F3 states the budget itself: bundled fonts ≤ 1 MB. Measured **502.1 KB across 13 files** against a
 * CLEAN build on 2026-08-01 — roughly half the budget, with real headroom for another script.
 *
 * Recording how that number was nearly wrong, because the same trap will catch the next person: a first
 * measurement over a `.next` directory that had NOT been cleaned read 903.5 KB across 19 files, and would
 * have been reported as "88% of budget, one script from breaching". Stale hashed assets from earlier builds
 * accumulate in `static/media` and are indistinguishable from current ones by name. **Always measure a
 * build size after `rm -rf .next`** — which is exactly what this spec does, since playwright.config's
 * webServer builds fresh.
 */
const FONT_CEILING_KB = 1024;

/** Every file under `dir` (recursively) whose name ends with `ext`. */
function filesUnder(dir: string, ext: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(filesUnder(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

test.describe('build-size budgets (NFR-F2 / NFR-F3)', () => {
  test('client JS stays under the gzipped ceiling', () => {
    const chunks = filesUnder(join(BUILD_DIR, 'static', 'chunks'), '.js');
    // Guard the guard: an empty glob would make this pass vacuously and silently retire the budget.
    expect(chunks.length, 'no built JS chunks found — this budget would be vacuous').toBeGreaterThan(0);
    const kb = chunks.reduce((sum, f) => sum + gzipSync(readFileSync(f)).byteLength, 0) / 1024;
    process.stdout.write(`[BUNDLE] client JS gzipped: ${kb.toFixed(1)} KB (ceiling ${JS_GZIP_CEILING_KB})\n`);
    expect(kb, `client JS is ${kb.toFixed(1)} KB gzipped`).toBeLessThan(JS_GZIP_CEILING_KB);
  });

  test('bundled fonts stay under 1 MB (NFR-F3)', () => {
    const fonts = filesUnder(join(BUILD_DIR, 'static', 'media'), '.woff2');
    expect(fonts.length, 'no bundled fonts found — this budget would be vacuous').toBeGreaterThan(0);
    const kb = fonts.reduce((sum, f) => sum + statSync(f).size, 0) / 1024;
    process.stdout.write(`[BUNDLE] fonts: ${kb.toFixed(1)} KB across ${fonts.length} files (ceiling ${FONT_CEILING_KB})\n`);
    // ~49% of budget with 14 locales, so there is genuine room for another script subset. The ceiling
    // exists so that spending it becomes a visible decision rather than a silent regression.
    expect(kb, `bundled fonts total ${kb.toFixed(1)} KB`).toBeLessThan(FONT_CEILING_KB);
  });
});

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

for (const region of SHIPPED_REGIONS) {
  const id = region.id;
  test(`TTTP < 10s — ${id} (${region.name})`, async ({ page }, testInfo) => {
    const start = Date.now();
    await page.goto('/', { waitUntil: 'commit' });
    await selectRegion(page, id);
    await waitForTruthPicture(page);
    const tttp = Date.now() - start;

    // Cross-check against the browser's own navigation timing (first paint sanity).
    const navMs = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return nav ? Math.round(nav.responseEnd - nav.startTime) : null;
    });

    testInfo.annotations.push({ type: 'tttp-ms', description: `${id}: ${tttp} (nav responseEnd ${navMs})` });
    process.stdout.write(`[TTTP] ${id} (${region.name}): ${tttp} ms  (nav responseEnd ${navMs} ms)\n`);
    expect(tttp, `TTTP for ${id} was ${tttp} ms`).toBeLessThan(BUDGET_MS);
  });
}
