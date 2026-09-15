// BEACON — Mastodon ACL tests (S2·Lane-A1; adapter-contract §4, Art. XIV). The recorded tag-timeline
// fixture round-trips to valid NewsItems stamped SOCIAL/0.35; malformed and non-public statuses are
// skipped+counted, never thrown out of the whole batch; the pure mapper still raises a typed PARSE on a bad
// row when called directly; the Art. XIV no-PII guarantees (no account field mapped, @mentions stripped in
// markup AND in bare text) are asserted explicitly, as are boost unwrapping, spoiler-text titling, HTML→text
// reduction, entity decoding, title truncation and multi-tag merge/de-duplication.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MastodonStatus } from './mastodon-acl.js';
import {
  mastodonMapper,
  mergeStatuses,
  parseMastodonStatuses,
  parseMastodonTimelines,
  stripStatusHtml,
} from './mastodon-acl.js';

const fixtureJson = readFileSync(
  fileURLToPath(new URL('./__fixtures__/timeline.json', import.meta.url)),
  'utf8',
);

const CTX = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-mastodon' };

/** A minimal well-formed public status (the shape every negative case below deviates from). */
const goodStatus = (over: Partial<MastodonStatus> = {}): MastodonStatus => ({
  id: '110000000000000099',
  url: 'https://example-instance.test/@example-observer-9/110000000000000099',
  created_at: '2026-07-05T12:00:00.000Z',
  content: '<p>A corroborating post about the fire line.</p>',
  spoiler_text: '',
  visibility: 'public',
  ...over,
});

describe('parseMastodonStatuses', () => {
  it('lifts every well-formed public status from the recorded tag-timeline fixture (0 skipped)', () => {
    const { statuses, skipped } = parseMastodonStatuses(fixtureJson);
    expect(statuses).toHaveLength(5);
    expect(skipped).toBe(0);
  });

  it('returns an empty result for a JSON body that is not an array (Mastodon error envelope)', () => {
    expect(parseMastodonStatuses('{"error":"Record not found"}')).toEqual({
      statuses: [],
      skipped: 0,
    });
  });

  it('throws a typed PARSE when the response body is not valid JSON', () => {
    try {
      parseMastodonStatuses('not json{{{');
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('skips and counts malformed statuses, keeping only well-formed ones (never blanks the batch)', () => {
    const raw = [
      goodStatus(),
      goodStatus({ url: '' }), // no permalink
      goodStatus({ created_at: 'not-a-date' }), // unusable instant
      goodStatus({ content: '<p>   </p>' }), // no claim text left after stripping
      undefined, // a null hole in the array
    ];
    const { statuses, skipped } = parseMastodonStatuses(JSON.stringify(raw));
    expect(statuses).toHaveLength(1);
    expect(skipped).toBe(4);
    expect(statuses[0]?.id).toBe('110000000000000099');
  });

  it('drops non-public statuses (Art. XIV defence-in-depth), counting them as skipped', () => {
    const raw = [
      goodStatus(),
      goodStatus({ visibility: 'unlisted' }),
      goodStatus({ visibility: 'private' }),
    ];
    const { statuses, skipped } = parseMastodonStatuses(JSON.stringify(raw));
    expect(statuses).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('unwraps a boost so the BOOSTED status carries the claim, not the empty wrapper', () => {
    const boosted = goodStatus({
      id: '110000000000000042',
      url: 'https://example-instance.test/@example-observer-42/110000000000000042',
      content: '<p>Original claim: the access road is closed at the bridge.</p>',
    });
    const boost: MastodonStatus = {
      id: '110000000000000043',
      visibility: 'public',
      reblog: boosted,
    };
    const { statuses, skipped } = parseMastodonStatuses(JSON.stringify([boost]));
    expect(skipped).toBe(0);
    expect(statuses[0]?.id).toBe('110000000000000042');
  });
});

describe('parseMastodonTimelines (multi-tag bodies)', () => {
  it('returns one batch per parseable body', () => {
    const batches = parseMastodonTimelines([JSON.stringify([goodStatus()]), JSON.stringify([])]);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1);
  });

  it('drops a single unparseable body so one bad tag cannot blank a multi-tag fetch (Art. XVI)', () => {
    const batches = parseMastodonTimelines([
      '<html>gateway error</html>',
      JSON.stringify([goodStatus()]),
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  it('rethrows the first PARSE when EVERY body is unparseable (honest failure, ladder degrades)', () => {
    try {
      parseMastodonTimelines(['<html>a</html>', '<html>b</html>']);
      expect.unreachable('should rethrow PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});

describe('mergeStatuses', () => {
  it('de-duplicates a status carried by two watched tags and orders newest-first', () => {
    const older = goodStatus({ id: 'a', created_at: '2026-07-05T10:00:00.000Z' });
    const newer = goodStatus({ id: 'b', created_at: '2026-07-05T18:00:00.000Z' });
    const merged = mergeStatuses([[older, newer], [newer]], 10);
    expect(merged.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('caps the merged list at the requested limit', () => {
    const batch = ['a', 'b', 'c'].map((id, i) =>
      goodStatus({ id, created_at: `2026-07-05T1${i}:00:00.000Z` }),
    );
    expect(mergeStatuses([batch], 2)).toHaveLength(2);
  });
});

describe('stripStatusHtml (HTML → corroboration text, Art. XIV)', () => {
  it('strips @mention anchors entirely but keeps hashtag anchors as #text', () => {
    const html =
      '<p>Smoke on the ridge ' +
      '<span class="h-card"><a href="https://x.test/@someone" class="u-url mention">@<span>someone</span></a></span> ' +
      '<a href="https://x.test/tags/wildfire" class="mention hashtag">#<span>wildfire</span></a></p>';
    expect(stripStatusHtml(html)).toBe('Smoke on the ridge #wildfire');
  });

  it('redacts a bare @user@host handle the markup pass cannot see', () => {
    expect(stripStatusHtml('<p>Confirmed by @observer@example.test on the ground.</p>')).toBe(
      'Confirmed by on the ground.',
    );
  });

  it('leaves an e-mail-shaped token inside a word untouched (only standalone handles are redacted)', () => {
    expect(stripStatusHtml('<p>Contact ops@example.test for details.</p>')).toBe(
      'Contact ops@example.test for details.',
    );
  });

  it('turns paragraph and line breaks into single spaces and collapses whitespace runs', () => {
    expect(stripStatusHtml('<p>Line one<br>Line two</p><p>Line three</p>')).toBe(
      'Line one Line two Line three',
    );
  });

  it('reassembles a link split across Mastodon invisible/ellipsis spans', () => {
    const html =
      '<p><a href="https://example-news.test/a/b" rel="nofollow"><span class="invisible">https://</span>' +
      '<span class="ellipsis">example-news.test/a</span><span class="invisible">/b</span></a></p>';
    expect(stripStatusHtml(html)).toBe('https://example-news.test/a/b');
  });

  it('decodes HTML entities, and decodes &amp; last so &amp;lt; cannot become a tag character', () => {
    expect(stripStatusHtml('<p>road closed &amp; shelter open &quot;now&quot;</p>')).toBe(
      'road closed & shelter open "now"',
    );
    expect(stripStatusHtml('<p>&amp;lt;p&amp;gt;</p>')).toBe('&lt;p&gt;');
  });
});

describe('mastodonMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture status to a NewsItem stamped SOCIAL/0.35 (Art. XIV floor)', () => {
    const { statuses } = parseMastodonStatuses(fixtureJson);
    const items = statuses.map((s) => mastodonMapper.toCanonical(s, CTX));
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.sourceAuthority).toBe('SOCIAL');
      expect(item.credibility).toBe(0.35);
      expect(item.url).toMatch(/^https:\/\/example-instance\.test\/@example-observer-\d\/\d+$/);
      expect(Number.isNaN(Date.parse(item.publishedAt))).toBe(false);
    }
    const first = items[0];
    expect(first?.publishedAt).toBe('2026-07-05T21:35:19.000Z');
    expect(first?.summary).toBe(
      'Ridge above the valley is glowing again after dry lightning overnight — heavy smoke drifting ' +
        'north over the highway. Photo from the pullout, nighttime mode. #wildfire',
    );
  });

  it('never carries an author identifier into the domain object (no handle/display name/avatar)', () => {
    const { statuses } = parseMastodonStatuses(fixtureJson);
    const items = statuses.map((s) => mastodonMapper.toCanonical(s, CTX));
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['credibility', 'publishedAt', 'sourceAuthority', 'summary', 'title', 'url'].sort(),
      );
      expect(item.summary).not.toContain('@example-observer');
      expect(item.title).not.toContain('Example Observer');
    }
  });

  it('uses the author-written content warning as the title when spoiler_text is set', () => {
    const { statuses } = parseMastodonStatuses(fixtureJson);
    const withSpoiler = statuses.find((s) => (s.spoiler_text ?? '') !== '');
    expect(withSpoiler).toBeDefined();
    const item = mastodonMapper.toCanonical(withSpoiler as MastodonStatus, CTX);
    expect(item.title).toBe('Graphic imagery from the fire line');
    expect(item.summary).toContain('Crews held the eastern flank overnight');
  });

  it('truncates the title to ~80 chars with an ellipsis when the text is longer', () => {
    const { statuses } = parseMastodonStatuses(fixtureJson);
    const item = mastodonMapper.toCanonical(statuses[0] as MastodonStatus, CTX);
    expect(item.title.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
    expect(item.title.endsWith('…')).toBe(true);
    expect(item.title).not.toContain('\n');
  });

  it('leaves a short title untruncated and with no ellipsis', () => {
    const { statuses } = parseMastodonStatuses(fixtureJson);
    const short = statuses[statuses.length - 1] as MastodonStatus;
    const item = mastodonMapper.toCanonical(short, CTX);
    expect(item.title).toBe('Evacuation order issued for the riverside blocks.');
  });

  it('maps the BOOSTED status when handed a boost directly', () => {
    const boosted = goodStatus({ url: 'https://example-instance.test/@example-observer-42/42' });
    const item = mastodonMapper.toCanonical({ visibility: 'public', reblog: boosted }, CTX);
    expect(item.url).toBe('https://example-instance.test/@example-observer-42/42');
  });

  it('raises a typed PARSE when called directly on a status with no permalink', () => {
    try {
      mastodonMapper.toCanonical(goodStatus({ url: null }), CTX);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE when the content strips down to nothing', () => {
    expect(() => mastodonMapper.toCanonical(goodStatus({ content: '<p><br></p>' }), CTX)).toThrow();
  });
});
