// BEACON — OpenFEMA ACL tests (S2·Lane-A2; F1/adapter-contract §4). The RECORDED REAL response
// round-trips to valid OFFICIAL NewsItems; malformed rows are dropped AND counted; the citable URL is
// composed only from the disaster number; the summary carries FEMA's own fields verbatim; an unmappable
// row raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { femaMapper, parseFemaDeclarations } from './openfema-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/declarations.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseFemaDeclarations', () => {
  it('keeps every usable row of the recorded response', () => {
    const res = parseFemaDeclarations(json);
    expect(res.declarations).toHaveLength(6);
    expect(res.skipped).toBe(0);
  });

  it('drops AND counts rows with no disaster number or an unparseable declarationDate', () => {
    const res = parseFemaDeclarations(
      JSON.stringify({
        DisasterDeclarationsSummaries: [
          { declarationDate: '2026-08-01T00:00:00.000Z' },
          { disasterNumber: 1, declarationDate: 'soon' },
          { disasterNumber: 2, declarationDate: '2026-08-01T00:00:00.000Z' },
        ],
      }),
    );
    expect(res.declarations.map((d) => d.disasterNumber)).toEqual([2]);
    expect(res.skipped).toBe(2);
  });

  it('returns an empty result for a body with no declarations array', () => {
    expect(parseFemaDeclarations('{"metadata":{}}')).toEqual({ declarations: [], skipped: 0 });
  });
});

describe('femaMapper.toCanonical (golden round-trip over the recorded response)', () => {
  it('maps every recorded row to an OFFICIAL NewsItem with a citable FEMA disaster URL', () => {
    const { declarations } = parseFemaDeclarations(json);
    const items = declarations.map((d) => femaMapper.toCanonical(d, ctx));
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(item.sourceAuthority).toBe('OFFICIAL');
      expect(item.credibility).toBe(0.95);
      expect(item.url).toMatch(/^https:\/\/www\.fema\.gov\/disaster\/\d+$/);
      expect(Number.isNaN(Date.parse(item.publishedAt))).toBe(false);
    }
    const gann = items[0];
    expect(gann?.title).toBe('FM-5662-CA — GANN FIRE');
    expect(gann?.url).toBe('https://www.fema.gov/disaster/5662');
    expect(gann?.publishedAt).toBe('2026-08-04T00:00:00.000Z');
    expect(gann?.summary).toBe(
      'Fire Management Assistance Declaration — incident type Fire — Calaveras (County), CA — ' +
        'incident from 2026-08-04T00:00:00.000Z (ongoing) — programs declared: PA',
    );
  });

  it('preserves the per-designated-area rows of ONE disaster rather than collapsing them', () => {
    const { declarations } = parseFemaDeclarations(json);
    const wv = declarations
      .filter((d) => d.femaDeclarationString === 'DR-4932-WV')
      .map((d) => femaMapper.toCanonical(d, ctx));
    expect(wv).toHaveLength(2);
    expect(wv.map((i) => i.url)).toEqual([
      'https://www.fema.gov/disaster/4932',
      'https://www.fema.gov/disaster/4932',
    ]);
    expect(wv[0]?.summary).toContain('Pleasants (County)');
    expect(wv[1]?.summary).toContain('Ritchie (County)');
    expect(wv[0]?.summary).toContain(
      'incident 2026-07-21T00:00:00.000Z to 2026-07-22T00:00:00.000Z',
    );
    expect(wv[0]?.summary).toContain('programs declared: IH');
  });

  it('falls back to the disaster number when FEMA supplies no declaration string/title', () => {
    const item = femaMapper.toCanonical(
      { disasterNumber: 4321, declarationDate: '2026-07-01T00:00:00.000Z' },
      ctx,
    );
    expect(item.title).toBe('FEMA disaster 4321');
    expect(item.summary).toBe(''); // no fields to report ⇒ an empty summary, never an invented one
  });

  it('omits an unknown declarationType rather than guessing its expansion', () => {
    const item = femaMapper.toCanonical(
      {
        disasterNumber: 1,
        declarationDate: '2026-07-01T00:00:00.000Z',
        declarationType: 'ZZ',
        state: 'CA',
      },
      ctx,
    );
    expect(item.summary).toBe('CA');
  });

  it('raises a typed PARSE for a row the ACL cannot map', () => {
    try {
      femaMapper.toCanonical({ declarationTitle: 'no number' }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
