// BEACON — S06 browser gate for the LOGISTICS TASKING FLOW (flagship-4; FR-8/EV9; findings F-191/F-192).
//
// Why this spec exists: F-192 (the resource list 400'd on every real page load because the client sent no
// query string) and F-191 (every "Task" click tried to CREATE a task at an illegal start status) were both
// invisible to every existing test — the component tests mock the hooks, and the HTTP integration tests
// hand-build their own requests. Neither shape can observe "what a real browser actually sends". Only a
// REAL browser against the REAL server can, so the acceptance bar for that repair is asserted here: a human
// selects an incident, sees the asset registry, and walks one resource through the ENTIRE forward-only
// lifecycle, with every step confirmed by the server.
//
// DETERMINISTIC: the offline DEFAULT_FEATURE_SEED (CA wildfire incident + its seeded engines), the app's own
// state waits (never a sleep), no network. Safe to run once per project: each project's first click mints a
// NEW server-side task id, so the four projects never share a lifecycle.
import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { disableWebGL, waitForTruthPicture } from './helpers.js';

/** The domain's forward-only machine (src/domain/resource-task.ts) as the BOARD labels each step. */
const LIFECYCLE = ['PROPOSED', 'ASSIGNED', 'EN_ROUTE', 'ON_SCENE', 'CLEARED'] as const;

const SEEDED_ENGINE = 'ca-engine-1';

/** The seeded engine's LIST ROW (the <li>) — disambiguated from the tasking <select>'s identically-named
 *  <option>, which carries the same id text. */
function resourceRow(board: Locator): Locator {
  return board.locator('li').filter({ hasText: SEEDED_ENGINE }).first();
}

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

/** Open the logistics dock's Resources tab as an EM (EM sees every org's assets; RESPONDER is org-scoped). */
async function openResourcesAsEm(page: Page) {
  await page.goto('/');
  await waitForTruthPicture(page);
  // The demo role switcher is the app's own control; the resources query is keyed by role (F-201), so the
  // elevation refetches rather than serving the PUBLIC 403 from cache.
  await page.getByTestId('role-switcher').selectOption('EM');
  await page.getByRole('tab', { name: /resources/i }).click();
  const board = page.getByTestId('logistics-board');
  await expect(board).toBeVisible();
  return board;
}

test('the resource registry actually LOADS in a real browser (F-192 — it used to 400 on every page load)', async ({
  page,
}) => {
  const board = await openResourcesAsEm(page);
  // A real ROW from the offline seed (the <li>, not the <select>'s <option> — both carry the id) — proof the
  // request carried the incidentId the route hard-requires AND that the client read the response's real
  // shape (`data.resources`, not a bare array — F-200; the old hand-written mirror made rendering this list
  // a `.map is not a function` TypeError that killed the whole panel).
  await expect(resourceRow(board)).toBeVisible({ timeout: 20_000 });
  await expect(resourceRow(board)).toContainText('ENGINE');
  // The panel is NOT in its labelled error state — the failure this spec exists to prevent.
  await expect(board.getByText('Resources unavailable')).toHaveCount(0);
});

test('a human can walk a resource through the WHOLE forward-only lifecycle, server-confirmed at every step ' +
  '(F-191 — the default click used to 409 every single time)', async ({ page }) => {
  const board = await openResourcesAsEm(page);
  await expect(resourceRow(board)).toBeVisible({ timeout: 20_000 });

  await board.getByLabel('Resource to task').selectOption(SEEDED_ENGINE);
  const taskButton = board.getByRole('button', { name: 'Task' });
  const badge = board.getByTestId(`task-status-${SEEDED_ENGINE}`);

  for (const step of LIFECYCLE) {
    // The control always offers exactly ONE legal next hop, derived from the domain machine.
    await expect(board.getByLabel('Lifecycle transition')).toHaveValue(
      step === 'ASSIGNED' ? 'TASKED' : step === 'EN_ROUTE' ? 'ENROUTE' : step === 'ON_SCENE' ? 'ONSCENE' : step,
    );
    await expect(taskButton).toBeEnabled();
    await taskButton.click();
    // The badge shows only what the SERVER confirmed — so this assertion fails on a rejected step rather
    // than on an optimistic guess (there is no optimistic write left in this path).
    await expect(badge).toHaveText(step, { timeout: 20_000 });
    // No labelled rejection appeared: every hop was legal and accepted (Art. XIII/XVI).
    await expect(board.getByTestId('task-error')).toHaveCount(0);
  }

  // Terminal state: the lifecycle is over, so the control disables instead of offering a guaranteed 409.
  await expect(badge).toHaveText('CLEARED');
  await expect(taskButton).toBeDisabled();
});
