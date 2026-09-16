// BEACON — EDXL-SitRep language field tests (ADR-030 §7; A4.3b). Mirrors cap-mapper.i18n.test.ts's
// intent — text may vary by language, machine-readable values may not — adapted to EDXL-SitRep's shape:
// unlike CAP there is no repeated <info> block to carry multiple languages in ONE document, so BEACON's
// multilingual answer is one document PER language (built via alertLocalesFor), and the invariant this
// file pins is that those per-language documents agree on every machine-readable field.
//
// GROUNDING (see schemas/edxl-sitrep.schema.json `#/properties/language` for the full note): OASIS
// EDXL-SitRep 1.0 (CS02) defines no Language/LanguageCode/xml:lang element anywhere in its core data
// dictionary — verified against the published spec text. `language` here borrows the name and RFC 3066
// semantics of OASIS EDXL-DE 2.0's `<language>`/`<contentLanguage>` element, the EDXL family's actual
// mechanism for tagging payload language, applied at the message level because BEACON emits bare
// EDXL-SitRep JSON without an EDXL-DE transport wrapper.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeSitRep } from '@/domain/sitrep.js';
import type { SitRep } from '@/domain/sitrep.js';
import type { IncidentId, SitRepId, SourceId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import { alertLocalesFor } from '@/config/locales.js';
import {
  buildEdxlSitRep,
  edxlSitRepMachineValuesAgree,
  sitRepToEdxlSitRep,
} from './edxl-sitrep-mapper.js';

const sitrepSchema = JSON.parse(readFileSync('schemas/edxl-sitrep.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSitRep = ajv.compile(sitrepSchema);

function floodSitRep(): SitRep {
  return makeSitRep({
    id: asId<SitRepId>('sitrep-ro-1'),
    incidentId: asId<IncidentId>('inc-ro-1'),
    generatedAt: '2026-07-05T22:00:00Z',
    summary: 'Fire has grown to 1,200 acres; 3 shelters open.',
    trend: 'ESCALATING',
    aiMode: 'deterministic-only',
    fields: [
      {
        field: 'summary.executiveSummary',
        claim: 'Fire has grown to 1,200 acres',
        citations: [{ sourceId: asId<SourceId>('11111111-1111-4111-8111-111111111111') }],
      },
    ],
  });
}

/** Romanian + English copy for the same SitRep, as a region with `languages: ['ro']` would produce. */
const TEXTS: Readonly<Record<'ro' | 'en', string>> = {
  ro: 'Cotă de inundație depășită',
  en: 'Flood stage exceeded',
};

describe('EdxlSitRep.language (grounded in EDXL-DE, not a native SitRep/RM element)', () => {
  it('is absent, and the document byte-identical to before, when no language is supplied', () => {
    const doc = buildEdxlSitRep(floodSitRep(), { sitRepNumber: '4', incidentType: 'WILDFIRE' });
    expect(Object.hasOwn(doc, 'language')).toBe(false);
  });

  it('is carried verbatim into the document when supplied, and still validates against the schema', () => {
    const res = sitRepToEdxlSitRep(floodSitRep(), {
      sitRepNumber: '4',
      language: 'ro',
      headline: TEXTS.ro,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.sitrep.language).toBe('ro');
    expect(validateSitRep(res.value.sitrep), JSON.stringify(validateSitRep.errors)).toBe(true);
  });

  it('agrees with the UI-side locale ordering helper (one definition of "which languages")', () => {
    // Same ordering doctrine as CAP (capTranslationsFor) — region language(s) first, English always.
    expect([...alertLocalesFor(['ro'])]).toEqual(['ro', 'en']);
  });
});

describe('edxlSitRepMachineValuesAgree — the multi-document safety invariant', () => {
  it('holds true across per-language documents built from the SAME canonical SitRep', () => {
    const sitrep = floodSitRep();
    const ro = buildEdxlSitRep(sitrep, {
      sitRepNumber: '4',
      incidentType: 'WILDFIRE',
      language: 'ro',
      headline: TEXTS.ro,
    });
    const en = buildEdxlSitRep(sitrep, {
      sitRepNumber: '4',
      incidentType: 'WILDFIRE',
      language: 'en',
      headline: TEXTS.en,
    });
    expect(edxlSitRepMachineValuesAgree(ro, en)).toBe(true);
    // Only the language tag and the human-readable headline differ.
    expect(ro.language).toBe('ro');
    expect(en.language).toBe('en');
    expect(ro.summary?.headline).toBe('Cotă de inundație depășită');
    expect(en.summary?.headline).toBe('Flood stage exceeded');
    // Machine-readable fields are identical.
    expect(ro.sitRepIdentifier).toBe(en.sitRepIdentifier);
    expect(ro.incidentInformation).toEqual(en.incidentInformation);
    expect(ro.summary?.trend).toBe(en.summary?.trend);
  });

  it('detects divergence if a machine value is ever tampered with per language', () => {
    const sitrep = floodSitRep();
    const en = buildEdxlSitRep(sitrep, { sitRepNumber: '4' });
    const tampered: typeof en = { ...en, summary: { ...en.summary, trend: 'STEADY' } };
    expect(edxlSitRepMachineValuesAgree(en, tampered)).toBe(false);
  });

  it('is reflexive (a document always agrees with itself)', () => {
    const doc = buildEdxlSitRep(floodSitRep(), { sitRepNumber: '1', language: 'en' });
    expect(edxlSitRepMachineValuesAgree(doc, doc)).toBe(true);
  });
});
