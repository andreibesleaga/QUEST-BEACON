// BEACON — Playwright config (E8·T-349/T-393/T-394; F13/F14). Browser e2e + visual regression + axe
// WCAG 2.2 AA. Uses the machine's cached Chromium (offline). Boots the Next dev server against the
// offline seed (no keys, no network) so the golden path is deterministic. Visual snapshots cover both
// themes × breakpoints (project matrix below).
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // capture-screenshots.spec.ts is a DEV TOOL that mutates docs/screenshots/ — opt-in only, never a CI gate.
  // Run it deliberately with `CAPTURE_SCREENSHOTS=on npx playwright test capture-screenshots`.
  testIgnore: process.env.CAPTURE_SCREENSHOTS === 'on' ? [] : ['**/capture-screenshots.spec.ts'],
  // The 4 projects share ONE in-memory dev server (offline seed), so the golden path's stateful mutations
  // (verify a report, promote the single seeded DRAFT alert) must not race across workers. Run serially for
  // determinism; the offline seed is fast so the wall-clock cost is modest. fullyParallel stays off.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Deterministic visual regression: pin device scale + reduced motion; small diff tolerance.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  projects: [
    {
      name: 'desktop-dark',
      use: {
        ...devices['Desktop Chrome'],
        colorScheme: 'dark',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'desktop-light',
      use: {
        ...devices['Desktop Chrome'],
        colorScheme: 'light',
        viewport: { width: 1440, height: 900 },
      },
    },
    // iPad (gen 7) defaults to WebKit; only Chromium 1228 is cached offline (no webkit-2311). Keep the
    // iPad viewport/touch profile but drive it with Chromium so the tablet breakpoint runs air-gapped.
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'], browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } }, // Pixel 7 already defaults to Chromium
  ],
  webServer: {
    // PRODUCTION build + start (not `next dev`). Rationale: the dev server compiles routes/chunks on first
    // hit and runs HMR, which makes first-load waits and TTTP non-deterministic under sustained load (the
    // ro region intermittently exceeded the 20s truth-picture wait on later projects). A prod build removes
    // per-request compilation → deterministic, non-flaky, and a FAIR F14 perf number. AUTH_DEV_TRUST_HEADER
    // Offline seed: no keys, MOCK sources.
    //
    // DEPLOY_MODE=local is REQUIRED, not decorative (F-344). `npm run start` sets NODE_ENV=production, and
    // the header-trust guard in `rbac.ts` hard-offs a production build that has not explicitly declared a
    // local posture — so without this every actor here resolves to PUBLIC and every role-dependent spec
    // fails. The previous comment on this block claimed the header "is baked into app/_lib/real-http.ts";
    // that file is imported ONLY by unit tests and is not in this server's request path at all. Corrected.
    //
    // NEXT_PUBLIC_BASEMAP_MODE=offline keeps the suite HERMETIC (2026-09-12). Online mode now walks a
    // ladder of keyless basemap hosts, so the one spec that enables WebGL would otherwise reach three
    // third-party servers during a CI run — a live-network dependency inside a suite whose whole premise
    // is determinism, and one that would fail differently on a runner behind a proxy than on a laptop.
    // The basemap is a backdrop: every operational layer draws over it, so the specs assert the same
    // things either way.
    command:
      `AUTH_DEV_TRUST_HEADER=on DEPLOY_MODE=local NEXT_PUBLIC_BASEMAP_MODE=offline npm run build && ` +
      `AUTH_DEV_TRUST_HEADER=on DEPLOY_MODE=local NEXT_PUBLIC_BASEMAP_MODE=offline npm run start -- --port ${PORT}`,
    url: BASE_URL,
    // FRESH SERVER PER RUN by default (root cause of the 2026-08-10 "flakes", F-157 class). This was
    // `!process.env.CI`, which reuses ANY server already on the port — including a leftover `next start`
    // from a PREVIOUS run. A reused server carries the previous run's mutations (its one seeded DRAFT
    // alert already ACTUAL, so golden-path's one-shot promotion finds nothing to promote), and when the
    // stale process dies mid-run every remaining test fails ECONNREFUSED. Both were observed on
    // 2026-08-10 and both pass on a fresh server. Within ONE run the suite is serial (workers: 1) and
    // order-deterministic, so state never races — only cross-RUN reuse broke it. Opt back into reuse
    // explicitly with PW_REUSE=1 for fast local iteration on a server you know is fresh.
    reuseExistingServer: process.env.PW_REUSE === '1',
    timeout: 240_000,
    // THE FULL OFFLINE PROFILE IS PINNED HERE, DELIBERATELY AND EXHAUSTIVELY (found 2026-08-04).
    //
    // Next.js loads `.env` at server boot, and values already present in process.env WIN — so every var
    // pinned below is immune to `.env`, and every var NOT pinned leaks through from it. The day the
    // entrant's real `.env` gained AI_MODE=cloud + CHANNEL_TELEGRAM_MODE=live + FEATURE_ROUTING=ors +
    // DATA_SOURCE_COMPOSITION=adapters, the "deterministic offline gate" silently became a LIVE run:
    // SitReps narrated by a real paid model (nondeterministic content + latency), route requests hitting
    // ORS, real egress in the TTTP numbers — and the suite went red for reasons that had nothing to do
    // with the code. Worse than red: CHANNEL_TELEGRAM_MODE=live meant a test approving an alert could
    // have sent a REAL Telegram message to the entrant's real subscriber list from inside a test run.
    //
    // The gate battery MUST mean the same thing on every machine, whatever secrets happen to sit in
    // `.env` — that is what "deterministic" means for a gate. Live behaviour has its own harness
    // (FINAL_LIVE_TEST_AND_DEMO.md) and its own session; it never shares one with the gates.
    env: {
      AUTH_DEV_TRUST_HEADER: 'on',
      DEPLOY_MODE: 'local',
      DATA_SOURCE_COMPOSITION: 'seed', // offline seed — the profile every baseline was captured on
      AI_MODE: 'off', //                  deterministic-only; no model, no key, no egress
      VISION_MODE: 'off',
      FEATURE_VISION: 'off',
      // The build-time UI mirror must be pinned TOO. `env` here applies to the BUILD command as well as
      // `start`, and NEXT_PUBLIC_* is inlined at build time — so leaving it unpinned means the entrant's
      // `.env` (which sets it `on` for the live demo) would render the verifier-queue vision toggle inside
      // the gate and move every cop.png baseline. Server flag off + mirror off = the captured profile.
      NEXT_PUBLIC_FEATURE_VISION: 'off',
      // Same reasoning for the deploy-posture badge: `live` swaps the DEV tag for the LIVE chip in the
      // toolbar. The baselines were captured on the dev posture; pin it so a cloud-shaped `.env` can't
      // silently redefine what the visual gate compares against.
      NEXT_PUBLIC_DEPLOY_POSTURE: 'dev',
      CHANNEL_TELEGRAM_MODE: 'mock', //   NEVER live in a gate — a test must not message real humans
      FEATURE_ROUTING: 'heuristic', //    no ORS egress inside a gate
      FEATURE_STORE: 'memory', //         no DATABASE_URL dependence
      COMPLIANCE_PROXY_ENABLED: 'off',
      DRILL_MODE: 'off',

      // ── LIVE-DEMO DELIVERY INCREMENT pins (docs/LIVE_DEMO_DELIVERY_PLAN.md §1.7) ──
      // Same rule as every line above: a var not pinned here leaks in from the entrant's `.env`, which is
      // shaped for the LIVE DEMO. These flags all turn ON for the demo and must stay OFF for the gates.
      //
      // No background timers in a gate. The retention sweep is a real recurring job in the running app;
      // inside a test server it would fire mid-spec and mutate the store under the assertions — the same
      // class of nondeterminism the AI_MODE and TELEGRAM pins above exist to prevent.
      RETENTION_SWEEP_ENABLED: 'off',
      // A gate must never message real humans. The watcher sends a real Telegram notification on the first
      // critical signal; CHANNEL_TELEGRAM_MODE=mock above already blocks delivery, and this is the second,
      // independent latch so neither one alone is load-bearing.
      DEMO_AUTO_REPORT: 'off',
      // Panels landing in session 3 mount behind these. Their SERVER flags default `on`, so without these
      // pins the new docks would render inside the visual gate and move every cop.png baseline the moment
      // session 3 lands. Server + mirror are pinned as PAIRS because the EnvSchema parity refine rejects an
      // explicit contradiction between them (an unset mirror inherits, an unset server flag does not).
      FEATURE_D4_SHELTER_STATUS: 'off',
      NEXT_PUBLIC_FEATURE_D4_SHELTER_STATUS: 'off',
      FEATURE_D4_DAMAGE_REPORTS: 'off',
      NEXT_PUBLIC_FEATURE_D4_DAMAGE_REPORTS: 'off',
      FEATURE_D4_EMS_OVERLAY: 'off',
      NEXT_PUBLIC_FEATURE_D4_EMS_OVERLAY: 'off',
      FEATURE_D6_SUPPLIES: 'off',
      NEXT_PUBLIC_FEATURE_D6_SUPPLIES: 'off',
      FEATURE_D6_VOLUNTEER_TEAMS: 'off',
      NEXT_PUBLIC_FEATURE_D6_VOLUNTEER_TEAMS: 'off',
      // Demo-only display flags (plan §0 decisions 2 and 3) — both add UI to the captured screens.
      NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL: 'off',
      FEATURE_CITIZEN_STREAM: 'off',
      NEXT_PUBLIC_FEATURE_CITIZEN_STREAM: 'off',

      // ── Session 2: live sources + live vision ──
      // `DATA_SOURCE_COMPOSITION: 'seed'` above already keeps every adapter out of this run, so the ~12 new
      // per-source modes need no pins — they are never composed here. VISION is different: it is composed
      // from its own ladder, and `VISION_MODE=cloud` in the entrant's `.env` would send a REAL image to a
      // REAL model from inside a gate. Both halves are pinned for the same reason the AI and Telegram
      // pins exist: a gate must mean the same thing on every machine, whatever secrets sit in `.env`.
      // The one adapter that ships defaulting to LIVE and needs no key to reach the internet. Everything
      // else is held offline by DATA_SOURCE_COMPOSITION=seed above; this is pinned as well because a
      // keyless LIVE default is one composition change away from real egress inside a gate.
      SOURCE_MASTODON_MODE: 'mock',
      // Same reason: airnow and sensorcommunity also ship LIVE-by-default and need no key to reach the
      // internet (an EPA file product and a keyless citizen network). openaq is CACHED already, pinned
      // for symmetry so the whole air-quality family is offline by declaration rather than by accident.
      SOURCE_AIRNOW_MODE: 'mock',
      SOURCE_SENSORCOMMUNITY_MODE: 'mock',
      SOURCE_OPENAQ_MODE: 'cached',
      // The live-imagery variant of the vision toggle. Nested inside NEXT_PUBLIC_FEATURE_VISION (already
      // pinned off), so this is the second latch rather than the only one — and it is the latch that keeps
      // a gate run from fetching a real satellite tile from a keyless endpoint.
      NEXT_PUBLIC_FEATURE_VISION_LIVE: 'off',
      // VISION_MODE is already pinned 'off' with the original offline profile above — not repeated here.
      // The imagery rung is keyless (NASA GIBS) — i.e. nothing but that pin stands between a gate run and
      // real satellite egress. Blank rather than absent so an inherited value cannot resurrect it.
      COPERNICUS_CLIENT_ID: '',
      COPERNICUS_CLIENT_SECRET: '',
    },
  },
});
