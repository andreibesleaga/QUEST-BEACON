// BEACON — LLM output-validator tests (C1.4; findings F-20/F-340; Art. XII).
//
// The figure guard is the thing standing between the model and the numbers. It used to be a token-BAG
// membership check ("every digit run in the prose appears somewhere in the facts"), which finding F-340
// broke six ways in a single sitting — a bag knows nothing about which fact a digit came from, what it
// measured, or in what unit. It is now a PROHIBITION: the narration surface carries no figure at all. The
// six demonstrated bypasses are pinned below, each one a test that FAILED against the shipped guard before
// this change. C1.4's WORD guard stays, because likelihood is the one deterministic output that is neither a
// digit nor a ranking. These tests also — deliberately — pin the guards' KNOWN BLIND SPOTS so those
// limitations live in an executable place, not just in prose.
import { describe, it, expect } from 'vitest';
import {
  isValidNarration,
  narrationIsFigureFree,
  usesOnlyCitedLikelihoodClasses,
} from './output-validator.js';
import type { CitedFact, Narrative } from '@/ports/intel.js';

function fact(claim: string): CitedFact {
  return {
    claim,
    citation: {
      id: 'cit-1',
      sitrepId: 'sitrep-1',
      sourceId: 'glofas',
      field: 'floodOutlook',
      claim,
    } as CitedFact['citation'],
  };
}

function narration(text: string): Narrative {
  return { text, citations: [fact('x').citation] };
}

// ── F-340: the six demonstrated bypasses (+ two found while fixing) ────────────────────────────────────
// EVERY case below was ACCEPTED by the shipped token-bag guard and is REJECTED now. The facts are a realistic
// SitRep bundle — they are what DONATED the digits: an ISO timestamp carries 2026/07/05/22/30/00, a crest
// carries 12.4, a corroboration count carries 3. That is precisely why membership in a bag of fact-digits
// proves nothing about the sentence a model wrapped around them.
const BYPASS_FACTS: readonly CitedFact[] = [
  fact('gauge stage read at 2026-07-05T22:30:00Z'),
  fact('crest 12.4 feet forecast for Butte County'),
  fact('corroborated by 3 authoritative sources'),
];

describe('narrationIsFigureFree — F-340 demonstrated bypasses (all must be REJECTED)', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['1. a timestamp donates the digits', 'Roughly 30 people are unaccounted for.'],
    ['2. the year donates the digits', 'About 2026 residents were evacuated.'],
    ['3. magnitude swap off a cited crest', '12.4 million dollars in damage.'],
    ['4. unit swap off a cited crest (feet → metres)', 'The crest will reach 12.4 metres.'],
    ['5. a source count re-attached to fatalities', '3 fatalities confirmed.'],
    ['6. spelled-out numerals carry no digit', 'Fourteen thousand displaced.'],
    [
      '7. a ranking claim, no digit at all',
      'Butte County is the worst-hit and highest-priority area.',
    ],
    // Found while fixing: `\d` is ASCII-only, but the narrator is multilingual (ADR-030, 14 locales incl.
    // ar/bn/hi/ur). Arabic-Indic ٤٧ ("47") sailed through a guard that only knew Latin digits.
    ['8. non-ASCII numerals (ar)', 'نحو ٤٧ ضحية.'],
  ];
  for (const [name, text] of cases) {
    it(`rejects ${name}`, () => {
      expect(narrationIsFigureFree(text), text).toBe(false);
      // …and the composed contract the ladder actually calls rejects it too.
      expect(isValidNarration(narration(text), BYPASS_FACTS), text).toBe(false);
    });
  }

  it('rejects even a FAITHFUL restatement of a cited figure — the prose surface carries none', () => {
    // The old guard's one accepting case. It is now a rejection BY DESIGN: the UI renders every figure from
    // the deterministic record (SitRep.fields/priorities/trend/outlook), so faithful prose numbers buy
    // nothing and cost the only rule that is actually checkable.
    expect(narrationIsFigureFree('Crest 71,200 cfs at 04:00.')).toBe(false);
    expect(narrationIsFigureFree('Crest 90,000 cfs.')).toBe(false);
  });

  it('accepts figure-free prose — the narration the model is actually asked for', () => {
    expect(
      narrationIsFigureFree(
        'The gauge is still rising and evacuation orders remain in force for Butte County.',
      ),
    ).toBe(true);
    expect(
      isValidNarration(narration('Flooding continues along the lower reach.'), BYPASS_FACTS),
    ).toBe(true);
  });

  it('does not fire on domain idioms that contain a number word but assert no quantity', () => {
    for (const text of [
      'No one has been reported missing.',
      'First responders are staged at the fairgrounds.',
      'First-aid stations are open at the fairgrounds.',
      'Crews are working alongside one another.',
    ]) {
      expect(narrationIsFigureFree(text), text).toBe(true);
    }
  });

  it('does not fire on ordinary wildfire/flood vocabulary that merely looks superlative', () => {
    // A generic `\w+est` rule would reject all of these; the ranking list is enumerated for exactly this.
    for (const text of [
      'The forest west of the ridge is still burning.',
      'Crews requested additional engines.',
      'Fire behaviour is driven by terrain and wind.',
    ]) {
      expect(narrationIsFigureFree(text), text).toBe(true);
    }
  });

  it('KNOWN BLIND SPOT: spelled-out numbers and superlatives in a NON-ENGLISH narration still pass', () => {
    // Numerals in any script are caught (case 8 above), but the WORD lists are English. A Romanian narration
    // inventing "paisprezece mii" (fourteen thousand) is not seen. Recorded here rather than left implied:
    // the same class as F-62. Mitigation in place: the prompt forbids figures in every language, and the
    // deterministic record — not the prose — is what the UI renders.
    expect(narrationIsFigureFree('Paisprezece mii de persoane au fost evacuate.')).toBe(true);
    // Comparatives are likewise out of scope: a `more|fewer|higher` rule would fire on ordinary prose.
    expect(narrationIsFigureFree('More roads are closed than yesterday.')).toBe(true);
  });
});

describe('usesOnlyCitedLikelihoodClasses (F-20 — the word the figure guard cannot see)', () => {
  it('accepts the class the facts actually assert', () => {
    expect(
      usesOnlyCitedLikelihoodClasses('Flooding is LIKELY overnight.', [fact('likelihood LIKELY')]),
    ).toBe(true);
  });

  it('REJECTS an upgrade from LIKELY to VERY_LIKELY (the dangerous case)', () => {
    // The figure guard passes this: there is no numeral, number word or ranking in it at all.
    expect(narrationIsFigureFree('Flooding is very likely.')).toBe(true);
    // The word guard is what catches it.
    expect(
      usesOnlyCitedLikelihoodClasses('Flooding is very likely.', [fact('likelihood LIKELY')]),
    ).toBe(false);
  });

  it('does not miscount "very likely" as a bare "likely" (longest surface wins)', () => {
    // Facts say VERY_LIKELY; a narration saying only "likely" is a DOWNGRADE and is also uncited.
    expect(
      usesOnlyCitedLikelihoodClasses('Flooding is likely.', [fact('likelihood VERY_LIKELY')]),
    ).toBe(false);
    expect(
      usesOnlyCitedLikelihoodClasses('Flooding is very likely.', [fact('likelihood VERY_LIKELY')]),
    ).toBe(true);
  });

  it('does not treat "unlikely" as a match for "likely"', () => {
    // \b keeps the substring from matching; and UNLIKELY is its own (never-emitted) class, so it is rejected.
    expect(
      usesOnlyCitedLikelihoodClasses('Flooding is unlikely.', [fact('likelihood LIKELY')]),
    ).toBe(false);
  });

  it('REJECTS "unlikely" even when nothing else is claimed — the engine has no UNLIKELY class', () => {
    // A negative forecast claim is the most dangerous kind to invent: it tells a reader not to act.
    expect(
      usesOnlyCitedLikelihoodClasses('Flooding is unlikely tonight.', [fact('crest 71200 cfs')]),
    ).toBe(false);
  });

  it('accepts POSSIBLE and its adverb form when cited, rejects them otherwise', () => {
    expect(
      usesOnlyCitedLikelihoodClasses('Spread is possible.', [fact('likelihood POSSIBLE')]),
    ).toBe(true);
    expect(
      usesOnlyCitedLikelihoodClasses('Spread is possibly westward.', [fact('likelihood POSSIBLE')]),
    ).toBe(true);
    expect(usesOnlyCitedLikelihoodClasses('Spread is possible.', [fact('crest 71200 cfs')])).toBe(
      false,
    );
  });

  it('accepts underscored and hyphenated surfaces (models echo the token form)', () => {
    for (const surface of ['VERY_LIKELY', 'very-likely', 'Very Likely']) {
      expect(
        usesOnlyCitedLikelihoodClasses(`Flooding is ${surface}.`, [fact('likelihood VERY_LIKELY')]),
        surface,
      ).toBe(true);
    }
  });

  it('is vacuously true when neither side mentions likelihood (no false positives)', () => {
    expect(
      usesOnlyCitedLikelihoodClasses('Crest 71,200 cfs at 04:00.', [fact('crest 71200 cfs')]),
    ).toBe(true);
  });

  it('KNOWN BLIND SPOT: an English-surface guard cannot police a translated narration', () => {
    // Deterministic fact claims stay English by design (Art. XII boundary), but a narration MAY be
    // translated (NarrativeRequest.locale, ADR-030). A Romanian narration inventing "foarte probabil"
    // therefore passes this guard. Recorded as finding F-62 rather than left as an unstated assumption:
    // pretending the guard is language-agnostic would be a worse defect than the gap itself.
    expect(
      usesOnlyCitedLikelihoodClasses('Inundațiile sunt foarte probabile.', [
        fact('likelihood LIKELY'),
      ]),
    ).toBe(true);
  });
});

describe('isValidNarration (the composed contract the ladder actually calls)', () => {
  it('accepts a grounded, cited, figure-free, class-faithful narration', () => {
    expect(
      isValidNarration(narration('The river is cresting and flooding is LIKELY.'), [
        fact('crest 71200 cfs'),
        fact('likelihood LIKELY'),
      ]),
    ).toBe(true);
  });

  it('rejects an invented likelihood class even when the prose carries no figure', () => {
    expect(
      isValidNarration(narration('The river is cresting; flooding is very likely.'), [
        fact('crest 71200 cfs'),
        fact('likelihood LIKELY'),
      ]),
    ).toBe(false);
  });

  it('still rejects empty text, missing citations, and any figure at all', () => {
    expect(isValidNarration(narration('   '), [fact('crest 71200 cfs')])).toBe(false);
    expect(
      isValidNarration({ text: 'The river is cresting.', citations: [] }, [
        fact('crest 71200 cfs'),
      ]),
    ).toBe(false);
    expect(isValidNarration(narration('Crest 90,000 cfs.'), [fact('crest 71200 cfs')])).toBe(false);
    // Faithful restatement is a rejection now too (F-340) — prose carries no figures, faithful or not.
    expect(isValidNarration(narration('Crest 71,200 cfs.'), [fact('crest 71200 cfs')])).toBe(false);
  });
});
