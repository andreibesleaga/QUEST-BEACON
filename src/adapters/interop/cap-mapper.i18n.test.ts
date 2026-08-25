// BEACON — multilingual CAP tests (ADR-030/ADR-036; FR-I18N-6, FUW-2).
// CAP v1.2 already answers "how do I alert in two languages?": multiple <info> blocks distinguished by
// <language>. The risk that answer creates is DIVERGENCE — a Romanian block saying Moderate while the
// English block says Severe, or an area polygon that differs by language. These tests pin the invariant:
// text may vary, machine-readable values may not, and English is always present.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeAlert } from '@/domain/alert.js';
import type { Alert } from '@/domain/alert.js';
import type { AlertId, IncidentId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { PolygonGeometry } from '@/domain/value-objects/geo.js';
import { alertToCap, buildCapAlert, capMachineValuesAgree, capTranslationsFor } from './cap-mapper.js';
import { alertLocalesFor } from '@/config/locales.js';

const capSchema = JSON.parse(readFileSync('schemas/cap-v1.2.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateCap = ajv.compile(capSchema);

const RING: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [[[24.0, 44.0], [24.2, 44.0], [24.2, 44.2], [24.0, 44.2], [24.0, 44.0]]],
};

function floodAlert(): Alert {
  return makeAlert({
    id: asId<AlertId>('alert-ro-1'),
    incidentId: asId<IncidentId>('inc-ro-1'),
    capStatus: 'DRAFT',
    category: 'Met',
    severity: 'SEVERE',
    area: RING,
    sentAt: '2026-07-05T22:00:00Z',
  });
}

/** Romanian + English copy for the same alert, as a region with `languages: ['ro']` would produce. */
const TEXTS = {
  ro: {
    event: 'Inundație',
    headline: 'Cotă de inundație depășită',
    instruction: 'Evacuați către zonele înalte.',
    areaDesc: 'Lunca Argeșului',
  },
  en: {
    event: 'Flood',
    headline: 'Flood stage exceeded',
    instruction: 'Move to higher ground.',
    areaDesc: 'Argeș floodplain',
  },
};

describe('capTranslationsFor (FR-I18N-6 — region language AND English, always)', () => {
  it('puts the region language first and always appends English', () => {
    expect(capTranslationsFor(['ro'], TEXTS).map((t) => t.language)).toEqual(['ro', 'en']);
  });

  it('does not duplicate English for an English-speaking region', () => {
    expect(capTranslationsFor(['en'], TEXTS).map((t) => t.language)).toEqual(['en']);
  });

  it('skips a language with no translated copy rather than mislabelling English as that language', () => {
    // A block tagged <language>bn</language> containing English text would be a lie about its contents.
    expect(capTranslationsFor(['bn', 'ro'], TEXTS).map((t) => t.language)).toEqual(['ro', 'en']);
  });

  it('agrees with the UI-side locale ordering helper (one definition of "which languages")', () => {
    expect(capTranslationsFor(['ro'], TEXTS).map((t) => t.language)).toEqual([...alertLocalesFor(['ro'])]);
  });
});

describe('multilingual CAP document', () => {
  it('emits one <info> per language, each carrying its own text', () => {
    const res = alertToCap(floodAlert(), {
      event: TEXTS.en.event,
      responseType: ['Evacuate'],
      translations: capTranslationsFor(['ro'], TEXTS),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.info).toHaveLength(2);
    expect(res.value.info[0]?.language).toBe('ro');
    expect(res.value.info[0]?.headline).toBe('Cotă de inundație depășită');
    expect(res.value.info[1]?.language).toBe('en');
    expect(res.value.info[1]?.headline).toBe('Flood stage exceeded');
  });

  it('still validates against the CAP v1.2 schema with multiple info blocks', () => {
    const res = alertToCap(floodAlert(), { translations: capTranslationsFor(['ro'], TEXTS) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(validateCap(res.value), JSON.stringify(validateCap.errors)).toBe(true);
  });

  it('holds every machine-readable value identical across blocks (FUW-2 — the safety invariant)', () => {
    const cap = buildCapAlert(
      floodAlert(),
      { responseType: ['Evacuate'], web: 'https://beacon.local/i/inc-ro-1', translations: capTranslationsFor(['ro'], TEXTS) },
      '2026-07-05T22:00:00Z',
    );
    expect(capMachineValuesAgree(cap)).toBe(true);
    for (const info of cap.info) {
      expect(info.severity).toBe('Severe');
      expect(info.category).toEqual(['Met']);
      expect(info.urgency).toBe('Expected');
      expect(info.certainty).toBe('Likely');
      expect(info.responseType).toEqual(['Evacuate']);
      expect(info.web).toBe('https://beacon.local/i/inc-ro-1');
    }
    // The geometry is the same ring in both blocks — only its human description is translated.
    const polygons = cap.info.map((i) => i.area?.[0]?.polygon);
    expect(polygons[0]).toEqual(polygons[1]);
    expect(cap.info[0]?.area?.[0]?.areaDesc).toBe('Lunca Argeșului');
    expect(cap.info[1]?.area?.[0]?.areaDesc).toBe('Argeș floodplain');
  });

  it('detects divergence if a machine value is ever tampered with per language', () => {
    const cap = buildCapAlert(floodAlert(), { translations: capTranslationsFor(['ro'], TEXTS) }, '2026-07-05T22:00:00Z');
    const tampered = { ...cap, info: [cap.info[0]!, { ...cap.info[1]!, severity: 'Minor' as const }] };
    expect(capMachineValuesAgree(tampered)).toBe(false);
  });

  it('falls back to the base English field when a translation omits it (never a blank block)', () => {
    const partial = capTranslationsFor(['ro'], { ro: { headline: 'Doar titlul' }, en: TEXTS.en });
    const cap = buildCapAlert(floodAlert(), { description: 'Base description', translations: partial }, '2026-07-05T22:00:00Z');
    expect(cap.info[0]?.headline).toBe('Doar titlul');
    expect(cap.info[0]?.description).toBe('Base description');
  });

  it('is byte-identical to the single-language document when no translations are supplied', () => {
    const opts = { event: 'Flood', responseType: ['Evacuate'] as const };
    const before = buildCapAlert(floodAlert(), opts, '2026-07-05T22:00:00Z');
    const after = buildCapAlert(floodAlert(), { ...opts, translations: [] }, '2026-07-05T22:00:00Z');
    expect(after).toEqual(before);
    expect(before.info).toHaveLength(1);
  });
});
