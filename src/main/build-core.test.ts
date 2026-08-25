// BEACON — composition-root tests (E-main). Deterministic: fixed injected clock (past), counter id minter,
// default offline seed. Proves the wired core works air-gapped end-to-end via the single InteractionPort.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { InteractionRequest } from '@/ports/interaction.js';
import type { AICompliancePort, ComplianceRequest, VisionFinding, VisionMediatePayload } from '@/ports/intel.js';
import type { RegionReadModel, SourceReadModel } from '@/application/interaction/command-router.js';
import type { PublicReportPort } from '@/ports/public-report.js';
import { MemoryReadModel } from '@/adapters/memory/memory-core.js';

// W5 — resolveStore's postgres branch (B3 ruling: reports/regions/sources durable, incidents/COP always
// in-memory). Mock the db client + the pg read-model factories so `FEATURE_STORE=postgres` is provable
// WITHOUT a real database: no live connection, no network, fully deterministic.
const pg = vi.hoisted(() => ({
  db: { marker: 'fake-pg-client' as const },
  regionModel: { list: vi.fn(async () => ({ ok: true as const, value: [] })) },
  sourceModel: { list: vi.fn(async () => ({ ok: true as const, value: [] })) },
  reportStore: {
    intake: vi.fn(),
    triage: vi.fn(),
    list: vi.fn(async () => ({ ok: true as const, value: [] })),
    auditTrail: vi.fn(async () => ({ ok: true as const, value: [] })),
  },
}));
vi.mock('@/adapters/persistence/client.js', () => ({ makeDb: vi.fn(() => pg.db) }));
vi.mock('@/adapters/persistence/read-models.js', () => ({
  makePgRegionReadModel: vi.fn(() => pg.regionModel),
  makePgSourceReadModel: vi.fn(() => pg.sourceModel),
  makePgPublicReportStore: vi.fn(() => pg.reportStore),
}));
import { makeDb } from '@/adapters/persistence/client.js';
import { makePgRegionReadModel, makePgSourceReadModel, makePgPublicReportStore } from '@/adapters/persistence/read-models.js';
import { buildCore, buildInteraction, buildInteractionLive } from './build-core.js';

// Every manifest source prefix forced MOCK (W2a's enrich fns now consume the full catalogue, so a
// LIVE-default source omitted here would attempt a real network fetch — offline/deterministic tests).
const ALL_MOCK: Readonly<Record<string, string>> = Object.fromEntries(
  [
    'FIRMS', 'NWS', 'NWPS', 'GLOFAS', 'GDACS', 'METEOALARM_RO', 'OPEN_METEO', 'USGS_WATER',
    'GDELT', 'RELIEFWEB', 'AGENCYRSS', 'BLUESKY', 'MASTODON', 'METNO', 'ANM', 'HDXPOP', 'HIFLD', 'EONET', 'CEMSRM', 'OPENFEMA', 'CAPHUB', 'LANCEFLOOD', 'NRI', 'NIFC', 'EFFIS', 'OSM_OVERPASS', 'WORLDPOP',
    'CENSUS', 'NFHL', 'EAGLE_I', 'OPENCELLID', 'ITU', 'CAMARA_GSMA',
    'CALTRANS_CCTV', 'ALERTWILDFIRE', 'WINDY_WEBCAMS', 'DOT511', 'CNADNR_RO', // E11 cameras (caltrans defaults LIVE)
  ].map((p) => [`SOURCE_${p}_MODE`, 'MOCK']),
);

const NOW = '2026-07-05T22:00:00Z';
const fixed = { clock: () => NOW, newId: ((): ((p: string) => string) => { let n = 0; return (p) => `${p}-${++n}`; })() };

const req = (command: InteractionRequest['command'], actorRole: InteractionRequest['actorRole'] = 'PUBLIC'): InteractionRequest => ({
  channel: 'cli',
  actorRole,
  command,
  receivedAt: NOW,
});

describe('composition root — offline-first boot', () => {
  it('validates config fail-fast and exposes the default region', () => {
    const { config, services } = buildCore({ env: {}, ...fixed });
    expect(config.NODE_ENV).toBe('development');
    expect(services.defaultRegionId).toBe('us-ca');
  });

  it('rejects an invalid environment at boot (fail-fast)', () => {
    expect(() => buildCore({ env: { FEATURE_CACHE: 'redis' }, ...fixed })).toThrow(/REDIS_URL/);
  });

  it('status works air-gapped: seeded incidents + non-empty provenance (F1)', async () => {
    const core = buildInteraction({ env: {}, ...fixed });
    const r = await core.handle(req({ verb: 'status' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { incidentCount: number }).incidentCount).toBe(1);
    expect(r.value.provenance.every((p) => p.mode === 'MOCK')).toBe(true);
  });

  it('sitrep degrades to deterministic-only offline (AI off) yet stays cited (F2/F7)', async () => {
    const core = buildInteraction({ env: {}, ...fixed });
    const r = await core.handle(req({ verb: 'sitrep', incidentId: asId<IncidentId>('us-ca-wildfire-demo') }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { aiMode: string }).aiMode).toBe('deterministic-only');
    expect(r.value.citations?.length).toBeGreaterThan(0);
  });

  it('RO region resolves its own incident + sources', async () => {
    const core = buildInteraction({ env: {}, ...fixed });
    const r = await core.handle(req({ verb: 'sources', regionId: asId('ro') }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { sources: unknown[] }).sources.length).toBe(2);
  });
});

describe('composition root — live-adapter composition (opt-in, buildInteractionLive)', () => {
  it('DATA_SOURCE_COMPOSITION=adapters (all MOCK) computes status over adapter inputs, mode-labelled (F1)', async () => {
    // Exercises buildCoreLive → resolveSeed (live branch) → assembleServices end-to-end, deterministically
    // (all sources MOCK, no network). The offline sync buildInteraction path stays byte-identical (above).
    const core = await buildInteractionLive({ env: { DATA_SOURCE_COMPOSITION: 'adapters', ...ALL_MOCK }, ...fixed });
    const r = await core.handle(req({ verb: 'status' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { incidentCount: number }).incidentCount).toBeGreaterThan(0);
    expect(r.value.provenance.length).toBeGreaterThan(0);
    expect(r.value.provenance.every((p) => ['LIVE', 'CACHED', 'MOCK'].includes(p.mode))).toBe(true);
  });

  it('falls back to the offline seed when the flag is absent (buildInteractionLive == offline)', async () => {
    const core = await buildInteractionLive({ env: {}, ...fixed });
    const r = await core.handle(req({ verb: 'status' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { incidentCount: number }).incidentCount).toBe(1);
  });
});

// W4c — vision-assist composition (E6·T-290/T-291): FEATURE_VISION gates whether `services.vision` is
// wired at all (absent by default, byte-identical to today); an explicit override always wins (tests).
describe('composition root — vision-assist seam (FEATURE_VISION)', () => {
  it('FEATURE_VISION=off (default): services.vision is ABSENT — no field, not just a disabled stub', () => {
    const { services } = buildCore({ env: {}, ...fixed });
    expect(services.vision).toBeUndefined();
  });

  it('FEATURE_VISION=on: services.vision is a sealed AICompliancePort that mediates vision.analyze', async () => {
    const { services } = buildCore({ env: { FEATURE_VISION: 'on' }, ...fixed });
    expect(services.vision).toBeDefined();
    const payload: VisionMediatePayload = {
      request: { imageRef: 'fixtures/vision/sentinel2-burn-area-crop-001.png', task: 'burn-area' },
      context: { imageConsented: true, piiScreened: true },
    };
    const request: ComplianceRequest<VisionMediatePayload> = {
      actorRole: 'VERIFIER',
      modelTier: 'VISION',
      operation: 'vision.analyze',
      payload,
    };
    const res = await services.vision!.mediate<VisionMediatePayload, VisionFinding>(request);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.allowed).toBe(true);
    expect(res.value.result?.label).toBe('possible burn scar');
  });

  it('an injected `vision` override always wins over FEATURE_VISION (test seam)', () => {
    const stub: AICompliancePort = { mediate: async () => ({ ok: true, value: { allowed: false, reason: 'stub' } }) };
    const { services } = buildCore({ env: {}, vision: stub, ...fixed });
    expect(services.vision).toBe(stub);
  });
});

// W5 — resolveStore's durable-Postgres branch (Phase-B lane B3 ruling), proven with a MOCKED db client so
// no real database/network is ever touched. FEATURE_STORE default stays memory; =postgres swaps ONLY the
// durable, audit-critical stores (reports/regions/sources) — the incident COP always derives in memory.
describe('composition root — durable store (FEATURE_STORE=postgres, mocked db)', () => {
  const REAL_DATABASE_URL = 'postgres://user:pass@example.invalid:5432/beacon'; // never dialed (db is mocked)

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FEATURE_STORE default (memory): never touches the db client or pg read-model factories', () => {
    const { services, config } = buildCore({ env: {}, ...fixed });
    expect(config.FEATURE_STORE).toBe('memory');
    expect(makeDb).not.toHaveBeenCalled();
    expect(makePgRegionReadModel).not.toHaveBeenCalled();
    expect(makePgSourceReadModel).not.toHaveBeenCalled();
    expect(makePgPublicReportStore).not.toHaveBeenCalled();
    expect(services.regions).not.toBe(pg.regionModel);
    expect(services.sources).not.toBe(pg.sourceModel);
    expect(services.reports).not.toBe(pg.reportStore);
  });

  it('FEATURE_STORE=postgres: regions/sources/reports are the durable pg adapters, built off the mocked db', () => {
    const { services, config } = buildCore({
      env: { FEATURE_STORE: 'postgres', DATABASE_URL: REAL_DATABASE_URL },
      ...fixed,
    });
    expect(config.FEATURE_STORE).toBe('postgres');
    expect(makeDb).toHaveBeenCalledWith(REAL_DATABASE_URL);
    expect(makePgRegionReadModel).toHaveBeenCalledWith(pg.db);
    expect(makePgSourceReadModel).toHaveBeenCalledWith(pg.db);
    expect(makePgPublicReportStore).toHaveBeenCalledWith(pg.db, fixed.clock, fixed.newId);
    expect(services.regions).toBe(pg.regionModel as unknown as RegionReadModel);
    expect(services.sources).toBe(pg.sourceModel as unknown as SourceReadModel);
    expect(services.reports).toBe(pg.reportStore as unknown as PublicReportPort);
  });

  it('FEATURE_STORE=postgres: the incident/COP read-model is STILL in-memory (B3 — no pg incident read-model)', () => {
    const { services } = buildCore({
      env: { FEATURE_STORE: 'postgres', DATABASE_URL: REAL_DATABASE_URL },
      ...fixed,
    });
    expect(services.incidents).toBeInstanceOf(MemoryReadModel);
  });

  it('FEATURE_STORE=postgres end-to-end: status/sitrep resolve without ever dialing a real db (incidents in memory)', async () => {
    const core = buildInteraction({
      env: { FEATURE_STORE: 'postgres', DATABASE_URL: REAL_DATABASE_URL },
      ...fixed,
    });
    const r = await core.handle(req({ verb: 'status' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    // The seeded incident count still comes from the in-memory read-model (never routed to the mocked pg
    // db) — proving the postgres swap is scoped to the durable stores only, per the B3 ruling.
    expect((r.value.data as { incidentCount: number }).incidentCount).toBe(1);
  });

  it('an injected `reportStore` still wins over FEATURE_STORE=postgres (never double-built)', () => {
    const override: PublicReportPort = {
      intake: vi.fn(),
      triage: vi.fn(),
    } as unknown as PublicReportPort;
    const { services } = buildCore({
      env: { FEATURE_STORE: 'postgres', DATABASE_URL: REAL_DATABASE_URL },
      reportStore: override,
      ...fixed,
    });
    expect(services.reports).toBe(override);
    expect(makePgPublicReportStore).not.toHaveBeenCalled();
  });
});
