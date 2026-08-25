// BEACON — MemoryReportStore intake tests (Live Views v1.2, ADR-029). Deterministic: fixed clock, seq id,
// no IO/network. Asserts intake stamps `receivedAt` from the injected clock (the ~2h TTL basis) and persists
// the consent-gated citizen live-view link on the report.
import { describe, it, expect } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { RegionId, IncidentId, SourceId, CitationId, PublicReportId, AppUserId } from '@/domain/value-objects/ids.js';
import { makePublicReport } from '@/domain/public-report.js';
import { deriveIncidentFacts } from '@/application/derivation/derive-cop.js';
import type { IncidentDerivationInput } from '@/application/derivation/derive-cop.js';
import type { TrendSample } from '@/application/escalation-trend/escalation-trend.js';
import { FakeSpatial } from '../../../tests/_harness/fakes/fake-spatial.js';
import { MemoryReportStore, MemoryReadModel, defaultReportQueueSeed } from './memory-core.js';
import type { CoreSeed, IncidentSeed } from './memory-core.js';

const FIXED = '2026-07-05T22:00:00.000Z';
const clock = (): string => FIXED;
const seqId = (): ((p: string) => string) => {
  let n = 0;
  return (p: string): string => `${p}-${++n}`;
};

describe('MemoryReportStore.intake — receivedAt + liveViewUrl', () => {
  it('stamps receivedAt from the injected clock at intake', async () => {
    const store = new MemoryReportStore(clock, seqId());
    const res = await store.intake({ consent: true, source: 'WEB', text: 'smoke on the ridge' });
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.receivedAt).toBe(FIXED);
      expect(res.value.status).toBe('UNVERIFIED');
    }
  });

  // THE regression this file existed alongside without catching: every test here passed `text` into
  // intake (it is required by the port) and none asserted it came back, so the store dropping it on the
  // floor was invisible for the whole build. Without the claim the verifier queue is a blind approve.
  it('persists the reporter claim — the evidence the HITL decision rests on (Art. XIII)', async () => {
    const store = new MemoryReportStore(clock, seqId());
    const claim = 'Flames visible across the ridge, road out is filling with smoke';
    const res = await store.intake({ consent: true, source: 'WEB', text: claim });
    expect(isOk(res)).toBe(true);
    if (isOk(res)) expect(res.value.text).toBe(claim);
  });

  it('persists the consent-gated citizen live-view link on the report', async () => {
    const store = new MemoryReportStore(clock, seqId());
    const res = await store.intake({
      consent: true,
      source: 'WEB',
      text: 'streaming the fire front',
      liveViewUrl: 'https://twitch.tv/firewatch',
    });
    expect(isOk(res)).toBe(true);
    if (isOk(res)) expect(res.value.liveViewUrl).toBe('https://twitch.tv/firewatch');
  });
});

// ── MemoryReadModel — the DERIVED predictions reach the SitRep path (C2.3, ADR-033 §5) ────────────────
// The read-model does not mint predictions: `deriveIncidentFacts` computes them (C2.2) and this projection
// carries them onto the incident view so the outlook engine can rank them. Geometry-less by design, so this
// is the ONLY path they reach a reader by (finding F-77).

const REGION = asId<RegionId>('ro');
const INCIDENT = asId<IncidentId>('ro-flood-demo');

/** A rising gauge-stage series ⇒ classifyTrend says ESCALATING ⇒ the projectors emit both kinds. */
const RISING: readonly TrendSample[] = [
  { t: Date.parse('2026-07-05T16:00:00.000Z'), value: 3.0 },
  { t: Date.parse('2026-07-05T18:00:00.000Z'), value: 3.4 },
  { t: Date.parse('2026-07-05T20:00:00.000Z'), value: 3.9 },
  { t: Date.parse('2026-07-05T22:00:00.000Z'), value: 4.5 },
];

function seedWith(trendReadings: readonly TrendSample[]): CoreSeed {
  const derivation: IncidentDerivationInput = {
    incidentId: INCIDENT,
    hazards: [],
    infrastructure: [],
    buffers: {} as IncidentDerivationInput['buffers'],
    exposedPopulation: 8000,
    assetLabel: 'lifeline facilities',
    trendReadings,
    grounding: {
      exposure: { field: 'exposure', sourceId: asId<SourceId>('glofas'), citationId: asId<CitationId>('cit-exp') },
      priorities: { field: 'priorities', sourceId: asId<SourceId>('glofas'), citationId: asId<CitationId>('cit-pri') },
    },
    computedAt: FIXED,
  };
  const incident: IncidentSeed = {
    id: INCIDENT,
    regionId: REGION,
    type: 'FLOOD',
    status: 'ACTIVE',
    headline: 'Siret River flood (test)',
    provenance: [{ sourceId: 'glofas', mode: 'MOCK', fetchedAt: FIXED }],
    derivation,
  };
  return { defaultRegionId: REGION, regions: [], incidents: [incident], sources: {} };
}

describe('MemoryReadModel — derived predictions reach the incident view', () => {
  it('carries the derivation\'s predictions verbatim (same ids, same labelling)', async () => {
    const seed = seedWith(RISING);
    const derived = deriveIncidentFacts(seed.incidents[0]!.derivation, new FakeSpatial());
    if (!isOk(derived)) throw new Error('expected ok');
    expect(derived.value.predictions.length).toBeGreaterThan(0); // the fixture must actually project

    const res = await new MemoryReadModel(seed, new FakeSpatial()).getById(INCIDENT);
    if (!isOk(res) || res.value === null) throw new Error('expected a view');
    expect(res.value.predictions).toEqual(derived.value.predictions);
  });

  it('omits predictions entirely when nothing projected (absent, not an empty claim)', async () => {
    const res = await new MemoryReadModel(seedWith([]), new FakeSpatial()).getById(INCIDENT);
    if (!isOk(res) || res.value === null) throw new Error('expected a view');
    expect(res.value.predictions).toBeUndefined();
    expect(Object.keys(res.value)).not.toContain('predictions');
  });

  it('carries them on the region listing too (same projection, one code path)', async () => {
    const res = await new MemoryReadModel(seedWith(RISING), new FakeSpatial()).listByRegion(REGION);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value[0]!.predictions?.length).toBeGreaterThan(0);
  });
});

// ── RetentionStorePort on the OFFLINE DEFAULT store (MW-D/D4.3; finding F-25) ────────────────────────
// `purgeAfter` was stamped on every report from the start and nothing ever deleted an expired one, so the
// Art. XIV "no PII retention beyond the incident lifecycle" guarantee was claimed and unenforced. The sweep
// executor is store-agnostic, and this is the half that makes the guarantee hold in the DEFAULT (memory)
// configuration, not only when FEATURE_STORE=postgres.
describe('MemoryReportStore — retention seam (Art. XIV)', () => {
  const seededStore = (): MemoryReportStore =>
    new MemoryReportStore(clock, seqId(), 30, [
      makePublicReport({ id: asId<PublicReportId>('rep-old'), source: 'WEB', consent: true, purgeAfter: '2026-06-05T22:00:00.000Z' }),
      makePublicReport({ id: asId<PublicReportId>('rep-due'), source: 'SMS', consent: true, purgeAfter: FIXED }),
      makePublicReport({ id: asId<PublicReportId>('rep-live'), source: 'WEB', consent: true, purgeAfter: '2026-08-04T22:00:00.000Z' }),
    ]);

  it('labels itself honestly for the sweep report', () => {
    const store = seededStore();
    expect(store.storeLabel).toBe('memory');
    expect(store.datasetLabel).toBe('public_report');
  });

  it('reports every report at or before the cutoff (inclusive) and nothing else', async () => {
    const res = await seededStore().expired(FIXED);
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.map((c) => c.id)).toEqual(['rep-old', 'rep-due']);
      expect(res.value[1]?.purgeAfter).toBe(FIXED);
    }
  });

  it('refuses a non-instant cutoff rather than deleting on a NaN comparison', async () => {
    const res = await seededStore().expired('whenever');
    expect(isOk(res)).toBe(false);
  });

  it('HARD-deletes the rows — the report and everything on it is gone, not flagged', async () => {
    const store = seededStore();
    const intake = await store.intake({ consent: true, source: 'WEB', text: 'sos', location: [-121.5, 39.7], liveViewUrl: 'https://example.org/s' });
    if (!isOk(intake)) throw new Error('expected ok');
    expect(intake.value.geomPrecise).toBeDefined();

    const purged = await store.purge(['rep-old', 'rep-due', intake.value.id]);
    expect(isOk(purged) && purged.value).toBe(3);
    const left = await store.list();
    if (!isOk(left)) throw new Error('expected ok');
    expect(left.value.map((r) => r.id)).toEqual(['rep-live']);
    // Nothing survives with the precise SOS location or the live-view link on it.
    expect(JSON.stringify(left.value)).not.toContain('geomPrecise');
    expect(JSON.stringify(left.value)).not.toContain('liveViewUrl');
  });

  it('counts only what it actually removed (an unknown id is not a deletion)', async () => {
    const res = await seededStore().purge(['rep-old', 'rep-never-existed']);
    expect(isOk(res) && res.value).toBe(1);
  });

  it('leaves the triage audit trail intact — the chain holds ids, never PII, and must stay verifiable', async () => {
    const store = seededStore();
    await store.triage(asId<PublicReportId>('rep-old'), 'TRIAGED', asId<AppUserId>('u-ver-1'));
    await store.purge(['rep-old']);
    expect(store.auditTrail()).toHaveLength(1);
    expect(store.auditTrail()[0]?.reportId).toBe('rep-old');
  });
});

// ── F-417: the seeded verifier-queue rows must be LINKED to an incident that actually exists ───────────
//
// `emitCap` scopes its DRAFT CAP to the report's incident (F-362), so an UNLINKED report correctly answers
// `meta.capNotEmitted: "report is not linked to an incident"` and emits nothing. Both seeded queue rows
// were unlinked, which meant **"Approve + CAP" on either pre-seeded row did nothing at all** — on the
// Art. XIII surface, on the screen a presenter or judge is most likely to open first. The scripted golden
// path survived it only by accident (it files a fresh SOS with an incident selected).
//
// `memory-core.ts` cannot import the composition root (the `adapters-never-import-main` boundary), so it
// declares the demo incident id as a literal. THIS test is what stops that literal from silently rotting:
// a rename of the canonical id fails HERE rather than re-orphaning the demo reports in silence. Same
// "pin the pairing with a test where the type system cannot" idiom as the casualty-tally label sites.
describe('defaultReportQueueSeed — the demo reports are linked to a REAL incident (F-417)', () => {
  it('every seeded report carries an incidentId', () => {
    const seed = defaultReportQueueSeed('2026-08-04T22:00:00Z');
    expect(seed.length).toBeGreaterThan(0);
    for (const report of seed) {
      expect(report.incidentId, `${report.id} is unlinked — "Approve + CAP" would emit nothing`).toBeDefined();
    }
  });

  it('that incidentId IS the canonical CA demo incident — not a plausible-looking string', async () => {
    // Imported dynamically and only in the test: production code in this layer must not reach into main.
    const { CA_INCIDENT } = await import('@/main/scenario-inputs.js');
    for (const report of defaultReportQueueSeed('2026-08-04T22:00:00Z')) {
      expect(
        String(report.incidentId),
        `${report.id} points at "${String(report.incidentId)}" but the canonical demo incident is ` +
          `"${String(CA_INCIDENT)}" — the CAP path would resolve no incident and emit nothing`,
      ).toBe(String(CA_INCIDENT));
    }
  });
});
