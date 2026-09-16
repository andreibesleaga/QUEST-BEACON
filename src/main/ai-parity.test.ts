// BEACON — AI-on == AI-off numeric-equality (W5; Art. XII "two-engine decision support: AI-on == AI-off").
// End-to-end through the composition root (buildInteraction → command-router → synthesizeSitRep): the SAME
// deterministic fact bundle (engine facts WITH numbers + region news/social) is synthesized twice — once
// with a grounded AI narration, once with AI off (deterministic-only) — and every number, every fact, and
// every citation set in the SitRep fields must be byte-identical. ONLY the narrative prose may differ
// (Art. XII: the LLM narrates cited facts; it never invents or drops a figure). Deterministic: fixed past
// clock, counter id minters, no network, DEFAULT_SEED (+ an injected news batch so the fusion path — Art.
// XIV corroboration/misinformation-flag — is covered too, not just the base engine facts).
import { describe, it, expect } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { InteractionRequest, CitationView } from '@/ports/interaction.js';
import type {
  AICompliancePort,
  ComplianceRequest,
  Narrative,
  NarrativeRequest,
  NewsItem,
} from '@/ports/intel.js';
import type { CoreSeed } from '@/adapters/memory/memory-core.js';
import type { RankedPriority, SitRepTrend } from '@/domain/sitrep.js';
import { DEFAULT_SEED } from './seed.js';
import { buildInteraction } from './build-core.js';

const NOW = '2026-07-05T22:00:00Z';

const CA_INCIDENT = DEFAULT_SEED.incidents.find((i) => i.type === 'WILDFIRE');
if (CA_INCIDENT === undefined)
  throw new Error('fixture assumption broken: no WILDFIRE incident in DEFAULT_SEED');
const CA_INCIDENT_ID: IncidentId = CA_INCIDENT.id;

// A region-scoped news/social batch (Art. XIV — corroboration vs. flag-not-merge), fused into the SitRep
// fields BEFORE the model ever runs (mergeNewsFacts in sitrep-synthesis.ts) — so it must parity-check too.
const NEWS: readonly NewsItem[] = [
  {
    title: 'Wildfire spreads near the ridge',
    url: 'https://nws.gov/a',
    publishedAt: '2026-07-05T20:00:00Z',
    sourceAuthority: 'OFFICIAL',
  },
  {
    title: 'Fire forces evacuations near Bear Ridge',
    url: 'https://reuters.com/b',
    publishedAt: '2026-07-05T20:30:00Z',
    sourceAuthority: 'MEDIA',
  },
  {
    title: 'Dam has collapsed, city underwater!!',
    url: 'https://bsky.app/c',
    publishedAt: '2026-07-05T21:00:00Z',
    sourceAuthority: 'SOCIAL',
  },
];

/** DEFAULT_SEED with `news` attached to the wildfire incident (the flood incident is left untouched). */
function seedWithNews(): CoreSeed {
  return {
    ...DEFAULT_SEED,
    incidents: DEFAULT_SEED.incidents.map((inc) =>
      inc.id === CA_INCIDENT_ID ? { ...inc, news: NEWS } : inc,
    ),
  };
}

const AI_NARRATION_TEXT =
  'AI narrative: situation assessed across all fronts; monitoring continues.';

/**
 * A grounded AI provider: it echoes back the EXACT citations it was handed (the deterministic facts'
 * own citations), so grounding always succeeds — the only degree of freedom is the narrative TEXT. This
 * isolates the assertion to "does AI-on ever change a number/fact/citation", not "did grounding fail".
 */
function narratingAi(): AICompliancePort {
  return {
    mediate: async <TReq, TRes>(request: ComplianceRequest<TReq>) => {
      const payload = request.payload as unknown as NarrativeRequest;
      const narrative: Narrative = {
        text: AI_NARRATION_TEXT,
        citations: payload.facts.map((f) => f.citation),
      };
      return { ok: true as const, value: { allowed: true, result: narrative as unknown as TRes } };
    },
  };
}

function sitrepRequest(): InteractionRequest {
  return {
    channel: 'cli',
    actorRole: 'EM',
    command: { verb: 'sitrep', incidentId: CA_INCIDENT_ID },
    receivedAt: NOW,
  };
}

/** A fresh core over the SAME seed/clock; `ai` absent ⇒ resolveAi's offline default (deterministic-only). */
function makeCore(ai?: AICompliancePort) {
  let n = 0;
  const newId = (p: string): string => `${p}-${++n}`;
  return buildInteraction({
    env: {},
    seed: seedWithNews(),
    clock: () => NOW,
    newId,
    ...(ai ? { ai } : {}),
  });
}

interface SitRepDataShape {
  readonly aiMode: string;
  readonly summary?: string;
  readonly trend?: SitRepTrend;
  readonly priorities: readonly RankedPriority[];
  readonly fields: readonly {
    field: string;
    claim?: string;
    citations: readonly { sourceId: string }[];
  }[];
}

/** Every numeric token appearing in a string (deterministic facts carry the ONLY numbers, per Art. XII). */
function extractNumbers(text: string): readonly number[] {
  return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe('AI-on == AI-off numeric-equality (Art. XII — two-engine decision support)', () => {
  it('every number and every fact/citation set in the SitRep fields is IDENTICAL; only the narrative text differs', async () => {
    const coreOn = makeCore(narratingAi());
    const coreOff = makeCore(); // no ai override, no AI_MODE env ⇒ deterministic-only (offline default, F7)

    const [resOn, resOff] = await Promise.all([
      coreOn.handle(sitrepRequest()),
      coreOff.handle(sitrepRequest()),
    ]);
    expect(isOk(resOn)).toBe(true);
    expect(isOk(resOff)).toBe(true);
    if (!isOk(resOn) || !isOk(resOff)) return;

    const dataOn = resOn.value.data as SitRepDataShape;
    const dataOff = resOff.value.data as SitRepDataShape;

    // The AI seam itself differs by design (that's the whole point of the comparison)…
    expect(dataOn.aiMode).toBe('cloud');
    expect(dataOff.aiMode).toBe('deterministic-only');
    expect(dataOn.summary).toBe(AI_NARRATION_TEXT);
    expect(dataOn.summary).not.toBe(dataOff.summary);

    // …but every deterministic field (claim text + its full citation set) must be byte-identical — the
    // fact bundle is assembled ONCE, before the model is ever consulted (mergeNewsFacts/buildFields).
    expect(dataOn.fields).toHaveLength(dataOff.fields.length);
    expect(dataOn.fields).toEqual(dataOff.fields);

    // Both the news-corroborated fact and the flagged social fact made it into both runs, identically.
    const claimsOn = dataOn.fields.map((f) => f.claim ?? '');
    expect(claimsOn.some((c) => c.includes('authoritative sources'))).toBe(true);
    expect(claimsOn.some((c) => c.includes('Unverified social report'))).toBe(true);

    // The engine-ranked priorities and the escalation trend are equally untouched by the AI seam.
    expect(dataOn.priorities).toEqual(dataOff.priorities);
    expect(dataOn.trend).toEqual(dataOff.trend);

    // The envelope-level citation projection (SPEC F2: field → sourceId) is identical on both rungs.
    const citationsOn = resOn.value.citations as readonly CitationView[] | undefined;
    const citationsOff = resOff.value.citations as readonly CitationView[] | undefined;
    expect(citationsOn).toEqual(citationsOff);
    expect(citationsOn?.length).toBeGreaterThan(0);

    // Explicit numeric-equality proof (Art. XII: the LLM cannot invent or drop a figure): every number
    // appearing across the deterministic claims is the SAME multiset whether AI narrated or not.
    const numbersOn = extractNumbers(dataOn.fields.map((f) => f.claim ?? '').join(' '));
    const numbersOff = extractNumbers(dataOff.fields.map((f) => f.claim ?? '').join(' '));
    expect(numbersOn.length).toBeGreaterThan(0); // sanity: the fixture really does carry numeric facts
    expect(numbersOn).toEqual(numbersOff);

    // …and the ranked-priority numbers (rank, and any numeric detail) are identical too.
    const priorityNumbersOn = extractNumbers(JSON.stringify(dataOn.priorities));
    const priorityNumbersOff = extractNumbers(JSON.stringify(dataOff.priorities));
    expect(priorityNumbersOn).toEqual(priorityNumbersOff);
  });

  it('AI blocked by the compliance gateway degrades to the SAME deterministic facts as AI-off (F4/F7 parity)', async () => {
    const blockedAi: AICompliancePort = {
      mediate: async () => ({ ok: true, value: { allowed: false, reason: 'policy' } }),
    };
    const coreBlocked = makeCore(blockedAi);
    const coreOff = makeCore();

    const [resBlocked, resOff] = await Promise.all([
      coreBlocked.handle(sitrepRequest()),
      coreOff.handle(sitrepRequest()),
    ]);
    if (!isOk(resBlocked) || !isOk(resOff)) throw new Error('expected both to be ok');

    const dataBlocked = resBlocked.value.data as SitRepDataShape;
    const dataOff = resOff.value.data as SitRepDataShape;
    expect(dataBlocked.aiMode).toBe('deterministic-only');
    expect(dataBlocked.fields).toEqual(dataOff.fields);
    expect(dataBlocked.summary).toBe(dataOff.summary); // both are the SAME joined-claims fallback text
  });
});
