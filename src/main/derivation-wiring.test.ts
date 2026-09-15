// BEACON — derivation WIRING proof (E-main; FR-3/FR-4/FR-12/FR-13, Art. XII). Proves the live request path
// COMPUTES the four engine outputs from the raw seed INPUTS — it does not serve pre-baked literals. The
// tell-tale: change a seed INPUT (move a substation out of the hazard) and the SitRep exposure count drops.
// Deterministic: fixed clock, Turf spatial, offline seed. No network.
import { describe, it, expect } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { RegionId, IncidentId } from '@/domain/value-objects/ids.js';
import type { InteractionRequest } from '@/ports/interaction.js';
import type { SitRep } from '@/domain/sitrep.js';
import { makeTurfSpatialPort } from '@/adapters/spatial/turf-spatial.js';
import type { CoreSeed } from '@/adapters/memory/memory-core.js';
import { makeMemoryMapReadModel } from '@/adapters/memory/memory-map.js';
import { buildInteraction } from './build-core.js';
import { DEFAULT_SEED } from './seed.js';
import { DEFAULT_MAP_SEED } from './map-seed.js';

const NOW = '2026-07-05T22:00:00Z';
const fixed = {
  clock: () => NOW,
  newId: ((): ((p: string) => string) => {
    let n = 0;
    return (p) => `${p}-${++n}`;
  })(),
};
const caReq: InteractionRequest = {
  channel: 'cli',
  actorRole: 'PUBLIC',
  receivedAt: NOW,
  command: { verb: 'sitrep', incidentId: asId<IncidentId>('us-ca-wildfire-demo') },
};

async function caSitRep(seed: CoreSeed): Promise<SitRep> {
  const core = buildInteraction({ env: {}, seed, ...fixed });
  const r = await core.handle(caReq);
  if (!isOk(r)) throw new Error('sitrep failed');
  return r.value.data as SitRep;
}
const exposureClaim = (s: SitRep): string =>
  s.fields.find((f) => f.field === 'exposure')!.claim ?? '';

describe('SitRep facts are COMPUTED from the seed inputs (not seeded)', () => {
  it('the default CA seed computes exposure=2, an ESCALATING trend, and a grounded priorities fact', async () => {
    const sitrep = await caSitRep(DEFAULT_SEED);
    expect(exposureClaim(sitrep)).toContain('2 electrical substations');
    expect(sitrep.trend).toBe('ESCALATING');
    const priorities = sitrep.fields.find((f) => f.field === 'priorities');
    expect(priorities?.claim).toContain('ca-substation-south'); // OFFLINE node ranks highest
    expect(priorities?.citations.length).toBeGreaterThan(0); // grounded (F2)
  });

  it('moving one substation OUT of the hazard drops the computed exposure count to 1', async () => {
    const ca = DEFAULT_SEED.incidents[0]!;
    const [keep] = ca.derivation.infrastructure;
    const moved = {
      ...ca.derivation.infrastructure[1]!,
      geom: { type: 'Point', coordinates: [-100, 10] } as const,
    };
    const seed: CoreSeed = {
      ...DEFAULT_SEED,
      incidents: [
        { ...ca, derivation: { ...ca.derivation, infrastructure: [keep!, moved] } },
        DEFAULT_SEED.incidents[1]!,
      ],
    };
    expect(exposureClaim(await caSitRep(seed))).toContain('1 electrical substations');
  });
});

describe('Map projection layers are COMPUTED from the seed inputs', () => {
  const map = makeMemoryMapReadModel(DEFAULT_MAP_SEED, makeTurfSpatialPort());

  it('CA computes 2 exposure rows + a FIRE_CONE prediction', async () => {
    const res = await map.sourceFor(asId<RegionId>('us-ca'));
    if (!isOk(res) || res.value === null) throw new Error('no CA source');
    expect(res.value.exposure).toHaveLength(2);
    expect(res.value.predictions).toHaveLength(1); // the seeds are single-prediction today (ADR-033 §3.1)
    expect(res.value.predictions[0]?.kind).toBe('FIRE_CONE');
    expect(res.value.predictions[0]?.geom?.type).toBe('Polygon'); // an actual computed cone
  });

  it('RO computes 1 exposure row + a FLOOD_INUNDATION prediction', async () => {
    const res = await map.sourceFor(asId<RegionId>('ro'));
    if (!isOk(res) || res.value === null) throw new Error('no RO source');
    expect(res.value.exposure).toHaveLength(1);
    expect(res.value.predictions).toHaveLength(1);
    expect(res.value.predictions[0]?.kind).toBe('FLOOD_INUNDATION');
  });

  it('unknown region → null (→ 404 upstream)', async () => {
    const res = await map.sourceFor(asId<RegionId>('atlantis'));
    expect(isOk(res) && res.value === null).toBe(true);
  });
});
