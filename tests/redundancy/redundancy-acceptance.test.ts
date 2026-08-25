// BEACON — redundancy ACCEPTANCE suites (E9·T-437; Article XVI / F5–F7). The three mandatory guarantees:
//   1. primary-source-down  — a failing/timing-out LIVE fetch degrades down the ladder (last-known-good
//                             cache → recorded-mock), labelled + never a dead-end. Also proves a downed
//                             Phase-D source (eagle-i) retains its seeded map slice (mirrors live-seed.ts).
//   2. offline / air-gapped — the whole stack runs with NO network: the source ladder serves recorded
//                             mock, AND the composition root drives the full golden path offline, AND the
//                             offline map seed renders the Phase-D slices (outages/cellSites/floodZones/
//                             weatherObservation), all honestly MOCK-labelled.
//   3. AI-disabled          — the SitRep degrades to deterministic-only yet stays cited (F7); the LLM
//                             never contributes a figure (Art. XII). AI-off parity: the deterministic
//                             news-grounding fusion pass (SitRepFacts.news) still lands cited facts.
// Deterministic per the flaky-test rule: the real RedundancyEngine over a fixed clock + a golden scenario,
// and the real composition root with a fixed past clock + counter id minter + empty env (no wall-clock/net).
import { describe, it, expect } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, RegionId } from '@/domain/value-objects/ids.js';
import type { InteractionRequest } from '@/ports/interaction.js';
import type { NewsItem } from '@/ports/intel.js';
import { buildInteraction } from '@/main/build-core.js';
import { DEFAULT_SEED } from '@/main/seed.js';
import { loadRegionRegistry } from '@/adapters/persistence/region-registry.js';
import { DEFAULT_MAP_SEED } from '@/main/map-seed.js';
import { buildAdapterRegistry, loadManifest } from '@/main/adapter-registry.js';
import { assembleLiveMapSeed } from '@/main/live-seed.js';
import type { CoreSeed } from '@/adapters/memory/memory-core.js';
import { makeMemoryMapReadModel } from '@/adapters/memory/memory-map.js';
import { makeInMemoryCache } from '@/adapters/cache/in-memory-cache.js';
import type { Region, SourceAdapterPort } from '@/adapters/_shared/index.js';
import { loadScenario } from '../_harness/index.js';
import { makeSeqUuidGen } from '../_harness/clock.js';
import { makeHarness, hazardSpec } from './redundancy-harness.js';

const NOW = '2026-07-05T22:00:00Z';

// The full manifest id set forced MOCK (mirrors src/main/live-seed.test.ts) — avoids a LIVE-without-key
// CONFIG error from the manifest defaults and keeps the registry build fully offline/deterministic.
// DERIVED FROM THE MANIFEST, NOT HAND-LISTED (fixed 2026-08-08). This was a hand-kept array that had to
// be extended for every new adapter, and forgetting a row is not a cosmetic miss: several sources default
// LIVE in the manifest, so an omission means this offline acceptance run reaches the real network — and
// `metno` fail-fasts on LIVE without its licence-mandated contact User-Agent, which makes
// `buildAdapterRegistry` itself return an error and every assertion below unreachable. Reading the
// manifest makes the force-MOCK set correct by construction.
const manifestRes = loadManifest();
if (!isOk(manifestRes)) throw new Error(`adapter manifest unreadable: ${manifestRes.error.message}`);
const ALL_IDS: readonly string[] = manifestRes.value.adapters.map((a) => a.id);
const ALL_MOCK: Readonly<Record<string, string>> = Object.fromEntries(ALL_IDS.map((id) => [id, 'MOCK']));

/** Replace an adapter with a stub that is DOWN (primary unavailable) — the seeded slice must survive (Art. XVI). */
function downStub(base: SourceAdapterPort): SourceAdapterPort {
  return { ...base, fetch: async () => ({ ok: false, error: { kind: 'UPSTREAM_UNAVAILABLE', message: 'down', retryable: true } }) };
}
const CA = loadScenario('california-wildfire');
const REGION: Region = { id: CA.region.id, bbox: CA.region.bbox };

const boom = (): Promise<never> => Promise.reject(new Error('primary source unreachable'));

// ── 1. Primary-source-down ──────────────────────────────────────────────────

describe('redundancy · primary-source-down (Art. XVI / F6)', () => {
  it('LIVE fetch throws, no cache → degrades to recorded-mock, labelled MOCK, never dead-ends', async () => {
    const { engine } = makeHarness();
    const res = await engine.run(hazardSpec(CA, { mode: 'LIVE', region: REGION, fetchLive: boom }));
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.mode).toBe('MOCK'); // degraded off the live rung
    expect(res.value.records.length).toBeGreaterThan(0); // still serves data (no dead-end)
  });

  it('LIVE succeeds once (seeds last-known-good) then throws → serves CACHED + degraded (F6)', async () => {
    const { engine } = makeHarness();
    const live = hazardSpec(CA, { mode: 'LIVE', region: REGION, fetchLive: () => Promise.resolve(CA.hazards) });
    const first = await engine.run(live);
    expect(isOk(first) && first.value.mode).toBe('LIVE'); // warm the cache

    const down = await engine.run(hazardSpec(CA, { mode: 'LIVE', region: REGION, fetchLive: boom }));
    expect(isOk(down)).toBe(true);
    if (!isOk(down)) return;
    expect(down.value.mode).toBe('CACHED');
    expect(down.value.degraded).toBe(true);
    expect(down.value.records.length).toBe(CA.hazards.length); // the real last-known-good data
  });

  it('a downed Phase-D source (eagle-i) retains the seeded map slice, never empties it (Art. XVI)', async () => {
    const reg = buildAdapterRegistry({
      cache: makeInMemoryCache(),
      env: {},
      sourceModeOverrides: ALL_MOCK,
      nowIso: () => NOW,
      idGen: makeSeqUuidGen(),
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    reg.value.set('eagle-i', downStub(reg.value.get('eagle-i')!));
    const regionRegistry = loadRegionRegistry();
    expect(regionRegistry.ok).toBe(true);
    if (!regionRegistry.ok) return;
    // The region registry is now REQUIRED: bbox/iso come from config, never from a duplicated fallback
    // table that could substitute another region's geography (finding F-06).
    const map = await assembleLiveMapSeed(reg.value, DEFAULT_MAP_SEED, () => NOW, regionRegistry.value);
    const ca = map['us-ca']!;
    const seededCa = DEFAULT_MAP_SEED['us-ca']!;
    expect(ca.outages).toBe(seededCa.outages); // eagle-i down ⇒ seeded CA_OUTAGES retained byte-for-byte
    expect(ca.outages?.length).toBeGreaterThan(0); // never emptied — no dead-end
  });
});

// ── 2. Offline / air-gapped ─────────────────────────────────────────────────

describe('redundancy · offline / air-gapped (Art. XVI / F5)', () => {
  it('source ladder in MOCK mode serves recorded data with zero network', async () => {
    const { engine } = makeHarness();
    const res = await engine.run(hazardSpec(CA, { mode: 'MOCK', region: REGION }));
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('composition root drives the full golden path offline (env={}, no keys, no egress)', async () => {
    let n = 0;
    const core = buildInteraction({ env: {}, clock: () => NOW, newId: (p) => `${p}-${++n}` });
    const req = (command: InteractionRequest['command'], role: InteractionRequest['actorRole'] = 'PUBLIC'): InteractionRequest => ({
      channel: 'cli',
      actorRole: role,
      command,
      receivedAt: NOW,
    });
    const incident = asId<IncidentId>('us-ca-wildfire-demo');

    for (const command of [
      req({ verb: 'status' }),
      req({ verb: 'sitrep', incidentId: incident }),
      req({ verb: 'report', consent: true, text: 'smoke rising' }),
      req({ verb: 'alert:draft', incidentId: incident, headline: 'Evac' }, 'VERIFIER'),
    ]) {
      const r = await core.handle(command);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.provenance.length).toBeGreaterThan(0); // F1 on every response, offline
    }
  });

  it('the offline map seed also renders the Phase-D slices (outages/cellSites/floodZones/weatherObservation), all MOCK-labelled', async () => {
    const map = makeMemoryMapReadModel(DEFAULT_MAP_SEED);
    const ca = await map.sourceFor(asId<RegionId>('us-ca'));
    expect(isOk(ca)).toBe(true);
    if (!isOk(ca) || ca.value === null) return;
    expect(ca.value.outages?.length).toBeGreaterThan(0); // eagle-i seed (CA_OUTAGES)
    expect(ca.value.cellSites?.length).toBeGreaterThan(0); // opencellid seed (CA_CELL_SITES)
    expect(ca.value.weather).toBeDefined(); // open-meteo seed (CA_WEATHER wind glyph)

    const ro = await map.sourceFor(asId<RegionId>('ro'));
    expect(isOk(ro)).toBe(true);
    if (!isOk(ro) || ro.value === null) return;
    expect(ro.value.floodZones?.length).toBeGreaterThan(0); // nfhl seed (RO_FLOOD_ZONES)

    // Every seeded provenance entry across both regions is honestly labelled MOCK — never presented as live.
    for (const src of [...ca.value.provenance, ...ro.value.provenance]) expect(src.mode).toBe('MOCK');
  });
});

// ── 3. AI-disabled ──────────────────────────────────────────────────────────

describe('redundancy · AI-disabled (Art. XII/XVI / F7)', () => {
  it('SitRep degrades to deterministic-only but stays cited; the LLM contributes no figure', async () => {
    let n = 0;
    const core = buildInteraction({ env: {}, clock: () => NOW, newId: (p) => `${p}-${++n}` });
    const r = await core.handle({
      channel: 'cli',
      actorRole: 'PUBLIC',
      command: { verb: 'sitrep', incidentId: asId<IncidentId>('us-ca-wildfire-demo') },
      receivedAt: NOW,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { aiMode: string }).aiMode).toBe('deterministic-only'); // AI off ⇒ no narration
    expect(r.value.citations?.length ?? 0).toBeGreaterThan(0); // still fully cited (F2/F7)
  });

  it('AI-off parity: the deterministic news-grounding fusion pass still lands cited facts when a news batch is present', async () => {
    const caIncidentId = asId<IncidentId>('us-ca-wildfire-demo');
    const newsItem: NewsItem = {
      title: 'Wildfire prompts evacuation orders near Butte County',
      url: 'https://apnews.com/article/ca-wildfire-evac',
      publishedAt: NOW,
      sourceAuthority: 'OFFICIAL',
    };
    const seed: CoreSeed = {
      ...DEFAULT_SEED,
      incidents: DEFAULT_SEED.incidents.map((i) => (i.id === caIncidentId ? { ...i, news: [newsItem] } : i)),
    };
    let n = 0;
    const core = buildInteraction({ env: {}, seed, clock: () => NOW, newId: (p) => `${p}-${++n}` });
    const r = await core.handle({
      channel: 'cli',
      actorRole: 'PUBLIC',
      command: { verb: 'sitrep', incidentId: caIncidentId },
      receivedAt: NOW,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const data = r.value.data as { aiMode: string; fields: readonly { field: string; citations: readonly { sourceId: string }[] }[] };
    expect(data.aiMode).toBe('deterministic-only'); // AI off ⇒ the fusion path never routes through the LLM
    const newsFields = data.fields.filter((f) => f.field.startsWith('news-'));
    expect(newsFields.length).toBeGreaterThan(0); // groundNews still ran deterministically (Art. XII/XIV)
    expect(newsFields.every((f) => f.citations.length > 0)).toBe(true); // still fully cited (F2/F7)
  });
});
