// BEACON — LLM output schema + citation + no-figure validator (E6·T-254; ADR-007/F3/CM-C6; finding F-340).
// Enforces the deterministic source-of-truth guarantee (Art. XII): the LLM NARRATES cited facts and must
// NEVER emit a figure. An ungrounded, uncited, or figure-bearing narration is REJECTED → the ladder falls to
// the deterministic-only rung.
//
// F-340 — why this is now a PROHIBITION, not a membership check. The shipped guard flattened every fact into
// one BAG of numeric tokens and admitted any narration whose tokens were all members of that bag. A bag has
// no provenance: it cannot tell which fact a token came from, what it measured, or in what unit. The audit
// demonstrated six live fabrications the bag ACCEPTED — an ISO timestamp donating "30" to "Roughly 30 people
// are unaccounted for"; the year donating "2026" to "About 2026 residents were evacuated"; a crest in feet
// donating "12.4" to "12.4 million dollars in damage" (magnitude) and to "12.4 metres" (unit); a source count
// donating "3" to "3 fatalities confirmed"; and two classes carrying no digit at all — "Fourteen thousand
// displaced" and "Butte County is the worst-hit and highest-priority area". A seventh, found while fixing
// this: `\d` is ASCII-only, so "٤٧" (Arabic-Indic) bypassed a guard that must police 14 locales (ADR-030).
//
// No membership rule can separate those from a faithful restatement, because the bag destroys exactly the
// information needed to judge them. The only checkable rule is the one Art. XII already states: the narration
// surface carries NO figures. The UI never reads a figure out of prose — every number the operator sees is
// rendered from the deterministic record (`SitRep.fields` + their citations, `priorities`, `trend`,
// `outlook`), so the prose loses nothing by being figure-free. A rejection is not a dead-end either: the
// ladder degrades to the deterministic-only rung, which shows the engine's own claims WITH their numbers.
import type { CitedFact, Narrative } from '@/ports/intel.js';

/**
 * Any Unicode NUMBER character — decimal digits in EVERY script (٤, ४, ৪), plus fractions (½), superscripts
 * (²) and letter-numerals. `\d` would have policed English narration only, while the narrator is explicitly
 * multilingual (`NarrativeRequest.locale`, ADR-030).
 */
const FIGURE_CHAR = /\p{N}/u;

/**
 * Quantities the model can write without a single digit. Magnitudes are the dangerous half ("fourteen
 * thousand"), but a bare cardinal is a count too, and a bare ordinal is a rank. Plurals are covered by the
 * optional `s` (hundreds, dozens).
 */
const NUMBER_WORD =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|trillions?|dozens?|halves|half|quarters?|firsts?|second|thirds?|fourths?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|twice|thrice|double|triple)\b/iu;

/**
 * Ranking surfaces (finding F-340, case 6). A superlative IS a ranking, and a ranking is a deterministic
 * engine output (`priorities`, `outlook`) — "Butte County is the worst-hit area" asserts a rank order the
 * model computed itself, exactly what Art. XII forbids, while carrying no digit for a numeric guard to see.
 * The list is BOUNDED on purpose: a generic `\w+est` rule would fire on "forest" and "west" in a wildfire
 * narration, which is why the surfaces are enumerated instead of inferred. For the same reason it holds only
 * SUPERLATIVES, not comparatives — "more roads are closed" would be rejected by a `more|fewer|higher` rule
 * that would fire on ordinary prose many times per report. That gap is real and is pinned as a known blind
 * spot in the tests rather than left unstated (see output-validator.test.ts).
 */
const RANKING_WORD =
  /\b(?:worst|best|highest|lowest|largest|smallest|biggest|greatest|hardest|nearest|closest|farthest|furthest|most|least|top|foremost|maximum|minimum|majority)\b/iu;

/**
 * Fixed idioms that contain a number WORD but assert no quantity, consumed before the scan. Kept to the
 * domain phrases that would otherwise be rejected constantly ("no one was hurt", "first responders are on
 * scene") — an allowlist of idioms, never of figures: none of these can carry a fabricated number.
 */
const NON_QUANTITY_IDIOM =
  /\bno one\b|\bone another\b|\bfirst responders?\b|\bfirst[ -]aid\b|\bfirst aiders?\b/giu;

/**
 * TRUE iff the narration carries no figure of any kind: no numeral in any script, no spelled-out number, no
 * ranking claim. This is the Art. XII prohibition in code — the model narrates, the engine numbers.
 */
export function narrationIsFigureFree(text: string): boolean {
  const scanned = text.replace(NON_QUANTITY_IDIOM, ' ');
  return !FIGURE_CHAR.test(scanned) && !NUMBER_WORD.test(scanned) && !RANKING_WORD.test(scanned);
}

/**
 * Likelihood is expressed as a WORD, so the figure guard above is blind to it (finding F-20): a narration
 * could upgrade a cited "LIKELY" to "VERY_LIKELY", or assert a likelihood no source ever published, and
 * `narrationIsFigureFree` would pass it — the LLM would then be the origin of a forecast claim, which is
 * exactly what Art. XII forbids. Surfaces are matched LONGEST-FIRST and consumed, so "very likely" is never
 * miscounted as a bare "likely"; `\b` keeps "unlikely" from matching "likely".
 *
 * `UNLIKELY` has no counterpart in `LIKELIHOOD_CLASSES` (`src/domain/prediction.ts`) — the engine cannot
 * emit it — so an ungrounded "unlikely" is by construction an invented class, and is rejected. A negative
 * forecast claim is the most dangerous kind to invent: it tells a reader not to act.
 */
const LIKELIHOOD_SURFACES: readonly (readonly [string, RegExp])[] = [
  ['VERY_LIKELY', /very[\s_-]?likely/gi],
  ['UNLIKELY', /\bunlikely\b/gi],
  ['LIKELY', /\blikely\b/gi],
  ['POSSIBLE', /\bpossibl[ey]\b/gi],
];

/** The likelihood classes a text asserts, each surface consumed so longer forms win. */
function likelihoodClassesIn(text: string): ReadonlySet<string> {
  const found = new Set<string>();
  let rest = text;
  for (const [cls, surface] of LIKELIHOOD_SURFACES) {
    rest = rest.replace(surface, () => {
      found.add(cls);
      return ' ';
    });
  }
  return found;
}

/** Every likelihood WORD in the narration must already be asserted by the cited facts (F-20, Art. XII). */
export function usesOnlyCitedLikelihoodClasses(text: string, facts: readonly CitedFact[]): boolean {
  const cited = likelihoodClassesIn(facts.map((f) => f.claim).join(' '));
  for (const cls of likelihoodClassesIn(text)) {
    if (!cited.has(cls)) return false;
  }
  return true;
}

/**
 * A narration is valid iff it is non-empty, carries citations, emits NO figure at all (F3/F-340) and invents
 * no likelihood class (F-20). Any rejection drops the ladder to the deterministic-only rung — the figures and
 * the class still reach the operator, just without prose around them.
 */
export function isValidNarration(narrative: Narrative, facts: readonly CitedFact[]): boolean {
  if (narrative.text.trim().length === 0) return false;
  if (narrative.citations.length === 0) return false;
  if (!usesOnlyCitedLikelihoodClasses(narrative.text, facts)) return false;
  return narrationIsFigureFree(narrative.text);
}
