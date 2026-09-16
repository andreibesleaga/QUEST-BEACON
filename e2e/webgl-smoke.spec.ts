// BEACON — WebGL smoke gate (finding F-322). THE ONE SPEC THAT RUNS WITH WEBGL **ENABLED**.
//
// WHY THIS FILE EXISTS. Every OTHER spec in e2e/ calls `disableWebGL(context)` (helpers.ts:19-29), which
// makes `HTMLCanvasElement.getContext('webgl*')` return null → `MapView`'s engine start throws → it renders
// its `failed` branch (app/_components/map/MapView.tsx:53-54,75-89), i.e. the labelled accessible
// `MapFeatureList`. That is deliberate and valuable — the fallback is the DOM-assertable view of the
// deterministic geometry, and it doubles as WCAG 2.5.7 coverage — but it means the axe result, the visual
// baselines and the TTTP number all describe the FALLBACK. The real deck.gl + MapLibre surface
// (app/_components/map/map-engine.ts — the only module where WebGL lives) had zero browser coverage.
//
// This spec closes exactly that hole and nothing more: with WebGL left ALONE, does the real map mount?
// It deliberately does NOT import `disableWebGL`, and deliberately does NOT assert anything about the
// map's CONTENTS — a live GL canvas is opaque and non-deterministic (it paints asynchronously, and the
// raster basemap tiles are unreachable on the offline/air-gapped seed the gates run under). Layer/geometry
// correctness stays where it is deterministic: the fallback-driven specs and the unit tests.
//
// Scope note: only the DEFAULT shipped zone is exercised. The per-zone matrix belongs to the specs that
// can make deterministic per-zone assertions (zones/layers/perf); repeating it here would multiply an
// opaque-canvas check by five for no added signal. `DEFAULT_REGION_ID` is DERIVED from config/regions.json
// via helpers.ts (F-72) — never re-declared here.
import { test, expect } from '@playwright/test';
import { DEFAULT_REGION_ID, SHIPPED_REGIONS } from './helpers.js';

const DEFAULT_REGION_NAME =
  SHIPPED_REGIONS.find((r) => r.id === DEFAULT_REGION_ID)?.name ?? DEFAULT_REGION_ID;

/** The MapLibre-owned canvas inside MapView's success-branch container (MapView.tsx:93-99). */
const GL_CANVAS = '[data-testid="map-canvas"] canvas.maplibregl-canvas';

// F-414 — DIAGNOSED, FIXED, AND NOW ASSERTED ON EVERY PROJECT. The desktop-only skip that used to sit
// here is GONE, because the thing it was hiding is no longer unknown.
//
// What the first run (2026-08-01) actually saw: this spec passed on `desktop-dark`/`desktop-light` and
// failed on `tablet`/`phone` with `map-canvas` "hidden" — while that same element HAD acquired MapLibre's
// own `maplibregl-map` class. The engine really did mount; the element really had no box. The open question
// was whether the empty box was intended responsive behaviour or a defect. It was measured, not guessed:
//
//   project        map slot rect (WebGL ON)   same slot, WebGL OFF (what the visual baselines photograph)
//   desktop-*      1022 x 1480                1022 x 1260
//   tablet          776 x 0                    776 x 750
//   phone           378 x 0                    378 x 834
//
// So it was a REAL DEFECT, and the hypothesis in the old comment was only half right. The cause is not
// that the map "shares height with the dock" — it is that NOTHING in the shell's ancestor chain has a
// definite height, so the slot is CONTENT-sized. The success branch of MapView renders exactly one child,
// `absolute inset-0` (MapView.tsx:94-99), which contributes ZERO content height, so the slot resolved to
// 0px and clipped the live map away entirely. The FALLBACK branch renders in-flow content, which is why
// the same slot is 750-834px tall with WebGL off — and why every WebGL-off gate (axe, the visual
// baselines, TTTP) was green throughout: on the path they exercise, the bug does not exist. Desktop was
// green for a second, unrelated reason: at `lg` the track is a ROW, so align-items:stretch sized the slot
// from the tall aside next to it. Two different accidents, one real hole between them.
//
// Fix: an explicit minimum height on the map slot (`cop-layout.tsx`), chosen far below every measured
// rendering above so it moves no pixel that was already correct. This spec now asserts it on all four
// projects, because "the map is visible on a phone" is exactly the claim that was never being checked.
/** Must track `min-h-80` on the map slot in `cop-layout.tsx` (Tailwind min-h-80 = 20rem = 320px). */
const MAP_SLOT_MIN_PX = 320;

test.describe('WebGL smoke — the REAL deck.gl/MapLibre map (F-322)', () => {
  test('precondition: this browser really provides a WebGL context', async ({ page }) => {
    // Asserted, never skipped. If the runner ever loses WebGL, this gate must fail LOUDLY rather than
    // pass silently — a silent skip is how the map ended up with no coverage in the first place.
    await page.goto('/', { waitUntil: 'commit' });
    const gl = await page.evaluate(() => {
      const probe = document.createElement('canvas');
      return probe.getContext('webgl2') !== null || probe.getContext('webgl') !== null;
    });
    expect(
      gl,
      'the browser under test must expose a WebGL context for this gate to mean anything',
    ).toBe(true);
  });

  test(`the real MapLibre map mounts on the default zone (${DEFAULT_REGION_ID} — ${DEFAULT_REGION_NAME})`, async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'commit' });

    // 1. The success branch is the one that rendered. `map-canvas` exists ONLY there — the `failed` branch
    //    renders `map-view` + the EmptyState + MapFeatureList and no `map-canvas` at all
    //    (MapView.tsx:75-89 vs 91-103). So this alone proves we are NOT on the fallback path.
    const container = page.getByTestId('map-canvas');
    await expect(container).toBeVisible({ timeout: 20_000 });

    // 2. MapLibre actually constructed its canvas inside that container — i.e. `createMapEngine` was
    //    lazily imported, ran, and did not throw (MapView.tsx:61-65).
    const canvas = page.locator(GL_CANVAS);
    await expect(canvas).toHaveCount(1, { timeout: 20_000 });
    await expect(canvas.first()).toBeVisible({ timeout: 20_000 });

    // 3. That canvas is genuinely GL-backed and has real pixels. `getContext` on an already-initialised
    //    canvas returns the EXISTING context, so a non-null result here is proof MapLibre bound a live
    //    WebGL context to it — not merely that a <canvas> element exists in the DOM.
    const state = await canvas.first().evaluate((el) => {
      const c = el as HTMLCanvasElement;
      return {
        gl: c.getContext('webgl2') !== null || c.getContext('webgl') !== null,
        width: c.width,
        height: c.height,
      };
    });
    expect(state.gl, 'the mounted map canvas must hold a live WebGL context').toBe(true);
    expect(
      state.width,
      'the mounted map canvas must have a non-zero drawing buffer',
    ).toBeGreaterThan(0);
    expect(
      state.height,
      'the mounted map canvas must have a non-zero drawing buffer',
    ).toBeGreaterThan(0);
  });

  // F-414 REGRESSION GATE. `toBeVisible()` above only proves a NON-EMPTY box; it would pass on a 1px sliver,
  // and the whole point of F-414 is that a technically-mounted map can be visually worthless. So measure.
  // This runs on all four projects deliberately: phone and tablet are the ONLY projects that exercise the
  // COLUMN branch of the shell, which is the branch that collapsed. Dropping them is what hid the defect.
  test('F-414: the map slot has a usable box on EVERY viewport, not just where a row layout rescues it', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'commit' });
    const container = page.getByTestId('map-canvas');
    await expect(container).toBeVisible({ timeout: 20_000 });

    // The <main> map slot owned by cop-layout.tsx — reached from the map itself rather than by re-declaring
    // a selector, so a shell refactor cannot silently point this gate at the wrong element.
    const slot = await container.evaluate((el) => {
      const main = el.closest('main');
      if (main === null) return null;
      const r = main.getBoundingClientRect();
      const cs = getComputedStyle(main);
      return { w: r.width, h: r.height, minHeight: cs.minHeight, overflowY: cs.overflowY };
    });
    expect(slot, 'the map must live inside the shell’s labelled <main> map slot').not.toBeNull();

    // Assert the CSS floor itself, not just the resulting height. A mistyped Tailwind class emits NO rule
    // at all (v4 generates utilities on demand), so a height check alone would pass wherever content
    // happens to be tall enough — green for the wrong reason, which is the failure mode F-414 came from.
    expect(
      slot?.minHeight,
      'the map slot must carry the explicit min-height that forbids the F-414 collapse',
    ).toBe(`${MAP_SLOT_MIN_PX}px`);

    // The slot clips its own content (overflow-hidden), so its height IS the number of map pixels a user
    // can see. 0 here means the live map exists and is invisible — the exact F-414 failure.
    expect(
      slot?.h,
      `map slot height must be at least the ${MAP_SLOT_MIN_PX}px floor (F-414: it measured 0 on this project)`,
    ).toBeGreaterThanOrEqual(MAP_SLOT_MIN_PX);
    expect(slot?.w, 'map slot must have a real width').toBeGreaterThan(0);

    // And the GL canvas must actually fill that box rather than sit inside it at MapLibre's own fallback
    // size — proof the engine resized to the slot, i.e. the fix reached the map and not just the div.
    const canvasBox = await page.locator(GL_CANVAS).first().boundingBox();
    expect(canvasBox, 'the MapLibre canvas must have a layout box').not.toBeNull();
    expect(
      canvasBox?.height,
      'the MapLibre canvas must fill the map slot it was given',
    ).toBeGreaterThanOrEqual(MAP_SLOT_MIN_PX);
  });
});

// ── The worker MapLibre cannot find on its own (2026-09-12) ───────────────────────────────────────────
//
// MapLibre v6 resolves its worker at runtime with `new URL('./maplibre-gl-worker.mjs', import.meta.url)`.
// Inside a Next chunk that resolves to `/_next/static/chunks/maplibre-gl-worker.mjs`, which webpack never
// emits — `next.config.mjs` disables that asset parser deliberately. The request 404s, the SPA's HTML
// comes back, and the module worker dies with NOTHING in the console.
//
// A raster basemap survives it (raster tiles decode on the main thread). A vector one does not, and on
// 2026-09-12 the map vanished on mobile the moment the basemap ladder became vector-first. No unit test
// could have caught it: the file was missing from a BUILD, not from the source.
//
// This asks the only question that would have: does the deployment actually serve the file the map asks
// for? It runs against the real `next build` output, needs no network, and would have failed the moment
// the worker went missing.
test.describe('the self-hosted MapLibre worker', () => {
  test('is served at the URL the engine points MapLibre at', async ({ request, baseURL }) => {
    const res = await request.get(new URL('/maplibre/maplibre-gl-worker.mjs', baseURL).href);
    expect(
      res.status(),
      'the worker must be served, or every vector tile silently fails to parse',
    ).toBe(200);
    const body = await res.text();
    // Not HTML: a 200 carrying the SPA fallback is the exact failure this guards, and it is invisible
    // from the status code alone.
    expect(
      body.startsWith('<'),
      'the worker URL returned HTML — that is the SPA fallback, not the worker',
    ).toBe(false);
    // The worker imports its shared chunk by a RELATIVE specifier, so that file has to sit beside it.
    expect(body).toContain('./maplibre-gl-shared.mjs');
    const shared = await request.get(new URL('/maplibre/maplibre-gl-shared.mjs', baseURL).href);
    expect(shared.status(), 'the worker imports this file relative to itself').toBe(200);
  });
});
