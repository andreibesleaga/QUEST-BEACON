// BEACON — EDXL-SitRep mapper tests (E7·T-306/T-307). EDXL-SitRep validates against edxl-sitrep.schema.json
// and the field-level citations[] (provenance) are preserved and Ajv-validated across the boundary.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeSitRep } from '@/domain/sitrep.js';
import type { SitRep } from '@/domain/sitrep.js';
import type { IncidentId, SitRepId, SourceId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import { sitRepToEdxlSitRep } from './edxl-sitrep-mapper.js';
import type { EdxlSitRep } from './edxl-sitrep-mapper.js';

const sitrepSchema = JSON.parse(readFileSync('schemas/edxl-sitrep.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSitRep = ajv.compile(sitrepSchema);

const SRC_A = '11111111-1111-4111-8111-111111111111';
const SRC_B = '22222222-2222-4222-8222-222222222222';

function citedSitRep(): SitRep {
  return makeSitRep({
    id: asId<SitRepId>('sitrep-1'),
    incidentId: asId<IncidentId>('inc-1'),
    generatedAt: '2026-07-05T21:18:00Z',
    summary: 'Fire has grown to 1,200 acres; 3 shelters open.',
    trend: 'ESCALATING',
    aiMode: 'cloud',
    fields: [
      {
        field: 'summary.executiveSummary',
        claim: 'Fire has grown to 1,200 acres',
        citations: [{ sourceId: asId<SourceId>(SRC_A) }],
      },
      {
        field: 'situationInformation.exposureSummary',
        claim: '3 shelters within the hazard buffer',
        citations: [{ sourceId: asId<SourceId>(SRC_B) }],
      },
    ],
  });
}

describe('sitRepToEdxlSitRep (T-306/T-307)', () => {
  it('produces an EDXL-SitRep that validates against edxl-sitrep.schema.json', () => {
    const res = sitRepToEdxlSitRep(citedSitRep(), { sitRepNumber: '4', incidentType: 'WILDFIRE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(validateSitRep(res.value.sitrep)).toBe(true);
    expect(res.value.sitrep.summary?.trend).toBe('ESCALATING');
    expect(res.value.sitrep.incidentInformation.incidentID).toBe('inc-1');
    expect(res.value.sitrep.sitRepNumber).toBe('4');
  });

  it('preserves every field-level citation (grounding survives the boundary, Art. XI/XII)', () => {
    const res = sitRepToEdxlSitRep(citedSitRep());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.citations).toHaveLength(2);
    const byField = Object.fromEntries(res.value.citations.map((c) => [c.field, c]));
    expect(byField['summary.executiveSummary']?.sourceId).toBe(SRC_A);
    expect(byField['situationInformation.exposureSummary']?.sourceId).toBe(SRC_B);
    // Every preserved citation carries a non-empty claim (grounding is structural).
    expect(res.value.citations.every((c) => c.claim.length > 0)).toBe(true);
  });
});

// ── F-410 (Art. VI): AI authorship must cross the agency boundary, not stop at the UI ──────────────────
//
// The F-341 badge tells an OPERATOR the SitRep summary was model-written. This document leaves the
// building — a partner agency parses it, files it, and may re-publish it — and it carried no authorship
// marker at all. The only statement of AI authorship lived in the JSON-Schema's `description` text, which
// no receiving system reads. A human-readable comment in a schema is not a disclosure to a machine.
describe('EDXL-SitRep authorship marker (F-410, Art. VI)', () => {
  /** Unwrap the validated document — `sitRepToEdxlSitRep` returns Result<{sitrep, citations}>. */
  function doc(sitrep: SitRep): EdxlSitRep {
    const res = sitRepToEdxlSitRep(sitrep, { headline: 'CA wildfire' });
    if (!res.ok) throw new Error(`mapper failed: ${res.error.message}`);
    return res.value.sitrep;
  }

  it('marks a model-authored summary AI_GENERATED, and still validates against the schema', () => {
    const d = doc(citedSitRep());
    expect(d.summary?.summaryAuthorship).toBe('AI_GENERATED');
    // The mapper validates internally, but assert it here too: `additionalProperties:false` on the summary
    // object means an unlisted marker would be REJECTED, so this pins that the schema and the emitter agree.
    expect(validateSitRep(d)).toBe(true);
  });

  it('marks an AI-OFF summary DETERMINISTIC — claiming AI authorship when no model ran would be its own ' +
    'misstatement (the app is fully functional with AI disabled)', () => {
    const d = doc(makeSitRep({ ...citedSitRep(), aiMode: 'deterministic-only' }));
    expect(d.summary?.summaryAuthorship).toBe('DETERMINISTIC');
    expect(validateSitRep(d)).toBe(true);
  });

  it('the marker travels with the PROSE: local-model narration is AI_GENERATED too (the fallback rung is ' +
    'still a model)', () => {
    expect(doc(makeSitRep({ ...citedSitRep(), aiMode: 'local' })).summary?.summaryAuthorship).toBe('AI_GENERATED');
  });
});
