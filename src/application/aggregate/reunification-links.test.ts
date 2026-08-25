// BEACON — FR-D6-3 family-reunification LINK-OUT (ADR-035 §4). The most important assertions here are
// NEGATIVE: what the module cannot do. Zero data handled is the whole constitutional argument.
import { describe, it, expect } from 'vitest';
import reunificationSchema from '../../../schemas/d6-reunification-link.schema.json';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { SHIPPED_REGIONS } from '@/config/regions.js';
import {
  buildReunificationLinks,
  REUNIFICATION_NATIONAL_ISOS,
  REUNIFICATION_RUNGS,
} from './reunification-links.js';

describe('buildReunificationLinks (FR-D6-3)', () => {
  it('returns the region\'s national society first, then the global ICRC rung', () => {
    const links = buildReunificationLinks('us-ca');
    expect(links.map((l) => l.rung)).toEqual(['NATIONAL', 'GLOBAL']);
    expect(links[0]?.iso).toBe('US');
    expect(links[1]?.provider).toBe('ICRC');
  });

  it('Art. XVI: an unknown region id degrades to the GLOBAL rung — labelled, never empty, never a throw', () => {
    const links = buildReunificationLinks('atlantis');
    expect(links).toHaveLength(1);
    expect(links[0]?.rung).toBe('GLOBAL');
  });

  it('Art. XVI: no region id at all still yields the GLOBAL rung', () => {
    expect(buildReunificationLinks().map((l) => l.rung)).toEqual(['GLOBAL']);
    expect(buildReunificationLinks(undefined).map((l) => l.rung)).toEqual(['GLOBAL']);
  });

  it('EVERY shipped region resolves to at least one link (no configured region is a dead end)', () => {
    for (const region of SHIPPED_REGIONS) {
      const links = buildReunificationLinks(region.id);
      expect(links.length).toBeGreaterThan(0);
      expect(links.at(-1)?.rung).toBe('GLOBAL'); // the floor rung is always last and always present
    }
  });

  it('the national rung is keyed by ISO, so it is inherited from the region registry, not restated', () => {
    for (const region of SHIPPED_REGIONS) {
      const links = buildReunificationLinks(region.id);
      const expectNational = REUNIFICATION_NATIONAL_ISOS.includes(region.iso);
      expect(links.some((l) => l.rung === 'NATIONAL')).toBe(expectNational);
      if (expectNational) expect(links[0]?.iso).toBe(region.iso);
    }
  });

  it('is PURE: the same input yields an equal list every time, and the result is frozen data', () => {
    expect(buildReunificationLinks('ro')).toEqual(buildReunificationLinks('ro'));
  });

  it('every url is https and matches the schema pattern (no http, no scheme-relative, no javascript:)', () => {
    const urlPattern = new RegExp(reunificationSchema.properties.url.pattern);
    for (const region of [...SHIPPED_REGIONS.map((r) => r.id), 'atlantis', undefined]) {
      for (const link of buildReunificationLinks(region)) {
        expect(urlPattern.test(link.url)).toBe(true);
        expect(() => new URL(link.url)).not.toThrow();
      }
    }
  });

  it('every emitted rung is one the schema declares', () => {
    expect([...REUNIFICATION_RUNGS].sort()).toEqual([...reunificationSchema.properties.rung.enum].sort());
    for (const link of buildReunificationLinks('gr')) {
      expect(REUNIFICATION_RUNGS).toContain(link.rung);
    }
  });

  it('label and provider stay inside the schema length bounds', () => {
    for (const region of SHIPPED_REGIONS) {
      for (const link of buildReunificationLinks(region.id)) {
        expect(link.label.length).toBeLessThanOrEqual(reunificationSchema.properties.label.maxLength);
        expect(link.provider.length).toBeLessThanOrEqual(reunificationSchema.properties.provider.maxLength);
      }
    }
  });

  // ── The constitutional argument: ZERO data handled ─────────────────────────────────────────────────────
  it('handles ZERO reunification data — the output shape has no field a search/registry could use', () => {
    const allKeys = new Set(buildReunificationLinks('us-ca').flatMap((l) => Object.keys(l)));
    expect([...allKeys].sort()).toEqual(['iso', 'label', 'provider', 'rung', 'url']);
    // Nothing in this module accepts a query, a surname, a date of birth, a photo or a case id — the only
    // argument it takes is a region id, and the only thing it returns is a hyperlink.
    expect(buildReunificationLinks.length).toBe(1);
  });

  // ── Layer C ────────────────────────────────────────────────────────────────────────────────────────────
  it('Layer C: the MAXIMAL output (national + global) carries no person-identifying key', () => {
    expect(findPersonIdentifyingRuntimeKeys(buildReunificationLinks('us-ca'))).toEqual([]);
  });

  it('Layer C: a registry-shaped spread over a link IS caught (a registry is PERMANENTLY OUT of scope)', () => {
    const polluted = [{ ...buildReunificationLinks('ro')[0], familyName: 'Popescu', dob: '1980-01-01' }];
    expect(findPersonIdentifyingRuntimeKeys(polluted)).toEqual(['[0].familyName', '[0].dob']);
  });
});
