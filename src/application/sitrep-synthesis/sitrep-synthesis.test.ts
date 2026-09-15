// BEACON — SitRep synthesis tests (E5·T-240/T-242/T-245). Proves the deterministic→AI→human contract:
// facts+citations assembled offline (F2), numbers come from the engine not the LLM (F3), the model is
// reached only via AICompliancePort, and ANY block/error/ungrounded output degrades to deterministic-only
// (F4/F7). Golden + error + edge triad.
import { describe, it, expect } from 'vitest';
import { asId, makeCitation, ok, err, isOk, isErr, DomainError } from '@/domain/index.js';
import type {
  Citation,
  SitRepId,
  IncidentId,
  SourceId,
  CitationId,
  PredictionId,
  Prediction,
} from '@/domain/index.js';
import { makePrediction } from '@/domain/index.js';
import type {
  AICompliancePort,
  ComplianceDecision,
  ComplianceRequest,
  Narrative,
  NewsItem,
} from '@/ports/intel.js';
import { synthesizeSitRep } from './sitrep-synthesis.js';
import type {
  GroundedFact,
  SynthesizeSitRepInput,
  SitRepSynthesisDeps,
} from './sitrep-synthesis.js';

const SITREP = asId<SitRepId>('sitrep-1');
const INCIDENT = asId<IncidentId>('inc-1');

function fact(field: string, claim: string, src: string): GroundedFact {
  return {
    field,
    claim,
    sourceId: asId<SourceId>(src),
    citationId: asId<CitationId>(`cit-${field}`),
  };
}

const DEFAULT_FACTS: GroundedFact[] = [
  fact('exposure', '2 hospitals are within the fire perimeter.', 'src-firms'),
  fact('crest', 'River is forecast to crest at 12.0 ft by 03:00Z.', 'src-nwps'),
];

function input(facts: GroundedFact[] = DEFAULT_FACTS): SynthesizeSitRepInput {
  return {
    id: SITREP,
    generatedAt: '2026-07-07T00:00:00.000Z',
    actorRole: 'EM',
    facts: { incidentId: INCIDENT, trend: 'ESCALATING', facts },
  };
}

function cite(src: string, field: string): Citation {
  return makeCitation({
    id: asId<CitationId>(`c-${src}`),
    sitrepId: SITREP,
    sourceId: asId<SourceId>(src),
    field,
    claim: 'x',
  });
}

/** Build an AICompliancePort that always returns the given decision (cast past the generic method). */
function aiReturning(decision: ComplianceDecision<Narrative>): AICompliancePort {
  return { mediate: async () => ok(decision) } as unknown as AICompliancePort;
}

const NARRATIVE: Narrative = {
  text: 'Two hospitals sit inside the fire perimeter while the river is forecast to crest tonight.',
  citations: [cite('src-firms', 'exposure'), cite('src-nwps', 'crest')],
};

describe('synthesizeSitRep — deterministic fact assembly (F2/F3)', () => {
  it('grounds every generated field with a citation (F2 — 100% coverage)', async () => {
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.fields).toHaveLength(2);
    for (const f of res.value.fields) expect(f.citations.length).toBeGreaterThan(0);
    expect(res.value.fields.map((f) => f.field)).toEqual(['exposure', 'crest']);
  });

  it('keeps field claims from the deterministic engine, not the LLM prose (F3)', async () => {
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    // The summary is the LLM prose, but each field claim remains the engine's exact sentence.
    expect(res.value.summary).toBe(NARRATIVE.text);
    expect(res.value.fields[0]!.claim).toBe('2 hospitals are within the fire perimeter.');
    expect(res.value.fields[1]!.claim).toBe('River is forecast to crest at 12.0 ft by 03:00Z.');
  });
});

describe('synthesizeSitRep — AI narration via the compliance gateway (T-244)', () => {
  it('uses grounded narration and labels aiMode cloud by default', async () => {
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('cloud');
    expect(res.value.summary).toBe(NARRATIVE.text);
    expect(res.value.trend).toBe('ESCALATING');
  });

  it('honours an explicit local aiMode label', async () => {
    const deps: SitRepSynthesisDeps = {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
      aiMode: 'local',
    };
    const res = await synthesizeSitRep(input(), deps);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('local');
  });

  it('routes only through mediate: operation llm.narrate, payload = the cited facts', async () => {
    let seen: ComplianceRequest<unknown> | undefined;
    const ai = {
      mediate: async (req: ComplianceRequest<unknown>) => {
        seen = req;
        return ok({ allowed: true, result: NARRATIVE });
      },
    } as unknown as AICompliancePort;
    await synthesizeSitRep(input(), { ai, modelTier: 'CLOUD' });
    expect(seen?.operation).toBe('llm.narrate');
    expect(seen?.actorRole).toBe('EM');
    const payload = seen?.payload as { facts: unknown[] };
    expect(payload.facts).toHaveLength(2);
  });
});

describe('synthesizeSitRep — degrade to deterministic-only (F4/F7)', () => {
  it('falls back when AI is disabled', async () => {
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
      aiEnabled: false,
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
    // Summary is the engine's own claims, joined — never the (unused) LLM text.
    expect(res.value.summary).toContain('2 hospitals are within the fire perimeter.');
    expect(res.value.summary).toContain('crest at 12.0 ft');
  });

  it('falls back when the gateway blocks the call (allowed=false)', async () => {
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: false, reason: 'policy' }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
  });

  it('falls back when allowed but no result is returned', async () => {
    const res = await synthesizeSitRep(input(), { ai: aiReturning({ allowed: true }) });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
  });

  it('falls back when the gateway errors', async () => {
    const ai = {
      mediate: async () => err(new DomainError('NOT_FOUND', 'proxy down')),
    } as unknown as AICompliancePort;
    const res = await synthesizeSitRep(input(), { ai });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
  });

  it('rejects ungrounded narration: empty prose', async () => {
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: true, result: { text: '   ', citations: NARRATIVE.citations } }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
  });

  it('rejects ungrounded narration: no citations', async () => {
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: true, result: { text: 'prose', citations: [] } }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
  });

  it('rejects narration that cites a source we never supplied (F4 — no invented references)', async () => {
    const rogue: Narrative = { text: 'prose', citations: [cite('src-unknown', 'exposure')] };
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: true, result: rogue }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
  });
});

describe('synthesizeSitRep — news/social fusion (Art. XII/XIV, W2c)', () => {
  const NEWS: NewsItem[] = [
    {
      title: 'Wildfire spreads near the ridge',
      url: 'https://nws.gov/a',
      publishedAt: '2026-07-06T10:00:00Z',
      sourceAuthority: 'OFFICIAL',
    },
    {
      title: 'Fire forces evacuations',
      url: 'https://reuters.com/b',
      publishedAt: '2026-07-06T11:00:00Z',
      sourceAuthority: 'MEDIA',
    },
    {
      title: 'Dam has collapsed, city underwater!!',
      url: 'https://bsky.app/c',
      publishedAt: '2026-07-06T12:00:00Z',
      sourceAuthority: 'SOCIAL',
    },
  ];
  function withNews(): SynthesizeSitRepInput {
    return {
      ...input(),
      facts: { ...input().facts, news: NEWS, newsOptions: { region: 'us-ca' } },
    };
  }

  it('merges a corroborated authoritative fact and a FLAGGED social fact into the SitRep fields', async () => {
    const res = await synthesizeSitRep(withNews(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    const claims = res.value.fields.map((f) => f.claim ?? '');
    expect(claims.some((c) => c.includes('2 authoritative sources report'))).toBe(true);
    expect(claims.some((c) => c.includes('Unverified social report'))).toBe(true);
    // The corroborated field carries a citation to EACH distinct authoritative outlet (F2 breadth).
    const corroborated = res.value.fields.find((f) =>
      (f.claim ?? '').includes('authoritative sources'),
    )!;
    expect(corroborated.citations.length).toBe(2);
  });

  it('AI-OFF parity: the deterministic-only summary shows the SAME grounded news facts', async () => {
    const res = await synthesizeSitRep(withNews(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
      aiEnabled: false,
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
    expect(res.value.summary).toContain('2 authoritative sources report');
    expect(res.value.summary).toContain('Unverified social report');
    // Same field set as the AI-on path (fusion happens BEFORE the model, so both rungs are identical).
    const onFields = await synthesizeSitRep(withNews(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    expect(isOk(onFields)).toBe(true);
    if (isOk(onFields))
      expect(res.value.fields.map((f) => f.field)).toEqual(
        onFields.value.fields.map((f) => f.field),
      );
  });

  it('lets the narrator cite a news-derived source (allowed-set includes news outlets)', async () => {
    const newsNarrative: Narrative = {
      text: 'Two authoritative outlets report a growing wildfire near the ridge.',
      citations: [cite('news:nws.gov', 'news-fire-1')],
    };
    const res = await synthesizeSitRep(withNews(), {
      ai: aiReturning({ allowed: true, result: newsNarrative }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('cloud'); // grounded → narration accepted
    expect(res.value.summary).toBe(newsNarrative.text);
  });

  it('social alone (no engine facts) still yields a valid, flagged-only SitRep', async () => {
    const social: NewsItem[] = [
      {
        title: 'Bridge washed away rumor',
        url: 'https://bsky.app/x',
        publishedAt: '2026-07-06T10:00:00Z',
        sourceAuthority: 'SOCIAL',
      },
    ];
    const onlySocial: SynthesizeSitRepInput = {
      ...input(),
      facts: { incidentId: INCIDENT, facts: [], news: social },
    };
    const res = await synthesizeSitRep(onlySocial, {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
      aiEnabled: false,
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.fields).toHaveLength(1);
    expect(res.value.fields[0]!.claim).toContain('Unverified social report');
  });

  it('ignores an empty news array (no change vs. no news)', async () => {
    const withEmpty: SynthesizeSitRepInput = { ...input(), facts: { ...input().facts, news: [] } };
    const res = await synthesizeSitRep(withEmpty, {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.fields).toHaveLength(2); // just the two DEFAULT_FACTS
  });
});

describe('synthesizeSitRep — input guards', () => {
  it('rejects an empty fact bundle', async () => {
    const res = await synthesizeSitRep(input([]), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    expect(isErr(res)).toBe(true);
  });

  it('rejects a fact missing its field/claim', async () => {
    const bad = [fact('', 'no field', 'src-x')];
    const res = await synthesizeSitRep(input(bad), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    expect(isErr(res)).toBe(true);
  });
});

// ── Ranked Outlook (C2.3; ADR-033 §5, FEV-8) ─────────────────────────────────────────────────────────
// The contract under test is the ENGINE-SORTS / LLM-NARRATES boundary: the outlook is built here, from
// predictions, and never travels to the model — so it cannot be reordered or invented by one.

function outlookPrediction(
  id: string,
  extra: {
    readonly likelihoodClass?: 'POSSIBLE' | 'LIKELY' | 'VERY_LIKELY';
    readonly etaHours?: number;
  } = {},
): Prediction {
  return makePrediction({
    id: asId<PredictionId>(id),
    incidentId: INCIDENT,
    kind: 'ESCALATION',
    method: `least-squares trend projection (${id})`,
    inputs: { slopePerHour: 0.2, samples: 5 },
    uncertainty: 0.4,
    ...(extra.likelihoodClass !== undefined ? { likelihoodClass: extra.likelihoodClass } : {}),
    ...(extra.etaHours !== undefined ? { etaHours: extra.etaHours } : {}),
  });
}

const OUTLOOK_PREDICTIONS: readonly Prediction[] = [
  outlookPrediction('pred-slow', { likelihoodClass: 'POSSIBLE', etaHours: 4 }),
  outlookPrediction('pred-urgent', { likelihoodClass: 'VERY_LIKELY', etaHours: 12 }),
];

function withPredictions(
  predictions: readonly Prediction[] = OUTLOOK_PREDICTIONS,
): SynthesizeSitRepInput {
  const base = input();
  return { ...base, facts: { ...base.facts, predictions } };
}

describe('synthesizeSitRep — ranked outlook (ADR-033 §5)', () => {
  it('defaults to [] when the incident has no predictions (an absent Outlook, never a faked one)', async () => {
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.outlook).toEqual([]);
  });

  it('ranks predictions with the ENGINE comparator, not the derivation order', async () => {
    const res = await synthesizeSitRep(withPredictions(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.outlook.map((o) => [o.rank, o.predictionId])).toEqual([
      [1, 'pred-urgent'], // VERY_LIKELY outranks a sooner POSSIBLE (class first)
      [2, 'pred-slow'],
    ]);
  });

  it("carries each row's method + uncertainty + computed hazardArrival (labeled prediction, Art. XII/XIV)", async () => {
    const res = await synthesizeSitRep(withPredictions(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.outlook[0]).toEqual({
      rank: 1,
      predictionId: 'pred-urgent',
      kind: 'ESCALATION',
      method: 'least-squares trend projection (pred-urgent)',
      uncertainty: 0.4,
      likelihoodClass: 'VERY_LIKELY',
      etaHours: 12,
      // generatedAt (2026-07-07T00:00:00Z) + 12 h — from the INJECTED instant, never a clock read.
      hazardArrival: '2026-07-07T12:00:00.000Z',
    });
  });

  it('NEVER hands the outlook to the narrator — the model sees only the cited facts (Art. XII/F3)', async () => {
    const seen: ComplianceRequest<unknown>[] = [];
    const spy: AICompliancePort = {
      mediate: async (req: ComplianceRequest<unknown>) => {
        seen.push(req);
        return ok({ allowed: true, result: NARRATIVE });
      },
    } as unknown as AICompliancePort;
    const res = await synthesizeSitRep(withPredictions(), { ai: spy });
    if (!isOk(res)) throw new Error('expected ok');
    expect(seen).toHaveLength(1);
    const payload = JSON.stringify(seen[0]!.payload);
    expect(payload).not.toContain('pred-urgent');
    expect(payload).not.toContain('VERY_LIKELY');
    expect(payload).not.toContain('outlook');
    // …while the SitRep the caller receives still carries the engine's ranking in full.
    expect(res.value.outlook).toHaveLength(2);
  });

  it('keeps the IDENTICAL outlook in the deterministic-only rung (Art. XVI — degrade, never drop)', async () => {
    const narrated = await synthesizeSitRep(withPredictions(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    const degraded = await synthesizeSitRep(withPredictions(), {
      ai: aiReturning({ allowed: false }),
    });
    if (!isOk(narrated) || !isOk(degraded)) throw new Error('expected ok');
    expect(degraded.value.aiMode).toBe('deterministic-only');
    expect(degraded.value.outlook).toEqual(narrated.value.outlook);
  });

  it('is replay-deterministic: the same input twice yields a byte-identical outlook', async () => {
    const deps: SitRepSynthesisDeps = { ai: aiReturning({ allowed: true, result: NARRATIVE }) };
    const a = await synthesizeSitRep(withPredictions(), deps);
    const b = await synthesizeSitRep(withPredictions(), deps);
    if (!isOk(a) || !isOk(b)) throw new Error('expected ok');
    expect(JSON.stringify(b.value.outlook)).toBe(JSON.stringify(a.value.outlook));
  });

  it('ignores an empty predictions array (no change vs. no predictions)', async () => {
    const res = await synthesizeSitRep(withPredictions([]), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.outlook).toEqual([]);
  });
});

// ── ADR-038: asynchronous narration ────────────────────────────────────────────────────────────────
// The read path must never wait on a slow model: Railway's 60 s edge kills the request and the operator
// sees NOTHING, when they were entitled to the deterministic report immediately. These tests are timing-
// SAFE by construction: the "slow" model never resolves at all (so the deadline must win), and the "fast"
// model resolves synchronously (so it must beat any timer).

/** A gateway whose narration is withheld until the test releases it — models the slow cloud call. */
function aiWithheld(narrative: Narrative = NARRATIVE): {
  ai: AICompliancePort;
  calls: () => number;
  release: () => void;
  settled: () => Promise<void>;
} {
  let calls = 0;
  let release!: () => void;
  let done!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const finished = new Promise<void>((r) => {
    done = r;
  });
  const ai = {
    mediate: async (): Promise<unknown> => {
      calls += 1;
      await gate;
      done();
      return ok({ allowed: true, result: narrative });
    },
  } as unknown as AICompliancePort;
  return { ai, calls: () => calls, release, settled: () => finished };
}

describe('synthesizeSitRep — async narration (ADR-038)', () => {
  it('returns the DETERMINISTIC SitRep without waiting when narration misses the deadline', async () => {
    const { ai } = aiWithheld(); // never released inside this test — the deadline is the only way out
    const res = await synthesizeSitRep(input(), { ai, narrationDeadlineMs: 5 });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.aiMode).toBe('deterministic-only');
    // The operator still gets the full cited record — degraded prose is never a degraded FACT set.
    expect(res.value.fields).toHaveLength(2);
    for (const f of res.value.fields) expect(f.citations.length).toBeGreaterThan(0);
    expect(res.value.summary).toContain('2 hospitals');
  });

  it('still uses the prose when narration BEATS the deadline — the fast path is unchanged', async () => {
    const res = await synthesizeSitRep(input(), {
      ai: aiReturning({ allowed: true, result: NARRATIVE }),
      narrationDeadlineMs: 5_000,
      aiMode: 'cloud',
    });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('cloud');
    expect(res.value.summary).toBe(NARRATIVE.text);
  });

  it('lets the abandoned narration COMPLETE in the background, so the memo can serve the next read', async () => {
    const { ai, calls, release, settled } = aiWithheld();
    const res = await synthesizeSitRep(input(), { ai, narrationDeadlineMs: 5 });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
    expect(calls()).toBe(1); // the model WAS asked — we simply did not make the operator wait for it
    release();
    await settled(); // the call runs to completion after the response was already returned
    expect(calls()).toBe(1); // and it is never retried behind the operator's back
  });

  it('stays fully SYNCHRONOUS when no deadline is configured (V1 behaviour, byte-identical)', async () => {
    const { ai, release } = aiWithheld();
    let resolved = false;
    const pending = synthesizeSitRep(input(), { ai, aiMode: 'cloud' }).then((r) => {
      resolved = true;
      return r;
    });
    await Promise.resolve();
    expect(resolved).toBe(false); // no deadline ⇒ we wait for the model, exactly as before
    release();
    const res = await pending;
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('cloud');
    expect(res.value.summary).toBe(NARRATIVE.text);
  });

  it('never reaches the model at all when AI is off, deadline or not (F7 path untouched)', async () => {
    const { ai, calls } = aiWithheld();
    const res = await synthesizeSitRep(input(), { ai, aiEnabled: false, narrationDeadlineMs: 5 });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
    expect(calls()).toBe(0);
  });

  it('degrades to deterministic-only when the gateway REJECTS under a deadline (no unhandled rejection)', async () => {
    const ai = {
      mediate: async (): Promise<never> => Promise.reject(new Error('socket hang up')),
    } as unknown as AICompliancePort;
    const res = await synthesizeSitRep(input(), { ai, narrationDeadlineMs: 5_000 });
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.aiMode).toBe('deterministic-only');
  });
});
