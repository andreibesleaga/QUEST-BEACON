// BEACON — rumor / misinformation board tests (MW-D/D5.1; FR-D4-1, FEV-20, V12).
// The board is exercised through the REAL deterministic grounding pass (groundNews) over a recorded news
// batch — never against a hand-written NewsGroundingResult, because the property under test is that the
// board FAITHFULLY PROJECTS what that pass decided.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { NewsItem } from '@/ports/intel.js';
import { groundNews } from '@/application/sitrep-synthesis/news-grounding.js';
import type { GroundedFact } from '@/application/sitrep-synthesis/sitrep-synthesis.js';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { CitationId, SourceId } from '@/domain/value-objects/ids.js';
import { RUMOR_BOARD_CAVEAT, RUMOR_FLAG_REASONS, buildRumorBoard, isFlaggedFact } from './rumor-board.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateBoard = ajv.compile(
  JSON.parse(readFileSync('schemas/d5-rumor-board.schema.json', 'utf8')) as object,
);

const BATCH = JSON.parse(readFileSync('fixtures/coordination/news-batch.json', 'utf8')) as {
  items: readonly NewsItem[];
};

const grounded = groundNews(BATCH.items, { region: 'Los Angeles County' });

describe('buildRumorBoard (over the real groundNews pass)', () => {
  it('lists every flagged signal and nothing else', () => {
    const res = buildRumorBoard(grounded);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.rows).toHaveLength(grounded.flaggedCount);
    expect(res.value.rows.length).toBeGreaterThan(0); // the fixture really does produce flagged items
    for (const row of res.value.rows) {
      expect(row.flagged).toBe(true);
      expect(row.corroboratingSourceCount).toBe(0);
      expect(row.disposition).toBe('FLAGGED_NOT_MERGED');
      expect(RUMOR_FLAG_REASONS).toContain(row.reason);
      // FEV-20: the reason is visible in the rendered claim itself, not only in the code.
      expect(row.claim).toMatch(/not corroborated by any authoritative source/i);
    }
  });

  it('never launders a corroborated fact onto the board (V12)', () => {
    const res = buildRumorBoard(grounded);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const corroborated = grounded.facts.filter((f) => f.flagged !== true);
    expect(corroborated.length).toBeGreaterThan(0);
    const rowFields = new Set(res.value.rows.map((r) => r.field));
    for (const fact of corroborated) expect(rowFields.has(fact.field)).toBe(false);
  });

  it('carries the corroboration figures through BY IDENTITY — it never recounts', () => {
    const res = buildRumorBoard(grounded);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.summary.corroboratedFactCount).toBe(grounded.corroboratedCount);
    expect(res.value.summary.flaggedCount).toBe(grounded.flaggedCount);
    expect(res.value.summary.corroboration).toBe(grounded.corroboration);
    // …and the flagged stream contributed nothing to that score (Art. XIV).
    expect(res.value.summary.corroboration).toBeLessThanOrEqual(1);
    expect(res.value.rows.length).toBe(res.value.summary.flaggedCount);
  });

  it('renders the caveat on the board itself', () => {
    const res = buildRumorBoard(grounded);
    expect(res.ok && res.value.caveat).toBe(RUMOR_BOARD_CAVEAT);
    expect(RUMOR_BOARD_CAVEAT).toMatch(/NEVER merged/);
  });

  it('is deterministic — same batch in, identical board out', () => {
    const a = buildRumorBoard(groundNews(BATCH.items, { region: 'Los Angeles County' }));
    const b = buildRumorBoard(groundNews(BATCH.items, { region: 'Los Angeles County' }));
    expect(a).toEqual(b);
  });

  it('produces an empty board (not a failure) for a batch with nothing flagged', () => {
    const officialOnly = BATCH.items.filter((i) => i.sourceAuthority === 'OFFICIAL');
    const res = buildRumorBoard(groundNews(officialOnly));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.rows).toEqual([]);
    expect(res.value.summary.flaggedCount).toBe(0);
  });

  it('validates against schemas/d5-rumor-board.schema.json', () => {
    const res = buildRumorBoard(grounded);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(validateBoard(res.value), JSON.stringify(validateBoard.errors)).toBe(true);
  });

  it('carries no person-identifying key at runtime (Art. XIV, Layer C)', () => {
    const res = buildRumorBoard(grounded);
    expect(res.ok && findPersonIdentifyingRuntimeKeys(res.value)).toEqual([]);
  });
});

describe('fail-closed guard', () => {
  const laundered: GroundedFact = {
    field: 'news-unverified-1',
    claim: 'Unverified social report — not corroborated by any authoritative source: "x".',
    sourceId: asId<SourceId>('news:social.example.org'),
    citationId: asId<CitationId>('cit-news-unverified-1'),
    corroboratingSourceIds: [asId<SourceId>('news:water.example.gov')],
    flagged: true,
  };

  it('refuses the WHOLE board when a flagged fact claims corroboration', () => {
    const res = buildRumorBoard({ facts: [laundered], corroboration: 0, corroboratedCount: 0, flaggedCount: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('CONFLICT');
    expect(res.error.message).toMatch(/news-unverified-1/);
    expect(res.error.message).toMatch(/may never claim corroboration/);
  });
});

describe('isFlaggedFact', () => {
  it('is true only for flagged:true — an absent flag is not a flag', () => {
    const base = {
      field: 'f',
      claim: 'c',
      sourceId: asId<SourceId>('s'),
      citationId: asId<CitationId>('c1'),
    };
    expect(isFlaggedFact({ ...base, flagged: true })).toBe(true);
    expect(isFlaggedFact({ ...base, flagged: false })).toBe(false);
    expect(isFlaggedFact(base)).toBe(false);
  });
});
