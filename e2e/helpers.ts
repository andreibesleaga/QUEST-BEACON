// BEACON — S06 browser-gate shared helpers (E8·Gate-8/F13/F14).
// Deterministic, offline, non-flaky drivers for the real running COP:
//   • disableWebGL — forces MapView's labelled accessible fallback (MapFeatureList) so the DETERMINISTIC
//     computed geometry is assertable in the DOM (and doubles as WCAG 2.5.7 non-pointer coverage). Cached
//     chromium-1228 actually HAS WebGL headless, but a live deck.gl/MapLibre canvas is opaque + non-deterministic,
//     so we exercise the honest fallback instead. Disclosed in docs/audit/S06_BROWSER_GATES.md.
//   • waitForTruthPicture — waits on the app's OWN rendered state (computed map features + SitRep provenance),
//     never a sleep. This is the "first fully-provenanced picture" the TTTP budget (F14) is measured against.
//   • escalateToVerifier — flips the DEMO role switcher to VERIFIER and re-keys the region so the VERIFIER+
//     queue/alerts (GET /reports, /alerts) refetch under the authenticated header. Deterministic state wait.
//   • SHIPPED_REGIONS — DERIVED from config/regions.json, never re-declared here (finding F-72; see below).
import type { Page, BrowserContext, Locator, APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
// The registry is read as JSON with an explicit import attribute: these specs run as real ESM under
// Playwright's loader, which (correctly) refuses a JSON module without one.
import regionsConfig from '../config/regions.json' with { type: 'json' };

/** Neuter the WebGL context so MapView.createMapEngine throws → labelled accessible MapFeatureList fallback. */
export async function disableWebGL(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]): any {
      if (typeof type === 'string' && type.toLowerCase().includes('webgl')) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (orig as any).call(this, type, ...args);
    };
  });
}

/**
 * ── THE SHIPPED-ZONE LIST IS DERIVED, NEVER RE-DECLARED (finding F-72) ────────────────────────────────
 * This used to be a hand-authored two-entry map (`us-ca`, `ro`) while FIVE zones shipped, so `es`/`gr`/`ph`
 * had no golden path, no TTTP measurement and no layer assertions in a real browser. That is the same root
 * cause as F-24/F-140/F-141/F-190/F-192/F-240: a second declaration of a contract that already exists.
 *
 * `config/regions.json` IS the zone registry (`src/config/regions.ts` and `app/page.tsx`'s selector both read
 * it), so the browser gates read the same file. Adding a sixth zone therefore adds a sixth golden path, a
 * sixth TTTP budget and a sixth layer test with no edit here. `e2e/zones.spec.ts` additionally asserts this
 * derived list is byte-equal to what `GET /api/v1/regions` serves AND to the options the COP's own selector
 * renders, so the three can never drift apart silently.
 *
 * Nothing zone-SPECIFIC is authored here either: the feature ids, the populated layers and the PII pair a
 * zone must show are read from the app's own `GET /regions/:id/map` wire at run time (see below).
 */
interface RawShippedRegion {
  readonly id: string;
  readonly name?: string;
}

export interface ShippedRegion {
  readonly id: string;
  /** Operator-facing English name from the registry — used for TEST TITLES only (the UI label is a catalog key). */
  readonly name: string;
}

export const SHIPPED_REGIONS: readonly ShippedRegion[] = (
  regionsConfig.regions as readonly RawShippedRegion[]
).map((r) => ({ id: r.id, name: r.name ?? r.id }));

export const SHIPPED_REGION_IDS: readonly string[] = SHIPPED_REGIONS.map((r) => r.id);

/** The zone the COP opens on, per the registry (not assumed to be the first entry). */
export const DEFAULT_REGION_ID: string = regionsConfig.default_region_id;

/**
 * A zone id. Deliberately `string`, not a closed union: a union would have to be authored from the JSON
 * (TypeScript widens `resolveJsonModule` string literals), which is exactly the re-declaration F-72 is about.
 * Completeness is enforced at RUN TIME against the derived list instead — see `zones.spec.ts`.
 */
export type RegionId = string;

/** The accessible map feature list — the DOM-assertable view of the deterministic computed geometry. */
export function featureList(page: Page): Locator {
  return page.getByTestId('map-feature-list');
}

/**
 * Wait for the COP's first fully-provenanced truth picture:
 *   1. computed map geometry rendered (≥1 feature row in the accessible list), AND
 *   2. the SitRep panel's Provenance control present (envelope provenance surfaced, F1), AND
 *   3. NO panel still loading anywhere on the page.
 *
 * (3) exists because (1) and (2) gate two docks and leave the third ungated. The logistics dock resolves on
 * its own queries, so until 2026-08-07 the visual baselines captured whatever state it happened to be in
 * when the SitRep settled — which was the settled state on the machine that minted them and, once the
 * composition root grew slightly heavier, the SKELETON state on the same machine. The baseline had frozen a
 * race, and the failure it eventually produced looked exactly like a layout regression (a 200 px shorter
 * page) rather than the timing artefact it was.
 *
 * `aria-busy="true"` is the app's own loading contract (ui/skeleton.tsx), so this asserts the page reports
 * itself settled rather than trusting a duration. Still no wall-clock sleep — that is what made the flake
 * invisible in the first place.
 */
export async function waitForTruthPicture(page: Page): Promise<void> {
  await expect(featureList(page)).toBeVisible({ timeout: 20_000 });
  await expect(featureList(page).locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByTestId('sitrep-panel').getByRole('button', { name: /provenance/i }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

/** Select a region via the app's own selector and let its queries re-key. */
export async function selectRegion(page: Page, id: RegionId): Promise<void> {
  await page.getByTestId('region-selector').selectOption(id);
}

/**
 * Escalate the acting principal to VERIFIER via the demo role switcher, then force the VERIFIER-only
 * queue/alerts (keyed by region, not role) to refetch under the new header by re-keying the region.
 * Waits on the queue's own approve affordance so the elevation is observed, not slept on.
 */
export async function escalateToVerifier(page: Page, target: RegionId): Promise<void> {
  // Any OTHER shipped zone re-keys the query (F-72: this used to hardcode a two-zone world, so a third zone
  // would have re-selected itself and never re-fetched under the elevated role).
  const other = SHIPPED_REGION_IDS.find((id) => id !== target);
  if (other === undefined)
    throw new Error('escalateToVerifier needs ≥2 shipped regions to re-key the query');
  await page.getByTestId('role-switcher').selectOption('VERIFIER');
  await selectRegion(page, other);
  await selectRegion(page, target);
  // Wait on the always-visible map column (the SitRep panel may be behind an inactive tab at this point),
  // and confirm the computed geometry re-rendered under the elevated role.
  await expect(featureList(page).locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
}

// ── The app's OWN map wire, as the source of every ZONE-SPECIFIC expectation (F-72) ───────────────────
// `GET /regions/:id/map` is the envelope the COP renders. Reading it here means a zone's feature ids,
// populated layers and PII pair are never hand-authored per zone (which is what left es/gr/ph untested):
// a new zone is exercised against ITS OWN seeded geometry with no edit to this file.

/** A feature row on the wire. `name` is optional exactly as the DOM's `name ?? id` label rule expects. */
interface WireFeature {
  readonly id: string;
  readonly name?: string;
  readonly position?: readonly number[];
  readonly precisePosition?: readonly number[];
}

interface WireHazard {
  readonly id: string;
  readonly kind: string;
  readonly geometry: { readonly type: string };
}

export interface MapWire {
  readonly regionId: string;
  readonly hazards: readonly WireHazard[];
  readonly gauges: readonly WireFeature[];
  readonly infrastructure: readonly WireFeature[];
  readonly exposure: readonly WireFeature[];
  readonly reports: readonly WireFeature[];
  readonly shelters: readonly WireFeature[];
  readonly predictions?: readonly { readonly geometry: { readonly type: string } }[];
  readonly route?: unknown;
  readonly storm?: { readonly track?: unknown; readonly cone?: unknown; readonly surge?: unknown };
  readonly outage?: readonly unknown[];
  readonly cell?: readonly unknown[];
  readonly cameras?: readonly unknown[];
  readonly floodZones?: readonly unknown[];
  readonly weather?: unknown;
  readonly layerSources?: Readonly<Record<string, string>>;
}

export interface Envelope<T> {
  readonly data: T;
  readonly provenance: readonly {
    readonly sourceId: string;
    readonly mode: string;
    readonly fetchedAt: string;
  }[];
  readonly freshness: string | null;
}

/** Fetch any v1 envelope as a given demo role (AUTH_DEV_TRUST_HEADER=on — the same header the UI sends). */
export async function fetchEnvelope<T>(
  request: APIRequestContext,
  path: string,
  role?: string,
): Promise<Envelope<T>> {
  const res = await request.get(
    `/api/v1${path}`,
    role === undefined ? {} : { headers: { 'x-beacon-role': role } },
  );
  expect(res.status(), `GET /api/v1${path} as ${role ?? 'PUBLIC'}`).toBe(200);
  return (await res.json()) as Envelope<T>;
}

/** The COP's own map projection for a zone. */
export async function fetchMapWire(
  request: APIRequestContext,
  id: RegionId,
  role?: string,
): Promise<MapWire> {
  return (await fetchEnvelope<MapWire>(request, `/regions/${id}/map`, role)).data;
}

/**
 * The labels the accessible MapFeatureList MUST render for this zone, derived from the wire. Mirrors the
 * component's own row rule (`name ?? id`, MapFeatureList.tsx) as a BLACK-BOX expectation — the spec asserts
 * what a user sees, it does not import the component. Report rows are excluded on purpose: their label is
 * free text and their geometry is role-gated (asserted separately by `piiPair`).
 */
export function expectedFeatureLabels(wire: MapWire): readonly string[] {
  const label = (f: WireFeature): string => f.name ?? f.id;
  const hotspots = wire.hazards
    .filter((h) => h.kind === 'HOTSPOT' && h.geometry.type === 'Point')
    .map((h) => h.id);
  const rows = [...wire.gauges, ...wire.infrastructure, ...wire.exposure, ...wire.shelters].map(
    label,
  );
  return [...new Set([...hotspots, ...rows])];
}

/** The layer vocabulary as a USER sees it: id → the visible checkbox label (messages/en.json `map.layer.*`). */
export const LAYER_LABELS: Readonly<Record<string, string>> = {
  fire: 'Fire (hotspots & perimeter)',
  flood: 'Flood extent & gauges',
  storm: 'Storm track, cone & surge',
  floodzone: 'Flood zones (NFHL)',
  infra: 'Infrastructure',
  outage: 'Power outages',
  cell: 'Cell coverage',
  weather: 'Weather (wind)',
  cameras: 'Live cameras',
  exposure: 'Exposure (nodes in hazard)',
  reports: 'Reports / SOS',
  prediction: 'Prediction cone',
  route: 'Evacuation route',
  shelters: 'Shelters',
};

const nonEmpty = (a: readonly unknown[] | undefined): boolean => a !== undefined && a.length > 0;

/**
 * Which toggleable layers this zone actually POPULATES, derived from the wire (mirrors the app's own
 * assemble/presentLayers rule in app/_lib/map-data.ts as a black-box expectation). Only a populated layer
 * may carry a FreshnessBadge — an unpopulated one must make NO freshness claim at all (Art. XVI), which is
 * the assertion `layers-phase-d.spec.ts` runs for EVERY layer of EVERY zone.
 */
export function populatedLayers(wire: MapWire): readonly string[] {
  const hasKind = (k: string): boolean => wire.hazards.some((h) => h.kind === k);
  const storm = wire.storm;
  const populated: Record<string, boolean> = {
    fire: hasKind('HOTSPOT') || hasKind('PERIMETER'),
    flood: nonEmpty(wire.gauges) || hasKind('FLOOD_REACH'),
    storm:
      storm !== undefined &&
      (storm.track !== undefined || storm.cone !== undefined || storm.surge !== undefined),
    floodzone: nonEmpty(wire.floodZones),
    infra: nonEmpty(wire.infrastructure),
    outage: nonEmpty(wire.outage),
    cell: nonEmpty(wire.cell),
    weather: wire.weather !== undefined,
    cameras: nonEmpty(wire.cameras),
    exposure: nonEmpty(wire.exposure),
    reports: nonEmpty(wire.reports),
    prediction: (wire.predictions ?? []).some(
      (p) => p.geometry.type === 'Polygon' || p.geometry.type === 'MultiPolygon',
    ),
    route: wire.route !== undefined,
    shelters: nonEmpty(wire.shelters),
  };
  return Object.keys(LAYER_LABELS).filter((id) => populated[id] === true);
}

/** How MapFeatureList prints a position: "lat, lon" to 3 dp (MapFeatureList.tsx `coords`). */
export function coordText(position: readonly number[]): string {
  const [lon, lat] = position;
  if (lon === undefined || lat === undefined) throw new Error('position must be [lon, lat]');
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

export interface PiiPair {
  /** The generalized location every principal may see. */
  readonly coarse: string;
  /** The precise location only RESPONDER+ may see (Art. XIV). */
  readonly precise: string;
}

/**
 * The zone's PII gate as DATA: the coarse/precise coordinate pair of a seeded report, derived by asking the
 * server for the same map twice under two roles. Returns undefined when the zone seeds no report that
 * carries a precise geometry (gr/ph today) — the caller then has nothing to assert rather than a fake pass.
 */
export async function piiPair(
  request: APIRequestContext,
  id: RegionId,
): Promise<PiiPair | undefined> {
  const asPublic = await fetchMapWire(request, id);
  const asResponder = await fetchMapWire(request, id, 'RESPONDER');
  for (const report of asResponder.reports) {
    const precise = report.precisePosition;
    const coarse = asPublic.reports.find((r) => r.id === report.id)?.position;
    if (precise === undefined || coarse === undefined) continue;
    if (coordText(precise) === coordText(coarse)) continue;
    return { coarse: coordText(coarse), precise: coordText(precise) };
  }
  return undefined;
}
