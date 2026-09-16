// BEACON — service worker (ADR-047; hand-written, zero dependencies, module worker).
//
// WHAT IT DOES. Keeps an operator's browser useful when the network drops: the app shell and its hashed
// build assets are served from a cache, and the PUBLIC read-only picture (regions, incidents, SitRep,
// exposure, map projection, sources, status) is served network-first with the last copy this device saw
// as the fallback. Every fallback is announced to the page (`beacon:served-from-cache`) so the banner can
// say WHEN the picture was saved — the wall clock and the data's age are different facts (Art. XII).
//
// WHAT IT NEVER DOES. It never caches a write, a login, `/me`, the SSE stream, a role-gated read, or a
// response to a request that carried credentials: only ANONYMOUS answers to PUBLIC GET routes and
// anonymous navigations are kept, so the cache can hold nothing a signed-out visitor could not have
// fetched (Art. XIV). Cross-origin requests (basemap tiles) are left to the browser. Registration is gated
// by NEXT_PUBLIC_PWA (default off); with the flag off the page unregisters this worker and deletes its
// caches, so the deployment is byte-for-byte the pre-PWA behaviour (complete fallback).
//
// LOCALE. Pages (`<html lang>`, the catalogue) and the SitRep are rendered in the locale the
// `beacon-locale` cookie selects, so a copy saved under one locale must never answer a request made under
// another. Every saved page and data entry is therefore keyed by URL + locale (`localizedKey`), the
// locale read through the Cookie Store API at fetch time (an absent cookie is the server's English
// default and keys as 'default'). Where that API is missing — no reliable locale key — pages and data
// are NOT saved and NOT served from a cache at all: only the immutable build assets are. A wrong-locale
// copy is impossible by construction; the price is no offline picture in such a browser.
//
// The policy is exported (this file is an ES module; the page registers it with `{ type: 'module' }`) so
// app/_lib/pwa/sw-policy.test.ts can assert it against docs/api/openapi.yaml: every cached API pattern
// must be a `get` operation with `x-required-role: PUBLIC`, and no non-PUBLIC GET may match one.

export const SW_VERSION = 'beacon-sw-1';
export const CACHE_STATIC = `${SW_VERSION}-static`;
export const CACHE_PAGES = `${SW_VERSION}-pages`;
export const CACHE_DATA = `${SW_VERSION}-data`;
export const CACHE_PREFIX = 'beacon-sw-';
export const DATA_CACHE_MAX_ENTRIES = 200;
export const CACHED_AT_HEADER = 'x-beacon-cached-at';
export const OFFLINE_FALLBACK_PATH = '/';
/** The cookie the HTTP layer and the root layout read the reader's locale from (src/config/locales.ts). */
export const LOCALE_COOKIE = 'beacon-locale';
/** Query parameter that varies a cache key by locale (a Cache API key is a URL; fragments are ignored). */
export const LOCALE_KEY_PARAM = '__beacon_locale';
export const DEFAULT_LOCALE_KEY = 'default';

/** PUBLIC-role, read-only API paths the worker may keep an anonymous copy of (mirrors openapi.yaml). */
export const PUBLIC_READ_PATTERNS = [
  /^\/api\/v1\/status$/,
  /^\/api\/v1\/regions$/,
  /^\/api\/v1\/regions\/[^/]+\/incidents$/,
  /^\/api\/v1\/regions\/[^/]+\/map$/,
  /^\/api\/v1\/incidents\/[^/]+$/,
  /^\/api\/v1\/incidents\/[^/]+\/sitrep$/,
  /^\/api\/v1\/incidents\/[^/]+\/exposure$/,
  /^\/api\/v1\/sources$/,
];

/** Same-origin paths whose bytes are immutable per build (hashed) — cache-first. */
const IMMUTABLE_PREFIXES = ['/_next/static/'];
/** Same-origin paths that are stable names but may change per build — serve cached, refresh behind. */
const REVALIDATE_PREFIXES = ['/maplibre/', '/icons/'];
const REVALIDATE_EXACT = ['/manifest.webmanifest'];

/**
 * Where a request belongs. Pure: takes the request's observable fields so the tests need no real
 * `Request` (a `mode: 'navigate'` Request cannot even be constructed outside a navigation).
 *   'immutable'  hashed build asset → cache-first
 *   'revalidate' stable-named asset → stale-while-revalidate
 *   'page'       a navigation → network-first, fallback the cached page (or the app shell)
 *   'data'       PUBLIC read-only API GET → network-first, fallback the anonymous cached copy
 *   'bypass'     everything else → not touched (writes, auth, /me, SSE, role-gated reads, cross-origin)
 */
export function classify(request, origin) {
  const path = sameOriginPath(request, origin);
  if (path === null) return 'bypass';
  if (IMMUTABLE_PREFIXES.some((p) => path.startsWith(p))) return 'immutable';
  if (isRevalidated(path)) return 'revalidate';
  if (request.mode === 'navigate') return 'page';
  if (path.startsWith('/api/v1/')) return isPublicRead(request, path) ? 'data' : 'bypass';
  return 'bypass';
}

/** The pathname of a same-origin GET, else null. */
function sameOriginPath(request, origin) {
  if (request.method !== 'GET') return null;
  try {
    const url = new URL(request.url);
    return url.origin === origin ? url.pathname : null;
  } catch {
    return null;
  }
}

function isRevalidated(path) {
  return REVALIDATE_PREFIXES.some((p) => path.startsWith(p)) || REVALIDATE_EXACT.includes(path);
}

/** A PUBLIC read-only route that is not the SSE stream. */
function isPublicRead(request, path) {
  const accept = headerOf(request, 'accept');
  if (accept !== null && accept.includes('text/event-stream')) return false;
  return PUBLIC_READ_PATTERNS.some((re) => re.test(path));
}

/** True when the request carries no identity: no bearer token and no non-PUBLIC dev role header. */
export function isAnonymous(request) {
  if (headerOf(request, 'authorization') !== null) return false;
  const role = headerOf(request, 'x-beacon-role');
  return role === null || role === '' || role.toUpperCase() === 'PUBLIC';
}

function headerOf(request, name) {
  const headers = request.headers;
  if (headers === undefined || headers === null) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const found = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return found === undefined ? null : headers[found];
}

/** The message posted to the page when a response came from the cache. */
export function servedFromCacheMessage(url, cachedAt) {
  return { type: 'beacon:served-from-cache', url, cachedAt: cachedAt ?? null };
}

/** The message posted to the page when a data response came from the network (clears the stale state). */
export function servedFromNetworkMessage(url) {
  return { type: 'beacon:served-from-network', url };
}

/**
 * The cache key of a localized response: the request URL varied by the reader's locale, so a Romanian
 * SitRep or page can never be served to an English cookie (or vice versa). Pure; the locale value is
 * whatever the cookie holds (the server coerces unknown values to English, so the key mirrors that: the
 * same cookie value always maps to the same key), and an absent or unreadable cookie is 'default'.
 */
export function localizedKey(url, locale) {
  const key = new URL(url);
  const value = typeof locale === 'string' && locale !== '' ? locale : DEFAULT_LOCALE_KEY;
  key.searchParams.set(LOCALE_KEY_PARAM, value);
  return key.toString();
}

// ── Worker wiring (only inside a real ServiceWorkerGlobalScope; inert under Node/vitest) ──────────────
const inWorker =
  typeof self !== 'undefined' &&
  typeof ServiceWorkerGlobalScope !== 'undefined' &&
  self instanceof ServiceWorkerGlobalScope;

if (inWorker) {
  const sw = self;
  const CURRENT = new Set([CACHE_STATIC, CACHE_PAGES, CACHE_DATA]);

  sw.addEventListener('install', (event) => {
    event.waitUntil(precacheShell().then(() => sw.skipWaiting()));
  });

  /** Save the app shell under the CURRENT locale's key (the `/` response is locale-rendered HTML). */
  async function precacheShell() {
    try {
      const locale = await currentLocale();
      if (locale === null) return;
      const res = await fetch(OFFLINE_FALLBACK_PATH);
      if (!res.ok) return;
      const cache = await caches.open(CACHE_PAGES);
      await putStamped(
        cache,
        localizedKey(new URL(OFFLINE_FALLBACK_PATH, sw.location.origin).href, locale),
        res,
      );
    } catch {
      // A missed pre-cache is a degradation, never a failed install (Art. XVI).
    }
  }

  sw.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((n) => n.startsWith(CACHE_PREFIX) && !CURRENT.has(n))
              .map((n) => caches.delete(n)),
          ),
        )
        .then(() => sw.clients.claim()),
    );
  });

  sw.addEventListener('fetch', (event) => {
    const kind = classify(event.request, sw.location.origin);
    if (kind === 'bypass') return;
    if (kind === 'immutable') event.respondWith(cacheFirst(event.request));
    else if (kind === 'revalidate') event.respondWith(staleWhileRevalidate(event.request));
    else if (kind === 'page') event.respondWith(networkFirstPage(event));
    else event.respondWith(networkFirstData(event));
  });

  async function cacheFirst(request) {
    const cache = await caches.open(CACHE_STATIC);
    const hit = await cache.match(request.url);
    if (hit !== undefined) return hit;
    const res = await fetch(request);
    if (res.ok) await cache.put(request.url, res.clone());
    return res;
  }

  async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_STATIC);
    const hit = await cache.match(request.url);
    const refresh = fetch(request)
      .then(async (res) => {
        if (res.ok) await cache.put(request.url, res.clone());
        return res;
      })
      .catch(() => undefined);
    if (hit !== undefined) return hit;
    const fresh = await refresh;
    return fresh ?? offlineResponse();
  }

  /**
   * The locale the reader's cookie selects, read through the Cookie Store API: the cookie's value, or
   * 'default' when no cookie is set (the server then renders English). NULL when the API is missing or
   * refuses — there is then no reliable locale key, and nothing localized is saved or served.
   */
  async function currentLocale() {
    try {
      const store = sw.cookieStore;
      if (store === undefined || store === null) return null;
      const cookie = await store.get(LOCALE_COOKIE);
      return cookie === null || cookie === undefined ? DEFAULT_LOCALE_KEY : cookie.value;
    } catch {
      return null;
    }
  }

  async function networkFirstPage(event) {
    const request = event.request;
    const locale = await currentLocale();
    if (locale === null) return fetch(request).catch(() => offlineResponse()); // no locale key: no cache
    const cache = await caches.open(CACHE_PAGES);
    const key = localizedKey(request.url, locale);
    try {
      const res = await fetch(request);
      // Same gate as data: a navigation that carried an identity is never stored (Art. XIV).
      if (res.ok && isAnonymous(request)) await putStamped(cache, key, res);
      return res;
    } catch {
      // No client message here: a navigation's client does not exist until this response commits, so
      // `clients.get(resultingClientId)` would wait on the very response we are producing (a deadlock).
      // The page learns it is offline from `navigator.onLine`, and its data fetches carry the saved time.
      // Fallback order: this URL in this locale, then the shell saved in this locale — never another's.
      const shell = localizedKey(new URL(OFFLINE_FALLBACK_PATH, sw.location.origin).href, locale);
      const hit = (await cache.match(key)) ?? (await cache.match(shell));
      return hit ?? offlineResponse();
    }
  }

  async function networkFirstData(event) {
    const request = event.request;
    const locale = await currentLocale();
    if (locale === null) return fetch(request); // no reliable locale key: pass through, save nothing
    const cache = await caches.open(CACHE_DATA);
    const key = localizedKey(request.url, locale);
    try {
      const res = await fetch(request);
      if (res.ok && isAnonymous(request)) {
        await putStamped(cache, key, res);
        await trim(cache, DATA_CACHE_MAX_ENTRIES);
      }
      await notify(event.clientId, servedFromNetworkMessage(request.url));
      return res;
    } catch (e) {
      const hit = await cache.match(key);
      if (hit === undefined) throw e;
      await notify(
        event.clientId,
        servedFromCacheMessage(request.url, hit.headers.get(CACHED_AT_HEADER)),
      );
      return hit;
    }
  }

  /** Store a copy stamped with WHEN it was saved, so a fallback can say how old the picture is. */
  async function putStamped(cache, url, res) {
    const headers = new Headers(res.headers);
    headers.set(CACHED_AT_HEADER, new Date().toISOString());
    const body = await res.clone().arrayBuffer();
    await cache.put(
      url,
      new Response(body, { status: res.status, statusText: res.statusText, headers }),
    );
  }

  async function trim(cache, max) {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - max; i += 1) await cache.delete(keys[i]);
  }

  async function notify(clientId, message) {
    if (!clientId) return;
    const client = await sw.clients.get(clientId);
    if (client) client.postMessage(message);
  }

  function offlineResponse() {
    return new Response('offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
