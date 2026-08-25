// BEACON — adapter-health handler tests (E7·routes; register row 16). DETERMINISTIC: fixed clock, the
// offline DEFAULT_SEED source catalogue, no network. Asserts: the RESPONDER+ gate, the envelope contract,
// the derived stale/degraded verdicts (including the fail-pessimistic unparseable-instant case), the
// aggregate status, and that a degraded fleet is still a 200.
import { describe, it, expect } from 'vitest';
import { handleAdapterHealth, type AdapterHealthData, type AdapterHealthDeps } from './adapter-health.js';
import { buildInteraction } from '@/main/build-core.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { RegionId } from '@/domain/value-objects/ids.js';
import type { Envelope, InteractionPort, SourceRef } from '@/ports/interaction.js';

const FIXED = '2026-07-05T22:00:00Z';

function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

function deps(interaction?: InteractionPort): AdapterHealthDeps {
  return {
    interaction: interaction ?? buildInteraction({ clock: () => FIXED, newId: counterIds(), env: {} }),
    clock: () => FIXED,
  };
}

/** A core that answers `sources` with exactly the rows a test needs (mode/freshness permutations). */
function sourceCore(sources: readonly SourceRef[], regionId = 'us-ca'): InteractionPort {
  return {
    handle: () =>
      Promise.resolve(
        ok({
          data: { regionId, sources: sources.map((s) => ({ sourceId: s.sourceId, mode: s.mode, fetchedAt: s.fetchedAt })) },
          provenance: sources,
          freshness: sources[0]?.fetchedAt,
        } as Envelope),
      ),
  };
}

const envelope = (body: unknown): Envelope => body as Envelope;
const dataOf = (body: unknown): AdapterHealthData => envelope(body).data as AdapterHealthData;

describe('handleAdapterHealth — GET /health/adapters', () => {
  it('refuses PUBLIC with 403 — the deployment degradation posture is not public (Art. XIII)', async () => {
    const res = await handleAdapterHealth({ role: 'PUBLIC' }, deps());
    expect(res.status).toBe(403);
    expect(envelope(res.body).errors?.[0]?.code).toBe('UNAUTHORIZED');
    expect(envelope(res.body).errors?.[0]?.message).toContain('RESPONDER+');
  });

  it('serves RESPONDER the default region catalogue with non-empty provenance + freshness (F1)', async () => {
    const res = await handleAdapterHealth({ role: 'RESPONDER' }, deps());
    expect(res.status).toBe(200);
    const env = envelope(res.body);
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.freshness).toBe(FIXED);
    const data = dataOf(res.body);
    expect(data.regionId).toBe('us-ca');
    expect(data.generatedAt).toBe(FIXED);
    expect(data.staleAfterSec).toBe(900);
    expect(data.adapters.map((a) => a.adapterId)).toEqual(['firms', 'nifc', 'nws', 'open-meteo']);
    expect(data.counts).toEqual({ total: 4, live: 0, cached: 0, mock: 4, stale: 0 });
    // Every offline source is MOCK ⇒ the whole fleet is on a fallback rung (Art. XVI honest labelling).
    expect(data.status).toBe('degraded');
    expect(data.adapters.every((a) => a.degraded)).toBe(true);
    expect(data.adapters.every((a) => a.ageSec === 0 && !a.stale)).toBe(true);
  });

  it('honours ?regionId= and serves that region only', async () => {
    const res = await handleAdapterHealth({ role: 'EM', regionId: asId<RegionId>('ro') }, deps());
    expect(res.status).toBe(200);
    expect(dataOf(res.body).adapters.map((a) => a.adapterId)).toEqual(['glofas', 'meteoalarm-ro']);
  });

  it('reports status=ok only when every adapter is LIVE and fresh', async () => {
    const core = sourceCore([{ sourceId: 'firms', mode: 'LIVE', fetchedAt: FIXED }]);
    const res = await handleAdapterHealth({ role: 'RESPONDER' }, deps(core));
    const data = dataOf(res.body);
    expect(data.status).toBe('ok');
    expect(data.counts).toEqual({ total: 1, live: 1, cached: 0, mock: 0, stale: 0 });
    expect(data.adapters[0]).toEqual({ adapterId: 'firms', mode: 'LIVE', fetchedAt: FIXED, ageSec: 0, stale: false, degraded: false });
  });

  it('flags a LIVE-but-old source as stale and degrades the aggregate status (still a 200)', async () => {
    // 1000 s before the fixed clock — past the 900 s adapter-contract cache TTL.
    const core = sourceCore([{ sourceId: 'firms', mode: 'LIVE', fetchedAt: '2026-07-05T21:43:20Z' }]);
    const res = await handleAdapterHealth({ role: 'RESPONDER' }, deps(core));
    expect(res.status).toBe(200);
    const data = dataOf(res.body);
    expect(data.adapters[0]?.ageSec).toBe(1000);
    expect(data.adapters[0]?.stale).toBe(true);
    expect(data.adapters[0]?.degraded).toBe(false); // the rung is LIVE; it is the AGE that is wrong
    expect(data.counts.stale).toBe(1);
    expect(data.status).toBe('degraded');
  });

  it('treats an unparseable fetchedAt as STALE with no ageSec (fails pessimistic, never green)', async () => {
    const core = sourceCore([{ sourceId: 'firms', mode: 'LIVE', fetchedAt: 'not-an-instant' }]);
    const data = dataOf((await handleAdapterHealth({ role: 'RESPONDER' }, deps(core))).body);
    expect(data.adapters[0]?.ageSec).toBeUndefined();
    expect(data.adapters[0]?.stale).toBe(true);
    expect(data.status).toBe('degraded');
  });

  it('counts each ladder rung separately (LIVE / CACHED / MOCK)', async () => {
    const core = sourceCore([
      { sourceId: 'a', mode: 'LIVE', fetchedAt: FIXED },
      { sourceId: 'b', mode: 'CACHED', fetchedAt: FIXED },
      { sourceId: 'c', mode: 'MOCK', fetchedAt: FIXED },
    ]);
    const data = dataOf((await handleAdapterHealth({ role: 'RESPONDER' }, deps(core))).body);
    expect(data.counts).toEqual({ total: 3, live: 1, cached: 1, mock: 1, stale: 0 });
  });

  it('never ships an empty provenance[] even when the region configures no sources (F1)', async () => {
    const empty: InteractionPort = {
      handle: () => Promise.resolve(ok({ data: { regionId: 'us-ca', sources: [] }, provenance: [] } as Envelope)),
    };
    const res = await handleAdapterHealth({ role: 'RESPONDER' }, deps(empty));
    expect(res.status).toBe(200);
    expect(envelope(res.body).provenance).toEqual([{ sourceId: 'adapter-registry', mode: 'LIVE', fetchedAt: FIXED }]);
    expect(envelope(res.body).freshness).toBe(FIXED);
    expect(dataOf(res.body).counts.total).toBe(0);
  });

  it('maps a core failure onto its HTTP status', async () => {
    const failing: InteractionPort = { handle: () => Promise.resolve(err(new DomainError('NOT_FOUND', 'no region'))) };
    const res = await handleAdapterHealth({ role: 'EM' }, deps(failing));
    expect(res.status).toBe(404);
  });
});
