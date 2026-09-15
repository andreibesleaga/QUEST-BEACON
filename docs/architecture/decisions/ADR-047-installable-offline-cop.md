# ADR-047 — An installable, offline-capable COP behind a default-off flag

**Status:** Accepted · 2026-09-15

## Context

BEACON is local-first (Art. XVI): the server runs air-gapped and every layer has a fallback ladder. The
browser did not. An operator whose connection dropped in the field saw a blank tab, and a phone on a
degraded network re-downloaded the whole build on every visit. The project already ships a
`themeColor`, self-hosted fonts and a same-origin asset policy, so the last mile — a web-app manifest and
a service worker — was the only missing piece of a Progressive Web App, and it has to be added without
changing anything for a deployment that does not ask for it, and without a dependency.

Three constraints shaped the design:

1. **The picture must never be quietly stale.** A saved copy shown beside a ticking clock would be
   exactly the "plausible falsehood" the status strip was built to prevent (Art. XII). Any served copy
   must say when it was saved.
2. **The cache must hold nothing a signed-out visitor could not fetch** (Art. XIV). Responses differ by
   role (`precisePosition` is RESPONDER+), and a cache is a shared, durable store on the device.
3. **Off must mean off.** A deployment that leaves the flag unset must behave byte-for-byte as before,
   and a device that once ran an `on` build must be cleaned up by the next `off` build.

## Decision

1. **One build-time flag, `NEXT_PUBLIC_PWA` (`off` | `on`, validated in `EnvSchema`).** `on` links
   `public/manifest.webmanifest` from the root layout and registers `public/sw.js` as a module worker.
   Anything else links nothing, and the page-side bridge (`app/_components/pwa/service-worker-bridge.tsx`)
   **unregisters every worker of the origin and deletes every `beacon-sw-*` cache** — the fallback is
   complete, not merely inactive.
2. **A hand-written service worker, zero dependencies** (`public/sw.js`, an ES module so its policy is
   importable by tests). Strategies by request class, decided by the pure `classify()`:
   - `/_next/static/*` (hashed, immutable) → cache-first;
   - `/maplibre/*`, `/icons/*`, the manifest (stable names) → stale-while-revalidate;
   - navigations → network-first, fallback the saved page, then the saved app shell;
   - **PUBLIC read-only API GETs** (`/status`, `/regions`, `/regions/{id}/incidents`,
     `/regions/{id}/map`, `/incidents/{id}`, `/incidents/{id}/sitrep`, `/incidents/{id}/exposure`,
     `/sources`) → network-first, fallback the saved copy;
   - everything else — writes, `/auth/*`, `/me`, the SSE stream, every role-gated read, cross-origin
     tiles — is **not touched** (`bypass`: no `respondWith`).
   A data response **or a navigation** is stored **only when the request carried no credentials** (no
   bearer, no elevated dev role) and only when it is `ok`; it is stamped with `x-beacon-cached-at`. The
   data cache is bounded (200 entries, oldest evicted). **Every saved page and data entry is keyed by
   URL + locale** (`localizedKey`; the `beacon-locale` cookie read through the Cookie Store API at fetch
   time; an absent cookie is the server's English default and keys as `default`): pages carry
   `<html lang>` and the catalogue, the SitRep is rendered in the reader's language, so a copy saved
   under one locale never answers another. The install-time shell is saved under the installing locale's
   key too. **Without the Cookie Store API** (Chrome < 87, Firefox < 132, Safari < 18.4) there is no
   reliable locale key, so pages and data are neither saved nor served from a cache — only the immutable
   build assets are; a wrong-locale copy is impossible by construction, at the price of no offline
   picture in such a browser.
3. **The saved time is a fact the page shows.** When the worker answers from a saved copy it posts
   `beacon:served-from-cache` with the stamp; the bridge renders a `role="status"` banner —
   *"Offline — showing the picture saved at HH:MM"* (or *"Server unreachable — …"* while the browser
   thinks it is online), in the reader's locale. Saved copies are tracked **per URL**: a query answered
   live clears only its own entry, and the time shown is the **oldest** saved part still on screen.
   The banner exists only while a worker **controls** the page (`navigator.serviceWorker.controller`),
   so a flag-off build renders the pre-PWA page; offline with nothing yet served from the cache it
   says *"no saved picture yet on this device"*. No time is invented: an unstamped copy says so.
4. **TanStack Query follows the flag.** Its default `networkMode: 'online'` never calls the query
   function while `navigator.onLine` is false, so an offline reload would sit on a skeleton with a full
   cache beside it. The client is built with `offlineFirst` only when the flag is on.
5. **Contract-tested against the API.** `app/_lib/pwa/sw-policy.test.ts` reads `docs/api/openapi.yaml`
   and asserts every cached pattern is a `get` operation with `x-required-role: PUBLIC` and that no GET
   above PUBLIC matches one — a route promoted to RESPONDER+ without touching the worker fails the build.
   `e2e/pwa-offline.spec.ts` proves the whole chain in a real browser: a controlled visit saves the shell
   and the picture, a full offline reload renders the truth picture, and the banner names the saved time.

## Consequences

- **Default deployments are unchanged.** The gate profile builds with the flag off; the only new bytes
  on such a page are the bridge's retirement logic, which finds nothing to retire.
- **Offline is read-only.** An offline operator sees the last saved picture and can navigate it; a
  report or a verification submitted offline fails visibly, as before — there is no queued-write path
  (the "Option C" that was assessed and deferred; see `docs/audit/UNIMPLEMENTED_REGISTER.md`).
- **A signed-in operator offline gets the PUBLIC picture.** Only anonymous copies exist, so the fallback
  is the public projection (no `precisePosition`). That is the honest trade: the alternative stores
  role-gated data on a shared device.
- **First visit is not cached.** A worker controls a page only from the visit after registration; the
  shell is pre-cached at install so a navigation fallback exists from the start, but the picture is
  saved on the first controlled visit.
- **Not a real-time guarantee.** The worker serves what it last saw; the SSE stream is bypassed and
  simply fails offline, exactly as it does without a worker.
- **Icons are generated, not designed** (`scripts/build-pwa-icons.mjs`, node:zlib, deterministic): a
  navy tile, a light ring, a lit core, a warm notch — enough for a home screen, replaceable at will.

## Alternatives considered

- **A PWA library (next-pwa / Workbox).** Rejected: the project's rule is zero new dependencies for
  release, and a generated worker would cache by glob rather than by contract — the role-gate proof in
  (5) is only possible because the policy is a hand-written, importable function.
- **Caching every `/api/v1` GET.** Rejected on Art. XIV: `/reports`, `/alerts`, `/threshold-rules`,
  `/audit-events` and `/health/adapters` are role-gated, and `/regions/{id}/map` differs by role.
- **Queued offline writes (Option C).** Deferred: it needs idempotency keys on the write routes and a
  reconciliation UI; the value is real but it is a second increment, not part of this one.
