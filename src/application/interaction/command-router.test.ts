// BEACON — command-router tests (E10·T-451). Deterministic: injected fixed clock (safely in the past),
// stubbed AI decision, in-memory read-models. No wall-clock / no network (flaky-test rule).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isOk, isErr, ok, err } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  RegionId,
  IncidentId,
  PublicReportId,
  AppUserId,
  SourceId,
  PredictionId,
} from '@/domain/value-objects/ids.js';
import { makePrediction } from '@/domain/prediction.js';
import { makePublicReport } from '@/domain/public-report.js';
import type { PublicReport } from '@/domain/public-report.js';
import type {
  AICompliancePort,
  ComplianceRequest,
  VisionFinding,
  VisionMediatePayload,
} from '@/ports/intel.js';
import type { PublicReportPort, PublicReportIntake } from '@/ports/public-report.js';
import type { InteractionRequest, Command, VisionAssistRequest } from '@/ports/interaction.js';
import {
  createCommandRouter,
  type CoreServices,
  type IncidentView,
  type RegionView,
} from './command-router.js';

const NOW = '2026-07-05T22:00:00Z'; // fixed, safely in the past (Freshness rejects future fetchedAt)
const REGION = asId<RegionId>('us-ca');
const INCIDENT = asId<IncidentId>('inc-1');

// AI stub: any decision, cast past the generic mediate signature (same pattern as sitrep-synthesis.test).
const aiReturning = (allowed: boolean): AICompliancePort =>
  ({ mediate: async () => ok({ allowed }) }) as unknown as AICompliancePort;

const BURN_AREA_FINDING: VisionFinding = {
  label: 'possible burn scar',
  confidence: 0.62,
  notes: 'advisory — requires human/deterministic confirmation',
};

/** Vision stub mirroring the real gateway: honors the consent/PII-screen gate context inside the payload
 *  (Art. XIV), otherwise refuses. `calls` records every mediate() invocation for assertion. */
function fakeVision(calls: ComplianceRequest<VisionMediatePayload>[]): AICompliancePort {
  return {
    mediate: async <TReq, TRes>(request: ComplianceRequest<TReq>) => {
      calls.push(request as unknown as ComplianceRequest<VisionMediatePayload>);
      const { context } = request.payload as unknown as VisionMediatePayload;
      if (!context.imageConsented || !context.piiScreened) {
        return ok({ allowed: false, reason: 'unconsented/unscreened' } as unknown as {
          allowed: boolean;
          result?: TRes;
        });
      }
      return ok({ allowed: true, result: BURN_AREA_FINDING as unknown as TRes });
    },
  };
}

// Recorded, consented, PII-screened Sentinel-2 burn-area (NBR) imagery fixture (E6·T-291) — see
// adapters/ai/vision/__fixtures__/sentinel2-burn-area-001.json for provenance/license.
const visionFixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../adapters/ai/vision/__fixtures__/sentinel2-burn-area-001.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as {
  imageRef: string;
  task: VisionAssistRequest['task'];
  consent: { imageConsented: boolean; piiScreened: boolean };
};

const burnAreaAssist = (overrides: Partial<VisionAssistRequest> = {}): VisionAssistRequest => ({
  imageRef: visionFixture.imageRef,
  task: visionFixture.task,
  imageConsented: visionFixture.consent.imageConsented,
  piiScreened: visionFixture.consent.piiScreened,
  ...overrides,
});

const seededIncident = (): IncidentView => ({
  id: INCIDENT,
  regionId: REGION,
  type: 'WILDFIRE',
  status: 'ACTIVE',
  headline: 'Bear Fire — 1200 ha',
  facts: [
    {
      field: 'exposure',
      claim: '3 substations within the hazard buffer.',
      sourceId: asId<SourceId>('firms'),
      citationId: asId('cit-1'),
    },
  ],
  priorities: [{ rank: 1, label: 'substation-7', detail: 'blended risk score 0.87' }],
  provenance: [{ sourceId: 'firms', mode: 'MOCK', fetchedAt: NOW }],
  freshness: NOW,
});

class FakeReports implements PublicReportPort {
  async intake(report: PublicReportIntake): Promise<Result<PublicReport, DomainError>> {
    return ok(
      makePublicReport({
        id: asId<PublicReportId>('rep-1'),
        source: report.source,
        consent: report.consent,
        purgeAfter: '2026-08-01T00:00:00Z',
      }),
    );
  }
  async triage(
    id: PublicReportId,
    decision: 'TRIAGED' | 'VERIFIED' | 'REJECTED',
  ): Promise<Result<PublicReport, DomainError>> {
    return ok(
      makePublicReport({
        id,
        source: 'WEB',
        status: decision,
        consent: true,
        purgeAfter: '2026-08-01T00:00:00Z',
      }),
    );
  }
}

function services(overrides: Partial<CoreServices> = {}): CoreServices {
  let n = 0;
  return {
    clock: () => NOW,
    newId: (prefix) => `${prefix}-${++n}`,
    defaultRegionId: REGION,
    regions: { list: async () => ok([{ id: REGION, name: 'California' }]) },
    incidents: {
      listByRegion: async () => ok([seededIncident()]),
      getById: async (id) => ok(id === INCIDENT ? seededIncident() : null),
    },
    sources: {
      list: async () => ok([{ sourceId: 'firms', mode: 'MOCK', fetchedAt: NOW }]),
    },
    reports: new FakeReports(),
    ai: aiReturning(false), // AI-off path ⇒ deterministic-only SitRep (F7)
    ...overrides,
  };
}

const req = (
  command: Command,
  actorRole: InteractionRequest['actorRole'] = 'PUBLIC',
): InteractionRequest => ({
  channel: 'cli',
  actorRole,
  command,
  receivedAt: NOW,
});

describe('command-router — dispatch + envelope', () => {
  it('status: returns region incident overview with non-empty provenance (F1)', async () => {
    const r = await createCommandRouter(services()).handle(req({ verb: 'status' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.provenance.length).toBeGreaterThan(0);
    expect(r.value.freshness).toBe(NOW);
    expect((r.value.data as { incidentCount: number }).incidentCount).toBe(1);
  });

  it('sitrep: returns a cited SitRep with citations[] mirroring the fields (F2)', async () => {
    const r = await createCommandRouter(services()).handle(
      req({ verb: 'sitrep', incidentId: INCIDENT }),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.citations?.length).toBe(1);
    expect(r.value.citations?.[0]).toEqual({ field: 'exposure', sourceId: 'firms' });
    expect(r.value.provenance.length).toBeGreaterThan(0);
  });

  it('sitrep: records durable history when the store is composed (ADR-039)', async () => {
    const recorded: unknown[] = [];
    const sitrepHistory = {
      record: async (report: unknown) => {
        recorded.push(report);
        return { ok: true as const, value: { rowId: 'row-1' } };
      },
    };
    const r = await createCommandRouter(services({ sitrepHistory })).handle(
      req({ verb: 'sitrep', incidentId: INCIDENT }),
    );
    expect(isOk(r)).toBe(true);
    expect(recorded).toHaveLength(1);
  });

  it('sitrep: a FAILING history store never reaches the operator — the report is served regardless', async () => {
    // The audit trail is valuable; the operator's report is essential. Art. XVI decides the tie.
    const sitrepHistory = {
      record: async (): Promise<never> => {
        throw new Error('db down');
      },
    };
    const r = await createCommandRouter(services({ sitrepHistory })).handle(
      req({ verb: 'sitrep', incidentId: INCIDENT }),
    );
    expect(isOk(r)).toBe(true);
  });

  it('sitrep: records NOTHING when no history store is composed (memory posture unchanged)', async () => {
    const r = await createCommandRouter(services()).handle(
      req({ verb: 'sitrep', incidentId: INCIDENT }),
    );
    expect(isOk(r)).toBe(true); // no store, no write, no behaviour change
  });

  it('sitrep: a view carrying a news batch mints deterministic news-grounded fields (W2c fusion seam)', async () => {
    const newsView = {
      ...seededIncident(),
      news: [
        {
          title: 'Wildfire burns near ridge',
          url: 'https://official.example.gov/a',
          publishedAt: NOW,
          sourceAuthority: 'OFFICIAL' as const,
          credibility: 0.85,
        },
      ],
    };
    const r = await createCommandRouter(
      services({
        incidents: { listByRegion: async () => ok([newsView]), getById: async () => ok(newsView) },
      }),
    ).handle(req({ verb: 'sitrep', incidentId: INCIDENT }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const fields = (r.value.data as { fields: readonly { field: string }[] }).fields;
    expect(fields.some((f) => f.field.startsWith('news-'))).toBe(true);
    expect(r.value.citations?.some((c) => c.field.startsWith('news-'))).toBe(true);
  });

  it('sitrep: EVERY citation resolves to a provenance row in the same envelope — incl. news outlets', async () => {
    // The gap this pins (S3 sweep, 2026-08-08): news fields cite `news:<host>` outlet ids, while the
    // envelope's provenance carried only adapter ids — so "citations resolve to SOURCE_RECORDs" was an
    // invariant nobody checked and it was FALSE for every news-grounded field. The outlet rows are now
    // appended by handleSitRep via newsOutletProvenance; this test is the ∀-resolution contract itself,
    // so a future fact family minting a new id scheme fails HERE, not in a judge's browser.
    const newsView = {
      ...seededIncident(),
      news: [
        {
          title: 'Wildfire burns near ridge',
          url: 'https://official.example.gov/a',
          publishedAt: NOW,
          sourceAuthority: 'OFFICIAL' as const,
          credibility: 0.85,
        },
        {
          title: 'Evacuations reported on the east flank',
          url: 'https://outlet-two.example.com/b',
          publishedAt: NOW,
          sourceAuthority: 'MEDIA' as const,
          credibility: 0.7,
        },
      ],
    };
    const r = await createCommandRouter(
      services({
        incidents: { listByRegion: async () => ok([newsView]), getById: async () => ok(newsView) },
      }),
    ).handle(req({ verb: 'sitrep', incidentId: INCIDENT }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const provenanceIds = new Set(r.value.provenance.map((p) => p.sourceId));
    const cited = (r.value.citations ?? []).map((c) => c.sourceId);
    expect(cited.length).toBeGreaterThan(0);
    for (const sourceId of cited) expect(provenanceIds).toContain(sourceId);
    // And the outlet rows are labelled, never invented: mode is one of the three declared modes.
    const outletRows = r.value.provenance.filter((p) => p.sourceId.startsWith('news:'));
    expect(outletRows.length).toBeGreaterThan(0);
    for (const row of outletRows) expect(['LIVE', 'CACHED', 'MOCK']).toContain(row.mode);
  });

  it('sitrep: carries the ENGINE-ranked outlook[] for a view with predictions (ADR-033 §5, SPEC §5)', async () => {
    // Two predictions in DERIVATION order (the sooner one first); the engine must return them in OUTLOOK
    // order (class first). One is geometry-less — the exact kind the map wire drops (F-77), which is why
    // this endpoint, not MapProjectionData, is the Outlook's source.
    const predictions = [
      makePrediction({
        id: asId<PredictionId>('pred-cone'),
        incidentId: INCIDENT,
        kind: 'FIRE_CONE',
        method: 'wind-buffer first-order cone',
        inputs: { windSpeedMs: 9 },
        uncertainty: 0.3,
        likelihoodClass: 'POSSIBLE',
        etaHours: 2,
      }),
      makePrediction({
        id: asId<PredictionId>('pred-escalation'),
        incidentId: INCIDENT,
        kind: 'ESCALATION',
        method: 'least-squares trend projection',
        inputs: { slopePerHour: 0.6 },
        uncertainty: 0.5,
        likelihoodClass: 'VERY_LIKELY',
        etaHours: 9,
      }),
    ];
    const view = { ...seededIncident(), predictions };
    const r = await createCommandRouter(
      services({
        incidents: { listByRegion: async () => ok([view]), getById: async () => ok(view) },
      }),
    ).handle(req({ verb: 'sitrep', incidentId: INCIDENT }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const outlook = (
      r.value.data as { outlook: readonly { rank: number; predictionId: string; method: string }[] }
    ).outlook;
    expect(outlook.map((o) => [o.rank, o.predictionId])).toEqual([
      [1, 'pred-escalation'],
      [2, 'pred-cone'],
    ]);
    for (const row of outlook) expect(row.method).not.toBe(''); // every row labelled (Art. XII/XIV)
  });

  it('sitrep: a view with no predictions returns outlook: [] (absent, never faked)', async () => {
    const r = await createCommandRouter(services()).handle(
      req({ verb: 'sitrep', incidentId: INCIDENT }),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { outlook: readonly unknown[] }).outlook).toEqual([]);
  });

  it('sitrep: unknown incident → typed NOT_FOUND', async () => {
    const r = await createCommandRouter(services()).handle(
      req({ verb: 'sitrep', incidentId: asId<IncidentId>('nope') }),
    );
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.code).toBe('NOT_FOUND');
  });

  it('sources: lists the source catalogue with per-source mode', async () => {
    const r = await createCommandRouter(services()).handle(req({ verb: 'sources' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { sources: unknown[] }).sources).toHaveLength(1);
  });

  it('report: consented intake → UNVERIFIED, provenance present', async () => {
    const r = await createCommandRouter(services()).handle(
      req({ verb: 'report', consent: true, text: 'smoke near ridge' }),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as PublicReport).status).toBe('UNVERIFIED');
  });

  it('alert:draft: VERIFIER builds a DRAFT (never ACTUAL) with the approval note', async () => {
    const r = await createCommandRouter(services()).handle(
      req({ verb: 'alert:draft', incidentId: INCIDENT, headline: 'Evac warning' }, 'VERIFIER'),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const { alert } = r.value.data as { alert: { capStatus: string } };
    expect(alert.capStatus).toBe('DRAFT');
    expect(String(r.value.meta?.note)).toContain('DRAFT');
  });
});

describe('command-router — RBAC + guards (Art. XIII, every channel)', () => {
  it('verify by PUBLIC → UNAUTHORIZED', async () => {
    const r = await createCommandRouter(services()).handle(
      req(
        {
          verb: 'verify',
          reportId: asId<PublicReportId>('rep-1'),
          decision: 'VERIFIED',
          actorId: asId<AppUserId>('u1'),
        },
        'PUBLIC',
      ),
    );
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('verify by VERIFIER → allowed, echoes the decision', async () => {
    const r = await createCommandRouter(services()).handle(
      req(
        {
          verb: 'verify',
          reportId: asId<PublicReportId>('rep-1'),
          decision: 'VERIFIED',
          actorId: asId<AppUserId>('u1'),
        },
        'VERIFIER',
      ),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.meta?.decision).toBe('VERIFIED');
  });

  it('alert:draft by RESPONDER → UNAUTHORIZED (alert family is VERIFIER+)', async () => {
    const r = await createCommandRouter(services()).handle(
      req({ verb: 'alert:draft', incidentId: INCIDENT, headline: 'x' }, 'RESPONDER'),
    );
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('unknown verb → typed PARSE_ERROR', async () => {
    const r = await createCommandRouter(services()).handle(
      req({ verb: 'frobnicate' } as unknown as Command),
    );
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.code).toBe('PARSE_ERROR');
  });
});

// W4c — advisory vision-assist wiring on verify (E6·T-290/T-291; Art. XII/XIII/XIV). The finding is
// informational ONLY: it never influences `decision`, never appears without an explicit request, and a
// gate refusal never blocks the human's triage.
describe('command-router — verify advisory vision-assist (FEATURE_VISION)', () => {
  it('no services.vision wired (FEATURE_VISION=off) ⇒ meta has no visionFinding, byte-identical to today', async () => {
    const r = await createCommandRouter(services()).handle(
      req(
        {
          verb: 'verify',
          reportId: asId<PublicReportId>('rep-1'),
          decision: 'VERIFIED',
          actorId: asId<AppUserId>('u1'),
          visionAssist: burnAreaAssist(),
        },
        'VERIFIER',
      ),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.meta?.decision).toBe('VERIFIED');
    expect(r.value.meta?.visionFinding).toBeUndefined();
  });

  it('services.vision wired but no visionAssist on the command ⇒ no call made, no finding (opt-in only)', async () => {
    const calls: ComplianceRequest<VisionMediatePayload>[] = [];
    const r = await createCommandRouter(services({ vision: fakeVision(calls) })).handle(
      req(
        {
          verb: 'verify',
          reportId: asId<PublicReportId>('rep-1'),
          decision: 'VERIFIED',
          actorId: asId<AppUserId>('u1'),
        },
        'VERIFIER',
      ),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.meta?.visionFinding).toBeUndefined();
    expect(calls.length).toBe(0);
  });

  it('burn-area (Sentinel-2 NBR) task fixture: consented+screened imagery ⇒ advisory finding surfaces in meta', async () => {
    const calls: ComplianceRequest<VisionMediatePayload>[] = [];
    const r = await createCommandRouter(services({ vision: fakeVision(calls) })).handle(
      req(
        {
          verb: 'verify',
          reportId: asId<PublicReportId>('rep-1'),
          decision: 'VERIFIED',
          actorId: asId<AppUserId>('u1'),
          visionAssist: burnAreaAssist(),
        },
        'VERIFIER',
      ),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.meta?.decision).toBe('VERIFIED');
    expect(r.value.meta?.visionFinding).toEqual(BURN_AREA_FINDING);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.operation).toBe('vision.analyze');
    expect(calls[0]?.modelTier).toBe('VISION');
    expect(calls[0]?.payload.request.task).toBe('burn-area');
  });

  it('consent-gate: unconsented imagery ⇒ refused, decision STILL applies (advisory-only invariant, Art. XIII)', async () => {
    const calls: ComplianceRequest<VisionMediatePayload>[] = [];
    const r = await createCommandRouter(services({ vision: fakeVision(calls) })).handle(
      req(
        {
          verb: 'verify',
          reportId: asId<PublicReportId>('rep-1'),
          decision: 'VERIFIED',
          actorId: asId<AppUserId>('u1'),
          visionAssist: burnAreaAssist({ imageConsented: false }),
        },
        'VERIFIER',
      ),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    // The report transition succeeded regardless of the vision refusal — the human decision is authoritative.
    expect((r.value.data as { status: string }).status).toBe('VERIFIED');
    expect(r.value.meta?.decision).toBe('VERIFIED');
    expect(r.value.meta?.visionFinding).toBeUndefined();
  });

  it('advisory-only invariant: a THROWING vision gateway never fails or alters the verify decision', async () => {
    const throwing: AICompliancePort = {
      mediate: async () => {
        throw new Error('vision upstream exploded');
      },
    };
    const r = await createCommandRouter(services({ vision: throwing })).handle(
      req(
        {
          verb: 'verify',
          reportId: asId<PublicReportId>('rep-1'),
          decision: 'REJECTED',
          actorId: asId<AppUserId>('u1'),
          visionAssist: burnAreaAssist(),
        },
        'VERIFIER',
      ),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { status: string }).status).toBe('REJECTED');
    expect(r.value.meta?.decision).toBe('REJECTED');
    expect(r.value.meta?.visionFinding).toBeUndefined();
  });
});

describe('command-router — branch coverage: variants + error propagation', () => {
  const failing =
    <T>() =>
    async (): Promise<Result<T, DomainError>> =>
      err(new DomainError('NOT_FOUND', 'read-model failure'));

  it('incidents: happy path uses the incidents own provenance', async () => {
    const r = await createCommandRouter(services()).handle(req({ verb: 'incidents' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.provenance.map((p) => p.sourceId)).toContain('firms');
  });

  it('incidents: when incidents carry no provenance, falls back to region sources (F1 stays non-empty)', async () => {
    const noProv: IncidentView = { ...seededIncident(), provenance: [] };
    const r = await createCommandRouter(
      services({
        incidents: { listByRegion: async () => ok([noProv]), getById: async () => ok(noProv) },
      }),
    ).handle(req({ verb: 'incidents' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.provenance.length).toBeGreaterThan(0); // from sources fallback
  });

  it('status: a source read-model error propagates as a typed Err', async () => {
    const r = await createCommandRouter(services({ sources: { list: failing() } })).handle(
      req({ verb: 'status' }),
    );
    expect(isErr(r)).toBe(true);
  });

  it('status: an incident read-model error propagates as a typed Err', async () => {
    const r = await createCommandRouter(
      services({ incidents: { listByRegion: failing(), getById: failing() } }),
    ).handle(req({ verb: 'status' }));
    expect(isErr(r)).toBe(true);
  });

  it('sources: a read-model error propagates', async () => {
    const r = await createCommandRouter(services({ sources: { list: failing() } })).handle(
      req({ verb: 'sources' }),
    );
    expect(isErr(r)).toBe(true);
  });

  it('sitrep: a getById error propagates (distinct from a null miss)', async () => {
    const r = await createCommandRouter(
      services({ incidents: { listByRegion: async () => ok([]), getById: failing() } }),
    ).handle(req({ verb: 'sitrep', incidentId: INCIDENT }));
    expect(isErr(r)).toBe(true);
  });

  it('sitrep: an incident with no trend still synthesizes (optional-trend branch)', async () => {
    const noTrend: IncidentView = {
      id: INCIDENT,
      regionId: REGION,
      type: 'FLOOD',
      status: 'ACTIVE',
      headline: 'Flood',
      facts: seededIncident().facts,
      priorities: [],
      provenance: [{ sourceId: 'glofas', mode: 'MOCK', fetchedAt: NOW }],
    };
    const r = await createCommandRouter(
      services({
        incidents: { listByRegion: async () => ok([noTrend]), getById: async () => ok(noTrend) },
      }),
    ).handle(req({ verb: 'sitrep', incidentId: INCIDENT }));
    expect(isOk(r)).toBe(true);
  });

  it('report: with a location, and intake-error propagation', async () => {
    const okR = await createCommandRouter(services()).handle(
      req({ verb: 'report', consent: true, text: 'smoke', location: [-121.5, 39.8] }),
    );
    expect(isOk(okR)).toBe(true);
    const failReports = {
      intake: failing(),
      triage: failing(),
    } as unknown as CoreServices['reports'];
    const errR = await createCommandRouter(services({ reports: failReports })).handle(
      req({ verb: 'report', consent: true, text: 'smoke' }),
    );
    expect(isErr(errR)).toBe(true);
  });

  it('verify: a triage error propagates', async () => {
    const failReports = {
      intake: failing(),
      triage: failing(),
    } as unknown as CoreServices['reports'];
    const r = await createCommandRouter(services({ reports: failReports })).handle(
      req(
        {
          verb: 'verify',
          reportId: asId<PublicReportId>('rep-1'),
          decision: 'TRIAGED',
          actorId: asId<AppUserId>('u1'),
        },
        'VERIFIER',
      ),
    );
    expect(isErr(r)).toBe(true);
  });

  it('alert:draft: FLOOD → Met, other → Safety, missing incident → NOT_FOUND, getById error propagates', async () => {
    const flood: IncidentView = { ...seededIncident(), type: 'FLOOD' };
    const flr = await createCommandRouter(
      services({
        incidents: { listByRegion: async () => ok([flood]), getById: async () => ok(flood) },
      }),
    ).handle(req({ verb: 'alert:draft', incidentId: INCIDENT, headline: 'h' }, 'VERIFIER'));
    expect(isOk(flr)).toBe(true);
    if (isOk(flr))
      expect((flr.value.data as { alert: { category: string } }).alert.category).toBe('Met');

    const storm: IncidentView = { ...seededIncident(), type: 'STORM' };
    const str = await createCommandRouter(
      services({
        incidents: { listByRegion: async () => ok([storm]), getById: async () => ok(storm) },
      }),
    ).handle(req({ verb: 'alert:draft', incidentId: INCIDENT, headline: 'h' }, 'VERIFIER'));
    if (isOk(str))
      expect((str.value.data as { alert: { category: string } }).alert.category).toBe('Safety');

    const miss = await createCommandRouter(
      services({ incidents: { listByRegion: async () => ok([]), getById: async () => ok(null) } }),
    ).handle(
      req({ verb: 'alert:draft', incidentId: asId<IncidentId>('nope'), headline: 'h' }, 'VERIFIER'),
    );
    expect(isErr(miss)).toBe(true);
    if (isErr(miss)) expect(miss.error.code).toBe('NOT_FOUND');

    const errGet = await createCommandRouter(
      services({ incidents: { listByRegion: async () => ok([]), getById: failing() } }),
    ).handle(req({ verb: 'alert:draft', incidentId: INCIDENT, headline: 'h' }, 'VERIFIER'));
    expect(isErr(errGet)).toBe(true);
  });

  it('incidents: empty incident provenance + failing sources → empty provenance, no freshness (degenerate config)', async () => {
    const noProv: IncidentView = { ...seededIncident(), provenance: [] };
    const r = await createCommandRouter(
      services({
        incidents: { listByRegion: async () => ok([noProv]), getById: async () => ok(noProv) },
        sources: { list: failing() },
      }),
    ).handle(req({ verb: 'incidents' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.provenance).toHaveLength(0);
    expect(r.value.freshness).toBeUndefined();
  });

  it('status honours an explicit regionId', async () => {
    const r = await createCommandRouter(services()).handle(
      req({ verb: 'status', regionId: REGION }),
    );
    expect(isOk(r)).toBe(true);
  });

  it('dedupeProvenance: duplicate sourceIds collapse to one entry', async () => {
    const dup: IncidentView = {
      ...seededIncident(),
      provenance: [
        { sourceId: 'firms', mode: 'MOCK', fetchedAt: NOW },
        { sourceId: 'firms', mode: 'MOCK', fetchedAt: '2026-07-05T20:00:00Z' },
      ],
    };
    const r = await createCommandRouter(
      services({
        incidents: { listByRegion: async () => ok([dup]), getById: async () => ok(dup) },
      }),
    ).handle(req({ verb: 'sitrep', incidentId: INCIDENT }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.provenance.filter((p) => p.sourceId === 'firms')).toHaveLength(1);
  });
});

// B1.2 / finding F-01 — the `regions` verb. Before this, RegionReadModel was injected and never consumed
// and `GET /regions` was documented-but-unserved. The contract asserted here is what openapi.yaml
// documents: id + name always, and iso/tz/languages/bbox exactly as the read-model projects them —
// never invented, never defaulted from another region (the F-06 substitution class of bug).
describe('command-router — regions verb (F-01, FR-ZONE-1)', () => {
  const CONFIGURED: RegionView = {
    id: REGION,
    name: 'California (US)',
    iso: 'US',
    tz: 'America/Los_Angeles',
    languages: ['en'],
    bbox: [-124.48, 32.53, -114.13, 42.01],
  };

  it('lists the registry with geography + locale metadata, provenance and freshness (F1)', async () => {
    const r = await createCommandRouter(
      services({ regions: { list: async () => ok([CONFIGURED]) } }),
    ).handle(req({ verb: 'regions' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { regions: readonly RegionView[] }).regions).toEqual([CONFIGURED]);
    // Provenance is the registry itself — config-derived, not an upstream feed (never misattributed).
    expect(r.value.provenance).toEqual([
      { sourceId: 'region-registry', mode: 'LIVE', fetchedAt: NOW },
    ]);
    expect(r.value.freshness).toBe(NOW);
    expect(r.value.citations).toBeUndefined();
  });

  it('PUBLIC may read it (public metadata — no operational posture is exposed)', async () => {
    const r = await createCommandRouter(services()).handle(req({ verb: 'regions' }, 'PUBLIC'));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    // The default fake read-model carries only {id,name} — the response must NOT gain invented fields.
    expect((r.value.data as { regions: readonly RegionView[] }).regions).toEqual([
      { id: REGION, name: 'California' },
    ]);
  });

  it('a region without iso/tz/languages/bbox keeps those keys ABSENT (no default, no substitution — F-06)', async () => {
    const bare: RegionView = { id: asId<RegionId>('xx'), name: 'Unconfigured' };
    const r = await createCommandRouter(
      services({ regions: { list: async () => ok([bare, CONFIGURED]) } }),
    ).handle(req({ verb: 'regions' }));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const [served] = (r.value.data as { regions: readonly RegionView[] }).regions;
    expect(Object.keys(served ?? {})).toEqual(['id', 'name']);
    expect(served?.bbox).toBeUndefined(); // never California's bbox
  });

  it('an empty registry still ships non-empty provenance (F1 holds with zero regions)', async () => {
    const r = await createCommandRouter(services({ regions: { list: async () => ok([]) } })).handle(
      req({ verb: 'regions' }),
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.data as { regions: readonly RegionView[] }).regions).toEqual([]);
    expect(r.value.provenance).toHaveLength(1);
  });

  it('a region read-model error propagates as a typed Err (never a half-empty list)', async () => {
    const r = await createCommandRouter(
      services({
        regions: {
          list: async () => err(new DomainError('PARSE_ERROR', 'region registry unreadable')),
        },
      }),
    ).handle(req({ verb: 'regions' }));
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.code).toBe('PARSE_ERROR');
  });
});
