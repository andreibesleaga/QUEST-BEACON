// BEACON — GDELT ACL tests (E4·T-157; adapter-contract §4). The recorded (real, trimmed) GDELT DOC 2.0
// ArtList sample round-trips to valid NewsItems (MEDIA authority, deterministic credibility); a malformed
// row is skipped and counted (never silently unaccounted for, never fails the whole batch); seendate maps
// to a valid ISO-8601 instant; the mapper still raises a typed PARSE when fed an unmappable row directly.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import {
  GDELT_BASE_CREDIBILITY,
  gdeltMapper,
  gdeltSeenDateToIso,
  parseGdeltResponse,
} from './gdelt-acl.js';
import type { GdeltArticle } from './gdelt-acl.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/articles.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-15T09:00:00Z', sourceRecordId: 'sid-gdelt' };

describe('parseGdeltResponse', () => {
  it('parses every article from the recorded (real, trimmed) GDELT sample, skipped=0', () => {
    const { articles, skipped } = parseGdeltResponse(FIXTURE);
    expect(articles).toHaveLength(5);
    expect(skipped).toBe(0);
    expect(articles[0]?.domain).toBe('latimes.com');
  });

  it('returns an empty result for an empty articles[] envelope', () => {
    expect(parseGdeltResponse('{"articles": []}')).toEqual({ articles: [], skipped: 0 });
  });

  it('skips (and counts) rows missing url/title/seendate; keeps the well-formed ones', () => {
    const raw = JSON.stringify({
      articles: [
        { url: 'https://example.com/a', title: 'Good article', seendate: '20260701T120000Z' },
        { title: 'Missing url', seendate: '20260701T120000Z' }, // no url
        { url: 'https://example.com/c', seendate: '20260701T120000Z' }, // no title
        { url: 'https://example.com/d', title: 'Bad date', seendate: 'not-a-date' },
        { url: 'https://example.com/e', title: 'No seendate at all' },
      ],
    });
    const { articles, skipped } = parseGdeltResponse(raw);
    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe('https://example.com/a');
    expect(skipped).toBe(4);
  });

  it('ignores unknown/extra upstream fields (no leak, no failure)', () => {
    const raw = JSON.stringify({
      articles: [
        {
          url: 'https://example.com/a',
          title: 'Has extra fields',
          seendate: '20260701T120000Z',
          totally_unknown_field: 'ignored',
        },
      ],
    });
    const { articles, skipped } = parseGdeltResponse(raw);
    expect(articles).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it('raises a typed PARSE when the top-level response is not valid JSON', () => {
    try {
      parseGdeltResponse('{not json');
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});

describe('gdeltSeenDateToIso', () => {
  it('converts a GDELT seendate (YYYYMMDDTHHMMSSZ) to ISO-8601', () => {
    expect(gdeltSeenDateToIso('20260530T044500Z')).toBe('2026-05-30T04:45:00Z');
  });

  it('returns undefined for an unparsable or missing seendate', () => {
    expect(gdeltSeenDateToIso('bogus')).toBeUndefined();
    expect(gdeltSeenDateToIso(undefined)).toBeUndefined();
  });
});

describe('gdeltMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture article to a valid MEDIA NewsItem with deterministic credibility', () => {
    const { articles } = parseGdeltResponse(FIXTURE);
    const items = articles.map((a) => gdeltMapper.toCanonical(a, ctx));
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.sourceAuthority).toBe('MEDIA');
      expect(item.credibility).toBe(GDELT_BASE_CREDIBILITY);
      expect(Number.isNaN(Date.parse(item.publishedAt))).toBe(false);
      expect(item.url).toMatch(/^https:\/\//);
    }
    const first = items[0];
    expect(first?.title).toBe('California wildfire prevention funding at risk of drying up');
    expect(first?.publishedAt).toBe('2026-05-30T04:45:00Z');
    expect(first?.summary).toBe('latimes.com — United States — English');
  });

  it('raises a typed PARSE when fed an unmappable row directly (defense-in-depth)', () => {
    const bad: GdeltArticle = { title: 'No url or date' };
    try {
      gdeltMapper.toCanonical(bad, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('omits summary when domain/sourcecountry/language are all absent', () => {
    const raw: GdeltArticle = {
      url: 'https://example.com/bare',
      title: 'Bare article',
      seendate: '20260701T120000Z',
    };
    const item = gdeltMapper.toCanonical(raw, ctx);
    expect(item.summary).toBeUndefined();
  });
});
