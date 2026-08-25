// BEACON — Bluesky ACL tests (E4·T-179; adapter-contract §4, Art. XIV). The recorded searchPosts fixture
// round-trips to valid NewsItems stamped SOCIAL/0.35; malformed posts are skipped+counted, never thrown
// out of the whole batch; the pure mapper still raises a typed PARSE on a bad row when called directly;
// title truncation + whitespace normalization + uri→url derivation are exercised explicitly.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { BlueskyPost } from './bluesky-acl.js';
import { blueskyMapper, parseBlueskyPosts } from './bluesky-acl.js';

const fixtureJson = readFileSync(
  fileURLToPath(new URL('./__fixtures__/posts.json', import.meta.url)),
  'utf8',
);

describe('parseBlueskyPosts', () => {
  it('lifts every well-formed post from the recorded searchPosts fixture (0 skipped)', () => {
    const { posts, skipped } = parseBlueskyPosts(fixtureJson);
    expect(posts).toHaveLength(4);
    expect(skipped).toBe(0);
    expect(posts[0]?.author?.handle).toBe('example-reporter.bsky.social');
  });

  it('returns an empty result for a response with no posts array', () => {
    expect(parseBlueskyPosts('{}')).toEqual({ posts: [], skipped: 0 });
  });

  it('throws a typed PARSE when the response body is not valid JSON', () => {
    try {
      parseBlueskyPosts('not json{{{');
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('skips and counts malformed posts, keeping only well-formed ones (never blanks the whole batch)', () => {
    const raw = {
      posts: [
        // well-formed
        {
          uri: 'at://did:plc:good/app.bsky.feed.post/rkey1',
          author: { handle: 'example-good.bsky.social' },
          record: { text: 'A real corroborating post about the fire line.', createdAt: '2026-07-10T12:00:00.000Z' },
        },
        // missing author.handle
        {
          uri: 'at://did:plc:bad1/app.bsky.feed.post/rkey2',
          author: {},
          record: { text: 'no handle', createdAt: '2026-07-10T12:01:00.000Z' },
        },
        // missing record.text
        {
          uri: 'at://did:plc:bad2/app.bsky.feed.post/rkey3',
          author: { handle: 'example-bad2.bsky.social' },
          record: { createdAt: '2026-07-10T12:02:00.000Z' },
        },
        // invalid createdAt
        {
          uri: 'at://did:plc:bad3/app.bsky.feed.post/rkey4',
          author: { handle: 'example-bad3.bsky.social' },
          record: { text: 'bad date', createdAt: 'not-a-date' },
        },
        // uri with no extractable rkey
        {
          uri: '',
          author: { handle: 'example-bad4.bsky.social' },
          record: { text: 'no uri', createdAt: '2026-07-10T12:03:00.000Z' },
        },
      ],
    };
    const { posts, skipped } = parseBlueskyPosts(JSON.stringify(raw));
    expect(posts).toHaveLength(1);
    expect(skipped).toBe(4);
    expect(posts[0]?.author?.handle).toBe('example-good.bsky.social');
  });
});

describe('blueskyMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture post to a NewsItem stamped SOCIAL/0.35 (Art. XIV floor)', () => {
    const { posts } = parseBlueskyPosts(fixtureJson);
    const items = posts.map((p) => blueskyMapper.toCanonical(p, { fetchedAt: '2026-07-15T09:00:00Z', sourceRecordId: 'sid-1' }));
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.sourceAuthority).toBe('SOCIAL');
      expect(item.credibility).toBe(0.35);
      expect(item.url).toMatch(/^https:\/\/bsky\.app\/profile\/example-.+\.bsky\.social\/post\/3kexamplepost0\d$/);
      expect(Number.isNaN(Date.parse(item.publishedAt))).toBe(false);
    }
    const first = items[0];
    expect(first?.url).toBe('https://bsky.app/profile/example-reporter.bsky.social/post/3kexamplepost01');
    expect(first?.publishedAt).toBe('2026-07-10T14:32:00.000Z');
    expect(first?.summary).toBe(
      'Wildfire smoke visible from the ridge above the valley this morning — evacuation advisory posted for the north side of town.',
    );
  });

  it('truncates the title to ~80 chars with an ellipsis when the text is longer', () => {
    const { posts } = parseBlueskyPosts(fixtureJson);
    const second = posts[1] as BlueskyPost; // has a newline + long text
    const item = blueskyMapper.toCanonical(second, { fetchedAt: '2026-07-15T09:00:00Z', sourceRecordId: 'sid-1' });
    expect(item.title.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
    expect(item.title.endsWith('…')).toBe(true);
    expect(item.title).not.toContain('\n'); // whitespace normalized before truncation
  });

  it('normalizes internal newlines/whitespace runs in the summary to single spaces', () => {
    const { posts } = parseBlueskyPosts(fixtureJson);
    const second = posts[1] as BlueskyPost;
    const item = blueskyMapper.toCanonical(second, { fetchedAt: '2026-07-15T09:00:00Z', sourceRecordId: 'sid-1' });
    expect(item.summary).not.toContain('\n');
    expect(item.summary).not.toMatch(/ {2,}/);
  });

  it('raises a typed PARSE when called directly on a post missing author.handle', () => {
    const bad: BlueskyPost = {
      uri: 'at://did:plc:x/app.bsky.feed.post/rkey',
      author: {},
      record: { text: 'hello', createdAt: '2026-07-10T12:00:00.000Z' },
    };
    try {
      blueskyMapper.toCanonical(bad, { fetchedAt: '2026-07-15T09:00:00Z', sourceRecordId: 'sid-1' });
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('raises a typed PARSE when called directly on a post with an empty uri (no extractable rkey)', () => {
    const bad: BlueskyPost = {
      uri: '',
      author: { handle: 'example.bsky.social' },
      record: { text: 'hello', createdAt: '2026-07-10T12:00:00.000Z' },
    };
    expect(() => blueskyMapper.toCanonical(bad, { fetchedAt: '2026-07-15T09:00:00Z', sourceRecordId: 'sid-1' })).toThrow();
  });
});
