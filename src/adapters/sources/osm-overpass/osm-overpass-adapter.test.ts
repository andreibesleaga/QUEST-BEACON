// BEACON — OSM Overpass adapter tests (adapter-contract §6, ADR-009/F1/F5/F6, InfrastructurePort P4).
// Mode-switch (mock/cached/live) each yields usable InfrastructureNode with the correct mode/degraded/
// freshness; the live rung degrades to the recorded mock when upstream is unreachable; GLOBAL coverage
// serves any region; the outward InfrastructurePort.fetchNodes adapts the ladder to the Sourced envelope;
// the factory defaults to CACHED (rate-limited upstream, Art. XVI) and fails fast on a bad mode.
// A10: the configurable mirror ladder (SOURCE_OSM_OVERPASS_MIRRORS) is tried in order inside the existing
// breaker, falls through failures/garbage bodies, and stamps the answering mirror into the SourceRecord.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ok, asId, makeInfrastructureNode } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { InfrastructureNode, InfrastructureNodeId, SourceId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import {
  DEFAULT_USER_AGENT,
  OsmOverpassAdapter,
  buildOverpassQuery,
  makeOsmOverpassAdapter,
  parseMirrorsEnv,
} from './osm-overpass-adapter.js';

class FakeCache implements CachePort {
  readonly store = new Map<string, unknown>();
  get<T>(key: string): Promise<Result<T | null, DomainError>> {
    return Promise.resolve(ok((this.store.get(key) ?? null) as T | null));
  }
  set<T>(key: string, value: T): Promise<Result<void, DomainError>> {
    this.store.set(key, value);
    return Promise.resolve(ok(undefined));
  }
  delete(key: string): Promise<Result<void, DomainError>> {
    this.store.delete(key);
    return Promise.resolve(ok(undefined));
  }
}

const NOW = '2026-07-05T22:00:00Z'; // safely past — Freshness rejects future fetchedAt
const region: Region = { id: 'ca', bbox: [-124, 32, -114, 42] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-osm' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('OsmOverpassAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as InfrastructureNode (degraded, provenance MOCK)', async () => {
    const adapter = new OsmOverpassAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(3);
    expect(res.value.records.map((r) => r.entity.type)).toEqual(['HOSPITAL', 'POWER', 'CELL']);
    const first = res.value.records[0];
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('OSM Overpass');
    expect(first?.provenance.license).toBe('© OpenStreetMap contributors (ODbL)');
    expect(first?.provenance.adapter).toBe('osm-overpass');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('osm-overpass', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new OsmOverpassAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 -> OP3)', async () => {
    const adapter = new OsmOverpassAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/api/interpreter' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty -> recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('GLOBAL coverage serves any region (no NOT_COVERED)', async () => {
    const adapter = new OsmOverpassAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect((await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' })).ok).toBe(true);
  });
});

describe('OsmOverpassAdapter outward InfrastructurePort', () => {
  it('fetchNodes returns a Sourced envelope of InfrastructureNode with freshness', async () => {
    const adapter = new OsmOverpassAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchNodes({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(3);
    expect(res.value.data[0]?.type).toBe('HOSPITAL');
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('reports a healthy (CLOSED) breaker before any failure and correct identity', () => {
    const adapter = new OsmOverpassAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('osm-overpass');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('buildOverpassQuery', () => {
  it('queries the focus boxes instead of the region when the composition supplies them (ADR-045)', () => {
    const q = buildOverpassQuery(
      [-124, 32, -114, 42],
      [
        [-121.7, 39.6, -121.5, 39.8],
        [-122.3, 38.4, -122.1, 38.6],
      ],
    );
    expect(q).toContain('(39.6,-121.7,39.8,-121.5)');
    expect(q).toContain('(38.4,-122.3,38.6,-122.1)');
    expect(q).not.toContain('(32,-124,42,-114)');
    // every filter, for every box
    expect(q.match(/\["amenity"="hospital"\]/g)).toHaveLength(2);
    // an empty focus is no focus
    expect(buildOverpassQuery([-124, 32, -114, 42], [])).toContain('(32,-124,42,-114)');
  });

  it('swaps domain BBox order [west,south,east,north] to Overpass bbox order (south,west,north,east)', () => {
    const q = buildOverpassQuery([-124, 32, -114, 42]);
    expect(q).toContain('(32,-124,42,-114)');
  });

  it('includes all four node filters (hospital, fire_station, substation, comms mast x2)', () => {
    const q = buildOverpassQuery([-124, 32, -114, 42]);
    expect(q).toContain('["amenity"="hospital"]');
    expect(q).toContain('["amenity"="fire_station"]');
    expect(q).toContain('["power"="substation"]');
    expect(q).toContain('["man_made"="mast"]["tower:type"="communication"]');
    expect(q).toContain('["man_made"="mast"]["communication"]');
    expect(q.startsWith('[out:json][timeout:25];(')).toBe(true);
    expect(q.endsWith(');out body;')).toBe(true);
  });
});

describe('makeOsmOverpassAdapter factory', () => {
  it('defaults to CACHED mode when SOURCE_OSM_OVERPASS_MODE is unset (rate-limited upstream, cache aggressively)', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter from env', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_MODE: 'MOCK',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG)', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_MODE: 'bogus',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('honors SOURCE_OSM_OVERPASS_URL override', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_MODE: 'MOCK',
      SOURCE_OSM_OVERPASS_URL: 'https://overpass.private.example/api/interpreter',
    });
    expect(res.ok).toBe(true);
  });
});

// ── A10 mirror ladder ────────────────────────────────────────────────────────────────────────────
// Overpass has several interchangeable public endpoints; a rate-limited or overloaded one must not cost
// the COP its infrastructure layer. The ladder is tried IN ORDER inside the existing circuit breaker and
// the endpoint that actually answered is stamped into the SourceRecord (SourceRecord has no endpoint
// field, so the display name carries it — provenance must never lie about which mirror served the data).
const MIRROR_A = 'https://mirror-a.example/api/interpreter';
const MIRROR_B = 'https://mirror-b.example/api/interpreter';
const MIRROR_C = 'https://mirror-c.example/api/interpreter';
// maxRetries 0: one ladder pass per fetch, so "requests seen" is exactly "mirrors tried" (deterministic).
const LADDER_BREAKER = { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 };
/** The smallest Overpass body the ACL maps to exactly one InfrastructureNode. */
const LIVE_BODY = JSON.stringify({
  version: 0.6,
  elements: [
    {
      type: 'node',
      id: 42,
      lat: 39.75,
      lon: -121.86,
      tags: { amenity: 'hospital', name: 'Mirror General' },
    },
  ],
});
const RO_REGION: Region = { id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' };

/** Stub the platform fetch with a per-URL responder — NO live network is ever reached in these tests. */
function stubFetch(responder: (url: string) => Response): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    seen.push(String(url));
    return Promise.resolve(responder(String(url)));
  });
  return seen;
}

/** 200 from `mirror`, 503 from every other endpoint. */
const onlyMirrorAnswers =
  (mirror: string) =>
  (url: string): Response =>
    url.startsWith(mirror)
      ? new Response(LIVE_BODY, { status: 200 })
      : new Response('down', { status: 503 });

const ladderAdapter = (mirrors: readonly string[]): OsmOverpassAdapter =>
  new OsmOverpassAdapter({
    engine: mkEngine(new FakeCache()),
    config: cfg('LIVE'),
    mirrors,
    breaker: LADDER_BREAKER,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OsmOverpassAdapter mirror ladder (A10)', () => {
  it('tries the mirrors in configured order and stops at the first that answers', async () => {
    const seen = stubFetch(onlyMirrorAnswers(MIRROR_B));
    const res = await ladderAdapter([MIRROR_A, MIRROR_B, MIRROR_C]).fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.degraded).toBe(false);
    expect(res.value.records).toHaveLength(1);
    expect(seen).toHaveLength(2); // C is never touched once B answers
    expect(seen[0]?.startsWith(MIRROR_A)).toBe(true);
    expect(seen[1]?.startsWith(MIRROR_B)).toBe(true);
  });

  it('records the mirror that answered in the provenance SourceRecord', async () => {
    stubFetch(onlyMirrorAnswers(MIRROR_B));
    const res = await ladderAdapter([MIRROR_A, MIRROR_B, MIRROR_C]).fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const first = res.value.records[0];
    expect(first?.provenance.source).toBe('OSM Overpass (mirror-b.example)');
    expect(first?.provenance.adapter).toBe('osm-overpass');
    expect(first?.provenance.license).toBe('© OpenStreetMap contributors (ODbL)');
    expect(first?.provenance.mode).toBe('LIVE');
  });

  it('sends the identical Overpass query to every mirror it tries', async () => {
    const seen = stubFetch(onlyMirrorAnswers(MIRROR_B));
    await ladderAdapter([MIRROR_A, MIRROR_B]).fetch(region);
    const query = (url: string): string => url.slice(url.indexOf('?data='));
    expect(seen).toHaveLength(2);
    expect(query(seen[0] ?? '')).toBe(query(seen[1] ?? ''));
    expect(decodeURIComponent(seen[0] ?? '')).toContain('(32,-124,42,-114)');
  });

  it('falls through a mirror that answers 200 with an unparseable body', async () => {
    const seen = stubFetch((url) =>
      url.startsWith(MIRROR_A)
        ? new Response('<html>rate limited</html>', { status: 200 })
        : new Response(LIVE_BODY, { status: 200 }),
    );
    const res = await ladderAdapter([MIRROR_A, MIRROR_B]).fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(seen).toHaveLength(2);
    expect(res.value.records[0]?.provenance.source).toBe('OSM Overpass (mirror-b.example)');
  });

  it('degrades to the recorded mock when EVERY mirror fails, with an unlabelled source (F5 → OP3)', async () => {
    const seen = stubFetch(() => new Response('down', { status: 503 }));
    const res = await ladderAdapter([MIRROR_A, MIRROR_B, MIRROR_C]).fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(seen).toHaveLength(3); // every rung of the ladder was tried before degrading
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records).toHaveLength(3);
    expect(res.value.records[0]?.provenance.source).toBe('OSM Overpass'); // no mirror answered → no claim
  });

  it('counts ONE breaker failure for a whole failed ladder pass (the ladder runs inside the breaker)', async () => {
    stubFetch(() => new Response('down', { status: 503 }));
    const adapter = ladderAdapter([MIRROR_A, MIRROR_B, MIRROR_C]);
    await adapter.fetch(region);
    expect(adapter.health().consecutiveFailures).toBe(1); // 3 mirrors tried, 1 breaker trip
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.health().lastError?.message).toContain('all 3 mirror(s) failed');
  });

  it('preserves the single-endpoint default: no mirror list ⇒ exactly one request to the configured URL', async () => {
    const seen = stubFetch(() => new Response(LIVE_BODY, { status: 200 }));
    const adapter = new OsmOverpassAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://single.example/api/interpreter' }),
      breaker: LADDER_BREAKER,
    });
    expect(adapter.mirrors).toEqual(['https://single.example/api/interpreter']);
    const res = await adapter.fetch(region);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.startsWith('https://single.example/api/interpreter?data=')).toBe(true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records[0]?.provenance.source).toBe('OSM Overpass (single.example)');
  });

  it('keeps provenance per fetch: concurrent regions each record their OWN answering mirror', async () => {
    stubFetch((url) => {
      const isRo = decodeURIComponent(url).includes('(43,20,48,30)');
      return isRo && url.startsWith(MIRROR_A)
        ? new Response('down', { status: 503 })
        : new Response(LIVE_BODY, { status: 200 });
    });
    const adapter = ladderAdapter([MIRROR_A, MIRROR_B]);
    const [ca, ro] = await Promise.all([adapter.fetch(region), adapter.fetch(RO_REGION)]);
    expect(ca?.ok).toBe(true);
    expect(ro?.ok).toBe(true);
    if (ca?.ok !== true || ro?.ok !== true) return;
    expect(ca.value.records[0]?.provenance.source).toBe('OSM Overpass (mirror-a.example)');
    expect(ro.value.records[0]?.provenance.source).toBe('OSM Overpass (mirror-b.example)');
  });

  it('never lets a malformed mirror string break provenance (bare source name, no throw)', async () => {
    stubFetch(() => new Response(LIVE_BODY, { status: 200 }));
    const res = await ladderAdapter(['not-a-url']).fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records[0]?.provenance.source).toBe('OSM Overpass');
  });
});

describe('OsmOverpassAdapter User-Agent (the public instances answer 406 to an anonymous client)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetchWithInit(): { headers: Record<string, string>[] } {
    const seen: Record<string, string>[] = [];
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      seen.push({ ...((init?.headers as Record<string, string> | undefined) ?? {}) });
      return Promise.resolve(new Response(LIVE_BODY, { status: 200 }));
    });
    return { headers: seen };
  }

  it('sends the descriptive default User-Agent on every live request', async () => {
    const seen = stubFetchWithInit();
    const adapter = new OsmOverpassAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
    });
    await adapter.fetch(region);
    expect(seen.headers).toHaveLength(1);
    expect(seen.headers[0]?.['user-agent']).toBe(DEFAULT_USER_AGENT);
    expect(DEFAULT_USER_AGENT).toMatch(/^BEACON\//);
  });

  it('lets the operator identify the deployment with SOURCE_OSM_OVERPASS_USER_AGENT', async () => {
    const seen = stubFetchWithInit();
    const made = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_MODE: 'LIVE',
      SOURCE_OSM_OVERPASS_USER_AGENT: 'BEACON county-eoc (contact: ops@example.org)',
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    await made.value.fetch(region);
    expect(seen.headers[0]?.['user-agent']).toBe('BEACON county-eoc (contact: ops@example.org)');
  });

  it('falls back to the default when the override is blank', () => {
    const made = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_MODE: 'MOCK',
      SOURCE_OSM_OVERPASS_USER_AGENT: '',
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect((made.value as unknown as { userAgent: string }).userAgent).toBe(DEFAULT_USER_AGENT);
  });
});

describe('parseMirrorsEnv (SOURCE_OSM_OVERPASS_MIRRORS)', () => {
  it('splits an ordered ladder, trimming blanks and de-duplicating while preserving order', () => {
    const res = parseMirrorsEnv(` ${MIRROR_A} , ${MIRROR_B} ,, ${MIRROR_A} `);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([MIRROR_A, MIRROR_B]);
  });

  it('treats unset or blank as "no ladder configured"', () => {
    const unset = parseMirrorsEnv(undefined);
    const blank = parseMirrorsEnv('   ');
    expect(unset.ok && unset.value).toEqual([]);
    expect(blank.ok && blank.value).toEqual([]);
  });

  it('fails fast (CONFIG) on an entry that is not an absolute http(s) URL', () => {
    for (const bad of [
      'overpass-api.de/api/interpreter',
      'ftp://overpass.example/api',
      'javascript:alert(1)',
    ]) {
      const res = parseMirrorsEnv(`${MIRROR_A},${bad}`);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.kind).toBe('CONFIG');
      expect(res.error.message).toContain(bad);
    }
  });

  it('fails fast (CONFIG) when the list holds only separators', () => {
    const res = parseMirrorsEnv(' , , ');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

describe('makeOsmOverpassAdapter mirror config', () => {
  it('builds the ladder from SOURCE_OSM_OVERPASS_MIRRORS, in order', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_MIRRORS: `${MIRROR_A},${MIRROR_B}`,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mirrors).toEqual([MIRROR_A, MIRROR_B]);
  });

  it('defaults to the single verified primary endpoint when nothing is configured', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mirrors).toEqual(['https://overpass-api.de/api/interpreter']);
  });

  it('uses SOURCE_OSM_OVERPASS_URL as a single-mirror ladder when no list is set', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_URL: 'https://overpass.private.example/api/interpreter',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mirrors).toEqual(['https://overpass.private.example/api/interpreter']);
  });

  it('lets SOURCE_OSM_OVERPASS_MIRRORS supersede SOURCE_OSM_OVERPASS_URL', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_URL: 'https://ignored.example/api/interpreter',
      SOURCE_OSM_OVERPASS_MIRRORS: `${MIRROR_A},${MIRROR_B}`,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mirrors).toEqual([MIRROR_A, MIRROR_B]);
  });

  it('fails fast at boot (CONFIG) on an invalid mirror list', () => {
    const res = makeOsmOverpassAdapter(mkEngine(new FakeCache()), {
      SOURCE_OSM_OVERPASS_MIRRORS: 'not-a-url',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<InfrastructureNode> {
  const entity = makeInfrastructureNode({
    id: asId<InfrastructureNodeId>('osm:node:1'),
    type: 'POWER',
    status: 'ONLINE',
    geom: { type: 'Point', coordinates: [-121.61, 39.72] },
    sourceId: asId<SourceId>('sid-seed'),
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: 'OSM Overpass',
          adapter: 'osm-overpass',
          fetchedAt,
          license: '© OpenStreetMap contributors (ODbL)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
