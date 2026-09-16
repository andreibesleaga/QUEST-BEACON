// BEACON — layer-panel browser gate for EVERY SHIPPED ZONE (W3c, extended for finding F-72).
//
// What changed and why: this spec used to carry a hand-authored `Record<RegionId, LayerCheck[]>` with two
// entries, so `es`/`gr`/`ph` had no layer assertions in a browser at all, and a sixth zone would have been
// silently skipped. The zone list is now derived from config/regions.json and each zone's POPULATED layers
// are derived from the app's own `GET /regions/:id/map` wire (helpers.ts `populatedLayers`), so a zone is
// always checked against what the server actually projected for it.
//
// The bar this spec holds — Art. XVI, honest labelling, asserted for EVERY layer of EVERY zone:
//   • a layer the zone POPULATES renders a FreshnessBadge (Live/Stale/Unavailable) and really toggles,
//   • a layer the zone does NOT populate renders NO badge — no freshness claim is made about data that is
//     not there (the failure mode "renders empty but looks live" is exactly what this catches),
//   • a layer that carries a caveat renders it as role="note" whenever the zone populates that layer.
//
// Drives the REAL running COP the same way golden-path.spec.ts does (disableWebGL → the accessible truth
// picture; no route stubbing). Black-box by design: the visible labels/caveats below mirror
// app/_components/map/build-layers.ts + messages/en.json verbatim but are NOT imported — an e2e spec asserts
// what a user actually sees, not source text.
import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  disableWebGL,
  waitForTruthPicture,
  selectRegion,
  fetchMapWire,
  populatedLayers,
  LAYER_LABELS,
  SHIPPED_REGIONS,
} from './helpers.js';

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

/** Per-LAYER (not per-zone) honesty caveats, as the panel renders them. A layer with no caveat maps to null. */
const LAYER_CAVEATS: Readonly<Record<string, string | null>> = {
  fire: 'FIRMS hotspots are thermal detections, not confirmed fire perimeters.',
  flood: null,
  storm:
    'Agency cyclone product drawn verbatim — BEACON does not model storm tracks, winds or surge.',
  floodzone: 'Regulatory flood zones — not a live extent',
  infra: null,
  outage:
    'County-granular (EAGLE-I): areas are assumed-offline estimates, not confirmed per-address outages.',
  cell: 'OpenCelliD-derived coverage estimate — indicative, not a guaranteed signal map.',
  weather: 'Observation point — not a forecast grid',
  cameras: "Live cameras — opens the source's site in a new tab",
  exposure: null,
  reports: null,
  prediction: null,
  route: null,
  shelters: null,
};

const FRESHNESS_TEXT = /^(Live|Stale|Unavailable)$/;

async function openLayerPanel(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Layers' }).click();
  const panel = page.getByTestId('layer-toggle-panel');
  await expect(panel).toBeVisible();
  return panel;
}

/** The panel row owning this layer's checkbox (the `has:` locator is re-rooted per <li>, so it must NOT chain off the panel). */
function layerRow(page: Page, panel: Locator, label: string): Locator {
  return panel
    .locator('li')
    .filter({ has: page.getByRole('checkbox', { name: label, exact: true }) });
}

/** Assert this layer's toggle really moves — on the TRANSITION, since overlays start OFF and base layers ON. */
async function assertTogglesBothWays(row: Locator, label: string): Promise<void> {
  const checkbox = row.getByRole('checkbox', { name: label, exact: true });
  const before = await checkbox.isChecked();
  await checkbox.click();
  await expect(checkbox).toBeChecked({ checked: !before });
  await checkbox.click();
  await expect(checkbox).toBeChecked({ checked: before });
}

for (const region of SHIPPED_REGIONS) {
  const id = region.id;
  test(`map layers — badge only where populated, caveat, toggle — ${id} (${region.name})`, async ({
    page,
  }) => {
    const wire = await fetchMapWire(page.request, id);
    const populated = new Set(populatedLayers(wire));
    expect(
      populated.size,
      `${id} populates NO map layer — an empty COP is a failure, not a pass`,
    ).toBeGreaterThan(0);

    await page.goto('/');
    await selectRegion(page, id);
    await waitForTruthPicture(page);
    const panel = await openLayerPanel(page);

    for (const [layerId, label] of Object.entries(LAYER_LABELS)) {
      const row = layerRow(page, panel, label);
      // The whole closed layer vocabulary is offered on every zone — a new layer id shipping without a
      // visible row (or this list going stale) fails here rather than silently losing coverage.
      await expect(row, `${id}: layer row "${label}" missing from the panel`).toHaveCount(1);

      const badge = row.getByText(FRESHNESS_TEXT);
      if (!populated.has(layerId)) {
        // Art. XVI: no data ⇒ no freshness claim. A badge here would assert a state for an absent layer.
        await expect(
          badge,
          `${id}: layer "${label}" is NOT populated but claims freshness`,
        ).toHaveCount(0);
        continue;
      }

      await expect(
        badge.first(),
        `${id}: populated layer "${label}" has no freshness badge`,
      ).toBeVisible();

      const caveat = LAYER_CAVEATS[layerId];
      if (caveat !== null && caveat !== undefined) {
        const note = row.getByText(caveat);
        await expect(note, `${id}: layer "${label}" is missing its caveat`).toBeVisible();
        await expect(note).toHaveAttribute('role', 'note');
      }

      await assertTogglesBothWays(row, label);
    }

    await page.keyboard.press('Escape');
  });
}

test('Logistics board shows the Pre-positioning advisory section', async ({ page }) => {
  await page.goto('/');
  await selectRegion(page, 'us-ca');
  await waitForTruthPicture(page);

  // "Resources" is the logistics dock's default tab (LogisticsBoard); click explicitly so this assertion
  // holds regardless of any prior tab state.
  await page.getByRole('tab', { name: /resources/i }).click();
  await expect(page.getByTestId('logistics-board')).toBeVisible();

  const prePositioning = page.getByRole('region', { name: /pre-positioning suggestions/i });
  await expect(prePositioning).toBeVisible();
  // The "Advisory — human decides" guard is always rendered regardless of which designed state the panel
  // is in (no incident / no projected extent yet / no nearby assets / suggestions) — the one assertion that
  // is stable across all of them offline (Art. XII/XIII: engine ranks, a human decides, never auto-tasked).
  await expect(prePositioning.getByText(/advisory — human decides/i)).toBeVisible();
});
