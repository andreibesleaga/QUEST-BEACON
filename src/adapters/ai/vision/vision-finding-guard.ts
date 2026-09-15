// BEACON — Article XII guard for VISION output (S2·Lane V; ADR-008a, finding F-340's idiom re-applied).
// A vision model may CLASSIFY and DESCRIBE. It may never produce a figure. Nothing in the pixels tells the
// model how many hectares burned, how many metres deep the water is, or how many structures are damaged —
// and a model asked for those will supply them anyway, fluently. So this module does not TRUST the model's
// numbers, it makes them structurally unreachable:
//
//   1. LABEL — chosen from a CLOSED, per-task vocabulary. The model returns a class ID; an unrecognised ID
//      becomes `inconclusive`. A label therefore cannot carry a number even in principle.
//   2. CONFIDENCE — NOT read from the model. The model states a qualitative certainty word, and BEACON maps
//      it through a fixed table. The score the operator sees is BEACON's, computed deterministically from a
//      word. (Reading the model's own `0.87` would be letting the model emit the one figure this port must
//      publish — precisely the Art. XII violation.)
//   3. NOTES — free prose, run through the SAME `narrationIsFigureFree` prohibition the LLM narrator uses
//      (output-validator.ts, F-340). Prose carrying any numeral in any script, spelled-out number, or
//      ranking/superlative is DISCARDED wholesale and replaced with the advisory boilerplate. It is never
//      "cleaned" — a partially-scrubbed sentence is a sentence whose meaning nobody checked.
//
// Any other field the model returns (`area_ha`, `confidence`, `structures`, …) is simply never read.
import type { VisionFinding, VisionRequest } from '@/ports/intel.js';
import { narrationIsFigureFree } from '../llm/output-validator.js';

/** The closed class vocabulary per task: what the model may say, and the operator-facing label it maps to. */
const CLASSES: Readonly<Record<VisionRequest['task'], Readonly<Record<string, string>>>> = {
  'burn-area': {
    'burn-scar': 'possible burn scar',
    'active-fire': 'possible active fire or smoke plume',
    'no-burn-scar': 'no burn scar visible',
    obscured: 'obscured by cloud or smoke',
  },
  'flood-extent': {
    'standing-water': 'possible standing water',
    'no-standing-water': 'no standing water visible',
    obscured: 'obscured by cloud or smoke',
  },
  'damage-severity': {
    'structural-damage': 'possible structural damage',
    'no-structural-damage': 'no structural damage visible',
    obscured: 'obscured by cloud or smoke',
  },
  scene: {
    'scene-described': 'scene description',
    obscured: 'obscured by cloud or smoke',
  },
};

/** Every task's fallback: the model said something outside its vocabulary, so BEACON claims nothing. */
const INCONCLUSIVE = 'inconclusive — image did not support a classification';

/**
 * Certainty WORD → confidence score. The table is BEACON's, fixed, and deliberately capped below 1: an
 * advisory finding is thresholded downstream and must never present as certainty the deterministic layer
 * would have to argue with. An absent/unknown word lands on the lowest rung rather than a middle guess.
 */
const CERTAINTY: Readonly<Record<string, number>> = { high: 0.8, medium: 0.6, low: 0.35 };
const UNKNOWN_CERTAINTY = 0.25;

const ADVISORY_NOTE = 'advisory — requires human/deterministic confirmation';

/** The (untrusted) shape the classification prompt asks the model to return. */
export interface RawVisionClassification {
  readonly class?: unknown;
  readonly certainty?: unknown;
  readonly notes?: unknown;
}

function labelFor(task: VisionRequest['task'], rawClass: unknown): string {
  if (typeof rawClass !== 'string') return INCONCLUSIVE;
  return CLASSES[task][rawClass.trim().toLowerCase()] ?? INCONCLUSIVE;
}

function confidenceFor(rawCertainty: unknown): number {
  if (typeof rawCertainty !== 'string') return UNKNOWN_CERTAINTY;
  return CERTAINTY[rawCertainty.trim().toLowerCase()] ?? UNKNOWN_CERTAINTY;
}

/**
 * Model prose survives only if it is figure-free by the LLM narrator's own rule. Rejected prose is dropped
 * entirely (not edited) — see the module header. The advisory sentence is always present, so the operator
 * always sees the caveat even when the model said nothing usable.
 */
function notesFor(rawNotes: unknown, attribution: string): string {
  const prose = typeof rawNotes === 'string' ? rawNotes.trim() : '';
  const kept = prose.length > 0 && narrationIsFigureFree(prose) ? `${prose} — ` : '';
  return `${kept}${ADVISORY_NOTE}. Imagery: ${attribution}`;
}

/**
 * Build the ADVISORY, cited, confidence-scored `VisionFinding` — the only way a model result may enter BEACON.
 * `attribution` is the imagery provenance line, so every finding is cited at the point it is created.
 */
export function toAdvisoryFinding(
  raw: RawVisionClassification,
  task: VisionRequest['task'],
  attribution: string,
): VisionFinding {
  return {
    label: labelFor(task, raw.class),
    confidence: confidenceFor(raw.certainty),
    notes: notesFor(raw.notes, attribution),
  };
}

/** The class IDs a task's prompt may offer the model (kept beside the vocabulary so they cannot drift). */
export function classIdsFor(task: VisionRequest['task']): readonly string[] {
  return Object.keys(CLASSES[task]);
}
