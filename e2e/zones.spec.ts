// BEACON — SHIPPED-ZONE REGISTRY PARITY + per-zone truth-picture gate (finding F-72).
//
// Why this file exists. F-72 was not "three zones lack tests"; it was "the e2e suite re-declared the zone
// list, so the suite could not know a zone existed". Deriving the list (helpers.ts `SHIPPED_REGIONS`) fixes
// the omission; THIS spec makes the omission impossible to reintroduce, by asserting that the three places a
// zone must appear all agree, in a real browser, against the real server:
//
//   config/regions.json  ==  GET /api/v1/regions  ==  the COP's own region <select>
//
// Ship a sixth zone and every derived spec picks it up; ship it in only ONE of the three and this fails.
// The same idea as the codebase's other anti-re-declaration guards (F-24/F-140/F-141/F-190/F-192/F-240).
//
// Plus the bar F-72 actually cares about for a filmed demo: every zone must render a NON-EMPTY, PROVENANCED
// truth picture. "It renders empty" is a failure here, not a pass.
import { test, expect } from '@playwright/test';
import {
  disableWebGL,
  waitForTruthPicture,
  selectRegion,
  featureList,
  fetchEnvelope,
  fetchMapWire,
  expectedFeatureLabels,
  populatedLayers,
  DEFAULT_REGION_ID,
  SHIPPED_REGIONS,
  SHIPPED_REGION_IDS,
} from './helpers.js';

test.beforeEach(async ({ context }) => {
  await disableWebGL(context);
});

interface RegionsData {
  readonly regions: readonly { readonly id: string; readonly name?: string }[];
}

interface IncidentsData {
  readonly regionId: string;
  readonly incidents: readonly { readonly id: string; readonly headline?: string }[];
}

test('the served region registry is exactly config/regions.json, in registry order', async ({ request }) => {
  const served = await fetchEnvelope<RegionsData>(request, '/regions');
  expect(served.data.regions.map((r) => r.id)).toEqual([...SHIPPED_REGION_IDS]);
  expect(SHIPPED_REGION_IDS.length, 'the zone registry must not be empty').toBeGreaterThan(0);
  expect(SHIPPED_REGION_IDS).toContain(DEFAULT_REGION_ID);
});

test("the COP's region selector offers exactly the shipped zones, each with a real label", async ({ page }) => {
  await page.goto('/');
  await waitForTruthPicture(page);
  const selector = page.getByTestId('region-selector');
  await expect(selector).toBeVisible();

  const options = await selector.locator('option').evaluateAll((els) =>
    els.map((el) => ({ value: (el as HTMLOptionElement).value, label: (el.textContent ?? '').trim() })),
  );
  expect(options.map((o) => o.value)).toEqual([...SHIPPED_REGION_IDS]);
  for (const option of options) {
    // page.tsx falls back to the raw id when a zone has no `shell.region.<id>` catalog entry — a zone shipped
    // without a translated label would render its id to the operator, which is a defect, not a label.
    expect(option.label, `zone ${option.value} renders its raw id as the selector label`).not.toBe(option.value);
    expect(option.label.length).toBeGreaterThan(0);
  }
  await expect(selector).toHaveValue(DEFAULT_REGION_ID);
});

for (const region of SHIPPED_REGIONS) {
  const id = region.id;
  test(`zone renders a non-empty, provenanced truth picture — ${id} (${region.name})`, async ({ page }) => {
    // 1. The server projects real geometry AND real provenance for this zone (Art. XVI: every rung labelled).
    const envelope = await fetchEnvelope<{ readonly regionId: string }>(page.request, `/regions/${id}/map`);
    expect(envelope.data.regionId).toBe(id);
    expect(envelope.provenance.length, `${id} map carries no provenance`).toBeGreaterThan(0);
    for (const ref of envelope.provenance) {
      expect(['LIVE', 'CACHED', 'MOCK'], `${id}: unlabelled source mode`).toContain(ref.mode);
    }

    const wire = await fetchMapWire(page.request, id);
    expect(expectedFeatureLabels(wire).length, `${id} projects no map features`).toBeGreaterThan(0);
    expect(populatedLayers(wire).length, `${id} populates no map layer`).toBeGreaterThan(0);

    // 2. The zone has at least one incident to open the COP on (the SitRep path's own precondition).
    const incidents = await fetchEnvelope<IncidentsData>(page.request, `/regions/${id}/incidents`);
    expect(incidents.data.regionId).toBe(id);
    expect(incidents.data.incidents.length, `${id} has no incident — the SitRep panel has nothing to render`).toBeGreaterThan(0);

    // 3. And the browser really shows it: computed geometry rows + the SitRep provenance control.
    await page.goto('/');
    await selectRegion(page, id);
    await waitForTruthPicture(page);
    const rows = await featureList(page).locator('tbody tr').count();
    expect(rows, `${id} renders an EMPTY feature list in the browser`).toBeGreaterThan(0);
    await expect(page.getByTestId('sitrep-panel')).toBeVisible();
  });
}
