// BEACON — the service worker's routing policy, asserted against the API contract (ADR-047).
//
// public/sw.js is a plain ES module, so its exported policy is imported here as-is: what the browser
// runs is what these tests read. The contract half is the important one: every API pattern the worker
// may cache must be a `get` operation whose `x-required-role` is PUBLIC in docs/api/openapi.yaml, and no
// GET above PUBLIC may match a cached pattern — the cache can then hold nothing a signed-out visitor
// could not have fetched (Art. XIV). A route promoted to RESPONDER+ without touching the worker fails here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import {
  CACHE_PREFIX,
  CACHE_DATA,
  CACHE_PAGES,
  CACHE_STATIC,
  DEFAULT_LOCALE_KEY,
  LOCALE_COOKIE as SW_LOCALE_COOKIE,
  LOCALE_KEY_PARAM,
  PUBLIC_READ_PATTERNS,
  classify,
  isAnonymous,
  localizedKey,
  servedFromCacheMessage,
  servedFromNetworkMessage,
} from '../../../public/sw.js';
import { SW_CACHE_PREFIX, parseWorkerMessage } from './registration.js';
import { LOCALE_COOKIE } from '../../../src/config/locales.js';

const ORIGIN = 'https://cop.example.org';
const OPENAPI = fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url));

interface Operation {
  readonly 'x-required-role'?: string;
}
type PathItem = Record<string, Operation | unknown>;

function operations(): ReadonlyArray<{ path: string; method: string; role: string | undefined }> {
  const doc = parseYaml(readFileSync(OPENAPI, 'utf8')) as { paths: Record<string, PathItem> };
  const out: { path: string; method: string; role: string | undefined }[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (method === 'parameters' || typeof op !== 'object' || op === null) continue;
      out.push({ path, method, role: (op as Operation)['x-required-role'] });
    }
  }
  return out;
}

/** A concrete URL for an OpenAPI path template (`{id}` → `x`). */
const concrete = (template: string): string => `/api/v1${template.replace(/\{[^}]+\}/g, 'x')}`;

const get = (path: string, headers: Record<string, string> = {}, mode = 'cors') => ({
  method: 'GET',
  url: `${ORIGIN}${path}`,
  mode,
  headers: new Headers(headers),
});

describe('public/sw.js — cached API patterns are exactly the PUBLIC GET routes', () => {
  const ops = operations();

  it('every cached pattern matches at least one GET operation declared PUBLIC', () => {
    for (const re of PUBLIC_READ_PATTERNS) {
      const matched = ops.filter((o) => re.test(concrete(o.path)));
      expect(matched.length, `${re} matches no route`).toBeGreaterThan(0);
      for (const o of matched) {
        expect(o.method, `${re} matched ${o.method.toUpperCase()} ${o.path}`).toBe('get');
        expect(o.role, `${re} matched ${o.path} (role ${o.role})`).toBe('PUBLIC');
      }
    }
  });

  it('no GET above PUBLIC is classified as cacheable data', () => {
    for (const o of ops.filter((x) => x.method === 'get' && x.role !== 'PUBLIC')) {
      expect(classify(get(concrete(o.path)), ORIGIN), o.path).toBe('bypass');
    }
  });

  it('the liveness probe (no role in the contract) and the stream are never cached', () => {
    expect(classify(get('/api/v1/health'), ORIGIN)).toBe('bypass');
    expect(classify(get('/api/v1/stream', { accept: 'text/event-stream' }), ORIGIN)).toBe('bypass');
    expect(classify(get('/api/v1/stream'), ORIGIN)).toBe('bypass');
  });
});

describe('public/sw.js — classify', () => {
  it('never touches writes, auth, /me or cross-origin requests', () => {
    expect(classify({ ...get('/api/v1/reports'), method: 'POST' }, ORIGIN)).toBe('bypass');
    expect(classify(get('/api/v1/auth/login'), ORIGIN)).toBe('bypass');
    expect(classify(get('/api/v1/me'), ORIGIN)).toBe('bypass');
    expect(classify(get('/api/v1/reports'), ORIGIN)).toBe('bypass');
    expect(classify(get('/api/v1/threshold-rules'), ORIGIN)).toBe('bypass');
    expect(
      classify({ ...get('/api/v1/regions'), url: 'https://tiles.example/1/2/3.png' }, ORIGIN),
    ).toBe('bypass');
    expect(classify({ ...get('/api/v1/regions'), url: 'not a url' }, ORIGIN)).toBe('bypass');
  });

  it('routes build assets, stable assets, navigations and public reads to their strategies', () => {
    expect(classify(get('/_next/static/chunks/app.js'), ORIGIN)).toBe('immutable');
    expect(classify(get('/maplibre/maplibre-gl-worker.mjs'), ORIGIN)).toBe('revalidate');
    expect(classify(get('/icons/beacon-192.png'), ORIGIN)).toBe('revalidate');
    expect(classify(get('/manifest.webmanifest'), ORIGIN)).toBe('revalidate');
    expect(classify(get('/', {}, 'navigate'), ORIGIN)).toBe('page');
    expect(classify(get('/api/v1/regions/ro/incidents'), ORIGIN)).toBe('data');
    expect(classify(get('/api/v1/incidents/abc/sitrep'), ORIGIN)).toBe('data');
    expect(classify(get('/api/v1/incidents/abc/summary'), ORIGIN)).toBe('bypass'); // RESPONDER+
    expect(classify(get('/other-page'), ORIGIN)).toBe('bypass'); // a non-navigation same-origin GET
  });

  it('accepts a plain header object as well as a Headers instance', () => {
    expect(
      classify(
        {
          method: 'GET',
          url: `${ORIGIN}/api/v1/stream`,
          mode: 'cors',
          headers: { Accept: 'text/event-stream' },
        },
        ORIGIN,
      ),
    ).toBe('bypass');
    expect(classify({ method: 'GET', url: `${ORIGIN}/api/v1/regions`, mode: 'cors' }, ORIGIN)).toBe(
      'data',
    );
  });
});

describe('public/sw.js — isAnonymous (only an anonymous answer may be stored)', () => {
  it('is true without credentials and for the explicit PUBLIC dev role', () => {
    expect(isAnonymous(get('/api/v1/regions'))).toBe(true);
    expect(isAnonymous(get('/api/v1/regions', { 'x-beacon-role': 'PUBLIC' }))).toBe(true);
    expect(isAnonymous(get('/api/v1/regions', { 'x-beacon-role': '' }))).toBe(true);
  });
  it('is false for a bearer token or an elevated dev role', () => {
    expect(isAnonymous(get('/api/v1/regions', { authorization: 'Bearer x' }))).toBe(false);
    expect(isAnonymous(get('/api/v1/regions', { 'x-beacon-role': 'VERIFIER' }))).toBe(false);
  });
});

describe('public/sw.js — localizedKey (a saved copy answers only its own locale)', () => {
  it('varies the cache key by the locale cookie value and never collides across locales', () => {
    const ro = localizedKey(`${ORIGIN}/api/v1/incidents/abc/sitrep`, 'ro');
    const en = localizedKey(`${ORIGIN}/api/v1/incidents/abc/sitrep`, 'en');
    expect(ro).not.toBe(en);
    expect(new URL(ro).searchParams.get(LOCALE_KEY_PARAM)).toBe('ro');
    expect(new URL(ro).pathname).toBe('/api/v1/incidents/abc/sitrep');
    expect(localizedKey(`${ORIGIN}/?x=1`, 'ro')).toBe(`${ORIGIN}/?x=1&${LOCALE_KEY_PARAM}=ro`);
  });
  it('maps an absent or empty cookie to one stable default key', () => {
    const key = `${ORIGIN}/?${LOCALE_KEY_PARAM}=${DEFAULT_LOCALE_KEY}`;
    expect(localizedKey(`${ORIGIN}/`, undefined)).toBe(key);
    expect(localizedKey(`${ORIGIN}/`, null)).toBe(key);
    expect(localizedKey(`${ORIGIN}/`, '')).toBe(key);
  });
  it('reads the same cookie the HTTP layer and the root layout read', () => {
    expect(SW_LOCALE_COOKIE).toBe(LOCALE_COOKIE);
  });
});

describe('public/sw.js ↔ registration.ts — the two sides agree', () => {
  it('cache names share the prefix the page deletes on fallback', () => {
    expect(SW_CACHE_PREFIX).toBe(CACHE_PREFIX);
    for (const name of [CACHE_STATIC, CACHE_PAGES, CACHE_DATA])
      expect(name.startsWith(CACHE_PREFIX)).toBe(true);
  });
  it('the worker’s messages parse on the page', () => {
    expect(
      parseWorkerMessage(servedFromCacheMessage('/api/v1/status', '2026-09-15T07:00:00Z')),
    ).toEqual({
      type: 'beacon:served-from-cache',
      url: '/api/v1/status',
      cachedAt: '2026-09-15T07:00:00Z',
    });
    expect(parseWorkerMessage(servedFromCacheMessage('/x', undefined))).toEqual({
      type: 'beacon:served-from-cache',
      url: '/x',
      cachedAt: null,
    });
    expect(parseWorkerMessage(servedFromNetworkMessage('/x'))).toEqual({
      type: 'beacon:served-from-network',
      url: '/x',
    });
    expect(parseWorkerMessage({ type: 'other', url: '/x' })).toBeUndefined();
    expect(parseWorkerMessage({ type: 'beacon:served-from-cache' })).toBeUndefined();
    expect(parseWorkerMessage('nope')).toBeUndefined();
    expect(parseWorkerMessage(null)).toBeUndefined();
  });
});
