// BEACON — ReliefWeb ACL tests (E4·T-189; adapter-contract §4). The recorded v2 fixture round-trips to
// valid NewsItems (credibility/sourceAuthority deterministic, never LLM-produced); a malformed data[] item
// is skipped and COUNTED (lenient, never silently un-counted); a broken envelope (bad JSON / missing
// data[]) raises a typed PARSE so the redundancy ladder degrades. Pure, no clock/net.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import { parseReliefWeb, reliefWebMapper } from './reliefweb-acl.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/reports.json', import.meta.url)),
  'utf8',
);

describe('parseReliefWeb (recorded fixture — schema-crafted per apidoc.reliefweb.int, live call 403s on an unapproved appname)', () => {
  it('parses every data[] item into a validated row with zero skips', () => {
    const { rows, skipped } = parseReliefWeb(FIXTURE);
    expect(rows).toHaveLength(5);
    expect(skipped).toBe(0);
    expect(rows[0]?.title).toBe('Romania: Floods Flash Update No. 1 (as of 10 July 2026)');
    expect(rows[0]?.url).toBe(
      'https://reliefweb.int/report/romania/romania-floods-flash-update-no-1-10-july-2026',
    );
    expect(rows[0]?.publishedAt).toBe('2026-07-10T08:15:00+00:00');
    expect(rows[0]?.summary).toContain('Vrancea and Vaslui counties');
  });

  it('falls back to url_alias when fields.url is absent', () => {
    const json = JSON.stringify({
      data: [
        {
          fields: {
            title: 'Fallback URL report',
            url_alias: 'https://reliefweb.int/node/999',
            date: { created: '2026-07-01T00:00:00+00:00' },
          },
        },
      ],
    });
    const { rows, skipped } = parseReliefWeb(json);
    expect(skipped).toBe(0);
    expect(rows[0]?.url).toBe('https://reliefweb.int/node/999');
  });

  it('omits summary when fields.body is absent (no fabricated text)', () => {
    const json = JSON.stringify({
      data: [
        {
          fields: {
            title: 'No body report',
            url: 'https://reliefweb.int/node/1000',
            date: { created: '2026-07-01T00:00:00+00:00' },
          },
        },
      ],
    });
    const { rows } = parseReliefWeb(json);
    expect(rows[0]?.summary).toBeUndefined();
  });

  it('clips an oversized body to a bounded summary length', () => {
    const longBody = 'x'.repeat(600);
    const json = JSON.stringify({
      data: [
        {
          fields: {
            title: 'Long body report',
            url: 'https://reliefweb.int/node/1001',
            date: { created: '2026-07-01T00:00:00+00:00' },
            body: longBody,
          },
        },
      ],
    });
    const { rows } = parseReliefWeb(json);
    expect(rows[0]?.summary?.length).toBeLessThanOrEqual(501); // 500 chars + ellipsis
    expect(rows[0]?.summary?.endsWith('…')).toBe(true);
  });

  it('skips + counts a mix of malformed items (missing title/url/date) without throwing', () => {
    const json = JSON.stringify({
      data: [
        {
          fields: {
            title: 'Good report',
            url: 'https://reliefweb.int/node/1',
            date: { created: '2026-07-01T00:00:00+00:00' },
          },
        },
        {
          fields: {
            url: 'https://reliefweb.int/node/2',
            date: { created: '2026-07-01T00:00:00+00:00' },
          },
        }, // missing title
        { fields: { title: 'No URL', date: { created: '2026-07-01T00:00:00+00:00' } } }, // missing url
        { fields: { title: 'No date', url: 'https://reliefweb.int/node/4' } }, // missing date
        {
          fields: {
            title: 'Bad date',
            url: 'https://reliefweb.int/node/5',
            date: { created: 'not-a-date' },
          },
        },
        { notFields: true }, // missing fields entirely
        'not-an-object', // not even a record
      ],
    });
    const { rows, skipped } = parseReliefWeb(json);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Good report');
    expect(skipped).toBe(6);
  });

  it('raises a typed PARSE on invalid JSON (broken envelope, not a per-item issue)', () => {
    try {
      parseReliefWeb('{not valid json');
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE when the response has no data[] array', () => {
    try {
      parseReliefWeb(JSON.stringify({ error: 'nope' }));
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});

describe('reliefWebMapper.toCanonical', () => {
  it('maps a row to a NewsItem with deterministic OFFICIAL credibility (never LLM-produced)', () => {
    const { rows } = parseReliefWeb(FIXTURE);
    const items = rows.map((r) =>
      reliefWebMapper.toCanonical(r, {
        fetchedAt: '2026-07-10T12:00:00Z',
        sourceRecordId: 'sid-1',
      }),
    );
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.sourceAuthority).toBe('OFFICIAL');
      expect(item.credibility).toBe(0.9);
      expect(Number.isNaN(Date.parse(item.publishedAt))).toBe(false);
    }
    expect(items[1]?.title).toContain('California Wildfires');
  });

  it('omits summary on the output NewsItem when the row has none', () => {
    const item = reliefWebMapper.toCanonical(
      { title: 'T', url: 'https://reliefweb.int/node/1', publishedAt: '2026-07-01T00:00:00Z' },
      { fetchedAt: '2026-07-10T12:00:00Z', sourceRecordId: 'sid-1' },
    );
    expect(item.summary).toBeUndefined();
  });
});
