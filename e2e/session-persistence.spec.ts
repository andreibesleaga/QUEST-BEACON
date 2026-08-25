// BEACON — session persistence across reload (S3·U3). NON-VISUAL: proves the auth/session slice
// rehydrates from sessionStorage after a reload of the same tab.
//
// "Dev-login" here is the AUTH_DEV_TRUST_HEADER demo path this offline gate profile runs on (see
// playwright.config.ts): the toolbar role switcher sets the acting role, and every API call carries it as
// `x-beacon-role` — the same spoofable-by-design dev identity the gates use everywhere. The token-minting
// dev-IdP control (NEXT_PUBLIC_AUTH_DEV_LOGIN) is deliberately NOT depended on: it is unpinned in the gate
// profile, so a spec built on it would mean different things on different machines.
//
// The medium is asserted too: the session must live in sessionStorage and ONLY sessionStorage — a
// localStorage survivor would outlive the tab, which is exactly what the design forbids.
import { test, expect } from '@playwright/test';
import { disableWebGL, waitForTruthPicture } from './helpers.js';

/** Must match SESSION_STORAGE_KEY in app/_lib/store.ts. */
const SESSION_KEY = 'beacon.session';

// Like 12 of the other 13 specs: WebGL off ⇒ MapView renders its labelled accessible fallback, which is
// the branch waitForTruthPicture asserts (the cached headless chromium DOES have WebGL, so without this
// the REAL canvas mounts, no MapFeatureList exists, and the first wait times out — how this spec failed
// its first-ever run, 2026-08-10).
test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

test.describe('session persistence (sessionStorage)', () => {
  test('a dev-login role survives a reload of the same tab', async ({ page }) => {
    await page.goto('/');
    await waitForTruthPicture(page);

    // Least privilege before anyone signs in.
    await expect(page.getByTestId('role-switcher')).toHaveValue('PUBLIC');

    // Dev-login as VERIFIER via the demo role switcher (the AUTH_DEV_TRUST_HEADER identity).
    await page.getByTestId('role-switcher').selectOption('VERIFIER');
    await expect(page.getByTestId('role-switcher')).toHaveValue('VERIFIER');

    await page.reload();
    await waitForTruthPicture(page);

    // The role survived the reload — rehydrated from sessionStorage, not defaulted back to PUBLIC.
    await expect(page.getByTestId('role-switcher')).toHaveValue('VERIFIER');

    // The persistence medium is sessionStorage BY DESIGN; nothing may land in localStorage.
    const stored = await page.evaluate(
      (key) => ({
        session: window.sessionStorage.getItem(key),
        local: window.localStorage.getItem(key),
      }),
      SESSION_KEY,
    );
    expect(stored.local).toBeNull();
    expect(stored.session).not.toBeNull();
    expect(JSON.parse(stored.session ?? '{}')).toMatchObject({ actorRole: 'VERIFIER' });
  });
});
