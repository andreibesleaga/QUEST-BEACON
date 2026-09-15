// BEACON — the installable COP keeps its last picture when the network goes away (ADR-047).
//
// The gate profile builds with NEXT_PUBLIC_PWA unset (off), so the app registers no worker — and, by
// design, RETIRES any worker it finds and deletes its caches on every load (the complete fallback).
// This spec therefore (1) neutralises that retirement in the page, the same way `disableWebGL` shapes a
// browser API, and (2) registers public/sw.js itself, exactly as the flag would. What it then proves is
// the worker's own behaviour in a real browser: a full offline reload still renders the truth picture
// (the accessible feature list, the SitRep's provenance) from the saved copies, and the banner says the
// picture is a saved one. Each Playwright context is fresh, so nothing here leaks into another spec.
import type { BrowserContext } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { disableWebGL, waitForTruthPicture } from './helpers.js';

/** Keep the flag-off bridge from unregistering the worker / deleting its caches for this context. */
async function keepWorkerAlive(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const container = navigator.serviceWorker;
    const original = container.getRegistrations.bind(container);
    container.getRegistrations = () => Promise.resolve([]);
    (window as unknown as { __realGetRegistrations: typeof original }).__realGetRegistrations =
      original;
    const realDelete = caches.delete.bind(caches);
    caches.delete = (name: string) =>
      name.startsWith('beacon-sw-') ? Promise.resolve(false) : realDelete(name);
  });
}

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
  await keepWorkerAlive(context);
});

test.describe('PWA offline (service worker)', () => {
  test('an offline reload serves the saved picture and says so', async ({ page, context }) => {
    await page.goto('/');
    await waitForTruthPicture(page);
    expect(await page.getByTestId('offline-banner').count()).toBe(0);

    // Register the worker the way the flag does and wait until it is ACTIVATED (not merely
    // activating: `ready` resolves at the start of activation, and a reload issued then sends the
    // page's first burst of requests before `clients.claim()` lands — uncontrolled, so unsaved). Then
    // reload so every request of the second visit passes through the worker and is saved.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { type: 'module' });
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active;
      if (worker === null) throw new Error('no active worker after ready');
      await new Promise<void>((resolve) => {
        if (worker.state === 'activated') resolve();
        else
          worker.addEventListener('statechange', () => worker.state === 'activated' && resolve());
      });
    });
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await waitForTruthPicture(page);

    // The worker saved the shell and the public picture on that controlled visit.
    const saved = await page.evaluate(async () => {
      const names = await caches.keys();
      const pages = await caches.open('beacon-sw-1-pages');
      const data = await caches.open('beacon-sw-1-data');
      return {
        names: names.filter((n) => n.startsWith('beacon-sw-')).sort(),
        shell: (await pages.match(`${location.origin}/`, { ignoreSearch: true })) !== undefined,
        data: (await data.keys()).map((r) => new URL(r.url).pathname).sort(),
        // Every saved page and data entry — the install-time shell included — is keyed by locale
        // (ADR-047), so no copy can answer another locale.
        localized: [...(await pages.keys()), ...(await data.keys())].every((r) =>
          new URL(r.url).searchParams.has('__beacon_locale'),
        ),
      };
    });
    expect(saved.names).toEqual(['beacon-sw-1-data', 'beacon-sw-1-pages', 'beacon-sw-1-static']);
    expect(saved.shell).toBe(true);
    expect(saved.localized).toBe(true);
    expect(saved.data).toContain('/api/v1/status');
    expect(saved.data).toContain('/api/v1/regions/us-ca/incidents');
    expect(saved.data).toContain('/api/v1/regions/us-ca/map');
    expect(saved.data.some((p) => /^\/api\/v1\/incidents\/[^/]+\/sitrep$/.test(p))).toBe(true);
    // Never a role-gated or auth route, whatever the page requested.
    expect(
      saved.data.some((p) =>
        /\/(reports|alerts|me|auth|stream|audit-events|threshold-rules)/.test(p),
      ),
    ).toBe(false);

    await context.setOffline(true);
    await page.reload();
    await waitForTruthPicture(page);
    const banner = page.getByTestId('offline-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-offline', 'true');
    await expect(banner).toContainText(/saved at \d{2}:\d{2}/);
    await context.setOffline(false);
  });
});
